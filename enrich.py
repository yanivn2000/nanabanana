"""Claude enrichment layer — turns raw OSM rows into an Israeli-family dataset.

For each attraction Claude provides: a Hebrew name, a real family_score (which
lets us filter out junk like tiny memorials), age suitability, a one-line
Hebrew tip, and a quality_keep verdict. Uses claude-opus-4-8 with structured
outputs so the response is always valid JSON.
"""
import json
import anthropic

import db

BATCH_SIZE = 15

# Structured-outputs schema: Claude must return one object per attraction.
_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "integer"},
        "name_he": {"type": "string"},
        "family_score": {"type": "integer"},          # 1-10
        "min_age": {"type": "integer"},
        "max_age": {"type": "integer"},
        "indoor_outdoor": {"type": "string", "enum": ["indoor", "outdoor", "both"]},
        "quality_keep": {"type": "boolean"},           # false = skip (junk/marker)
        "tips_he": {"type": "string"},
        "tagline_he": {"type": "string"},              # memorable one-liner
    },
    "required": ["id", "name_he", "family_score", "min_age", "max_age",
                 "indoor_outdoor", "quality_keep", "tips_he", "tagline_he"],
    "additionalProperties": False,
}
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": _ITEM_SCHEMA}},
    "required": ["items"],
    "additionalProperties": False,
}

SYSTEM = (
    "You are a travel-data editor for an Israeli family trip-planning app. "
    "Given raw OpenStreetMap attractions, you enrich each one for Israeli "
    "families travelling abroad. Be honest and selective: many OSM 'historic' "
    "rows are tiny plaques, memorials, or boundary markers that no family would "
    "ever visit — mark those quality_keep=false. Real attractions families "
    "enjoy (parks, zoos, viewpoints, notable castles, museums worth a stop) get "
    "quality_keep=true. Write name_he as the common Hebrew name Israelis use "
    "(transliterate if there is no established Hebrew name). tips_he is one short "
    "practical Hebrew sentence (≤15 words) — when to go, what to know, or who "
    "it suits. family_score 1-10 reflects how much a typical Israeli family with "
    "kids would enjoy it. min_age/max_age = suitable age range (0 and 99 if all "
    "ages). tagline_he is a SHORT memorable hook in Hebrew (<=6 words) that makes "
    "the place recognizable instead of a foreign name — e.g. 'פארק המים הגדול "
    "באוסטריה', 'הטירה מהאגדות', 'גן החיות עם הפנדות'. Use a superlative or vivid "
    "image when it fits; never just repeat the category."
)


def _build_prompt(rows):
    lines = []
    for r in rows:
        lines.append(json.dumps({
            "id": r["id"],
            "name": r["name_en"],
            "category": r["category"],
            "subcategory": r["subcategory"],
            "website": r["website"] or "",
        }, ensure_ascii=False))
    return ("Enrich these attractions. Return one item per input id:\n\n"
            + "\n".join(lines))


def pending_count(conn):
    return conn.execute(
        "SELECT count(*) FROM attractions WHERE enriched_at IS NULL"
    ).fetchone()[0]


def enrich_batch(conn, client, rows, model):
    """Enrich a list of attraction rows; write results back. Returns # updated."""
    # No thinking: this is structured extraction, json_schema enforces clean
    # output. Thinking only wastes tokens and risks crowding out the text block.
    resp = client.messages.create(
        model=model,
        max_tokens=12000,
        system=SYSTEM,
        output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
        messages=[{"role": "user", "content": _build_prompt(rows)}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise ValueError(f"no text block (stop_reason={resp.stop_reason})")
    items = json.loads(text)["items"]

    updated = 0
    for it in items:
        conn.execute(
            "UPDATE attractions SET name_he=?, family_score=?, min_age=?, "
            "max_age=?, indoor_outdoor=?, quality_keep=?, tips_he=?, tagline_he=?, "
            "enriched_at=datetime('now') WHERE id=?",
            (it["name_he"], it["family_score"], it["min_age"], it["max_age"],
             it["indoor_outdoor"], 1 if it["quality_keep"] else 0,
             it["tips_he"], it.get("tagline_he"), it["id"]),
        )
        updated += 1
    conn.commit()
    return updated


def enrich_pending(api_key, limit=60, progress=None, model=None):
    """Enrich up to `limit` un-enriched attractions in batches.

    Highest-value rows first (have a photo, then a wiki source, then higher
    rough score) so a budget-limited run covers the best places first.
    `progress` is an optional callback(done, total). Returns total updated.
    `model` overrides the DB model setting (e.g. a cheaper model for bulk).
    """
    db.init_db()
    conn = db.get_conn()
    client = anthropic.Anthropic(api_key=api_key)
    model = model or db.get_model(conn)

    rows = conn.execute(
        "SELECT id, name_en, category, subcategory, website FROM attractions "
        "WHERE enriched_at IS NULL "
        "ORDER BY (image_url IS NOT NULL) DESC, "
        "         (info_sources IS NOT NULL AND info_sources NOT IN ('','[]')) DESC, "
        "         COALESCE(family_score, 0) DESC LIMIT ?", (limit,)
    ).fetchall()

    total = len(rows)
    done = 0
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        try:
            done += enrich_batch(conn, client, batch, model)
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            # Bad/empty model output for this batch — skip it, keep the run going.
            print(f"  skip batch ({len(batch)}): {e}", flush=True)
        if progress:
            progress(done, total)
    conn.close()
    return done
