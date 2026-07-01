"""Verified-knowledge layer — distil real travellers' posts into structured
insights the app trusts ABOVE generic web knowledge.

Flow (all in the admin, 8513):
    1. A team member pastes a real post (blog / forum / friend's write-up) and
       picks the destination.
    2. Claude distils it ONCE into structured, per-place insights (tip / warning
       / verdict / food / season / access) — `distill()`.
    3. The team reviews and approves the ones worth keeping.
    4. Approved insights are stored (`save`), each matched to one of our
       attractions where possible (`match_attraction`).

The stored result is then used by the consumer app BOTH with AI (injected into
the itinerary prompt with high priority) AND without AI (shown on attraction
cards). Because it is pre-distilled, no AI is needed at read time.
"""
import io
import json
import os
import re
import shutil
import subprocess
import tempfile

import anthropic

import db

# Kinds of insight, with a Hebrew label + emoji for the admin/app.
KIND_HE = {
    "tip": "טיפ 💡",
    "warning": "אזהרה ⚠️",
    "verdict": "שווה / לא שווה 👍",
    "food": "אוכל 🍽️",
    "season": "עונה 🗓️",
    "access": "נגישות ♿",
}

_INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        # Place name exactly as written in the post; "" for a destination-wide tip.
        "place": {"type": "string"},
        "kind": {"type": "string",
                 "enum": ["tip", "warning", "verdict", "food", "season", "access"]},
        "text_he": {"type": "string"},          # concise, actionable Hebrew
        "sentiment": {"type": "string", "enum": ["pos", "neg", "neutral"]},
    },
    "required": ["place", "kind", "text_he", "sentiment"],
    "additionalProperties": False,
}
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {"insights": {"type": "array", "items": _INSIGHT_SCHEMA}},
    "required": ["insights"],
    "additionalProperties": False,
}

# Thread mode: several travellers/families in one pasted text. Grouped by author
# so each becomes its OWN source — repetition across families is a consensus
# signal we must NOT collapse.
_FAMILY_SCHEMA = {
    "type": "object",
    "properties": {
        "author": {"type": "string"},   # short label for this family/author
        "insights": {"type": "array", "items": _INSIGHT_SCHEMA},
    },
    "required": ["author", "insights"],
    "additionalProperties": False,
}
THREAD_SCHEMA = {
    "type": "object",
    "properties": {"families": {"type": "array", "items": _FAMILY_SCHEMA}},
    "required": ["families"],
    "additionalProperties": False,
}

SYSTEM = (
    "You are a travel-knowledge editor for an Israeli family trip-planning app. "
    "You are given a REAL traveller's post about a destination (a blog, forum "
    "write-up, or a friend's summary). Distil it into concrete, reusable "
    "insights that would genuinely help a future Israeli family — the kind of "
    "first-hand knowledge you cannot get from a generic listing. "
    "Extract one insight per distinct, useful point. For each: "
    "`place` = the specific place it is about (attraction, restaurant, "
    "neighbourhood) written EXACTLY as it appears in the post (keep the original "
    "language); use \"\" only for a genuinely destination-wide tip. "
    "`kind`: tip (practical advice), warning (something to avoid/watch), verdict "
    "(worth it / overrated / a must / skippable), food (a specific place or dish "
    "to eat), season (timing / weather / crowds), access (families, strollers, "
    "wheelchairs, opening logistics). "
    "`text_he`: ONE short, factual, actionable Hebrew sentence (≤25 words). No "
    "fluff, no marketing, no repeating the place name unnecessarily — just the "
    "insight itself. "
    "`sentiment`: pos / neg / neutral. "
    "Prefer specific, non-obvious, first-hand information over generic filler. "
    "Do NOT invent anything not supported by the post. De-duplicate. If the post "
    "has nothing useful, return an empty list."
)

# Same rules as SYSTEM, but the input is a THREAD of several different families.
SYSTEM_THREAD = (
    "You are a travel-knowledge editor for an Israeli family trip-planning app. "
    "You are given a THREAD containing posts from SEVERAL DIFFERENT travellers / "
    "families about the same destination (e.g. a forum thread or a collection of "
    "write-ups). Split it by author and return one group per distinct write-up. "
    "For each group: `author` = a short Hebrew label identifying it. Prefer a "
    "name / handle / signature if the text gives one. If it does NOT (common — "
    "many summaries are anonymous), synthesize a SHORT descriptive label from "
    "THAT group's own distinguishing details — group composition, trip length, "
    "or a distinctive angle. Examples: '2 חברות · 4 ימים', 'הרכב של 8 · גילאים "
    "25-73', 'שתי חברות ותיקות', 'קבוצה · טירה + זאנסה + וולנדם'. Make each label "
    "DISTINCT from the others. Only if a group has no distinguishing detail at "
    "all, fall back to 'מטייל 1', 'מטייל 2', ... in order of appearance. "
    "`insights` = that group's insights, using these rules per insight: "
    "`place` = the specific place, written EXACTLY as in the text (keep original "
    "language); \"\" only for a destination-wide tip. "
    "`kind`: tip / warning / verdict / food / season / access. "
    "`text_he`: ONE short, factual, actionable Hebrew sentence (≤25 words). "
    "`sentiment`: pos / neg / neutral. "
    "CRITICAL: de-duplicate WITHIN each family, but do NOT merge insights ACROSS "
    "different families — if two families independently recommend or warn about "
    "the same place, keep BOTH (that agreement is valuable consensus signal). "
    "Do NOT invent anything not supported by the text. If a family has nothing "
    "useful, omit it."
)


def distill(raw_text, dest_name, api_key, model=None, thread=False):
    """Distil a pasted post (or a multi-family thread) into structured insights.

    Single post (thread=False): returns [{place, kind, text_he, sentiment}, ...].
    Thread (thread=True): returns the same flat list, but each item also carries
    an `author` label so it can be saved as one source per family. Does not touch
    the DB.
    """
    conn = db.get_conn()
    model = model or db.get_model(conn)
    conn.close()
    client = anthropic.Anthropic(api_key=api_key)
    if thread:
        prompt = (
            f"Destination: {dest_name}\n\n"
            "Split the following thread by family and distil each family's "
            "insights:\n\n" + raw_text.strip()
        )
        schema, system = THREAD_SCHEMA, SYSTEM_THREAD
    else:
        prompt = (
            f"Destination: {dest_name}\n\n"
            "Distil the following traveller's post into structured insights:\n\n"
            + raw_text.strip()
        )
        schema, system = OUTPUT_SCHEMA, SYSTEM
    # A multi-family thread produces many more insights, so it needs a much
    # larger output budget than a single post.
    resp = client.messages.create(
        model=model,
        max_tokens=20000 if thread else 8000,
        system=system,
        output_config={"format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": prompt}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise ValueError(f"no text block (stop_reason={resp.stop_reason})")
    if resp.stop_reason == "max_tokens":
        raise ValueError("התוכן ארוך מדי לעיבוד בבת אחת — חלקו אותו לשני חלקים והזינו בנפרד.")
    data = json.loads(text)
    if thread:
        items = []
        for fam in data.get("families", []):
            author = fam.get("author") or ""
            for it in fam.get("insights", []):
                items.append({**it, "author": author})
        return items
    return data["insights"]


# --- Upload a document (PDF/txt) with several write-ups -----------------------

_BIDI = re.compile("[‎‏‪-‮⁦-⁩]")


def _clean_text(t):
    t = _BIDI.sub("", t)                    # strip RTL/LTR control marks
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)        # collapse big blank-page gaps
    return t.strip()


def extract_text(filename, data):
    """Plain text from an uploaded .pdf / .txt. Prefers `pdftotext -layout`
    (best for Hebrew RTL), falls back to pypdf."""
    name = (filename or "").lower()
    if not name.endswith(".pdf"):
        return _clean_text(data.decode("utf-8", "replace"))
    if shutil.which("pdftotext"):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            path = f.name
        try:
            out = subprocess.run(["pdftotext", "-layout", path, "-"],
                                 capture_output=True, timeout=90)
            txt = out.stdout.decode("utf-8", "replace")
            if txt.strip():
                return _clean_text(txt)
        finally:
            os.unlink(path)
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return _clean_text("\n".join((p.extract_text() or "") for p in reader.pages))


_SPLIT_SCHEMA = {
    "type": "object",
    "properties": {"starts": {"type": "array", "items": {"type": "string"}}},
    "required": ["starts"],
    "additionalProperties": False,
}
SPLIT_SYSTEM = (
    "You are given a document that concatenates SEVERAL separate travel write-ups "
    "(trip summaries) about the same destination, one after another. Identify "
    "where each distinct write-up STARTS. Return `starts`: an ordered list, one "
    "entry per write-up, each the VERBATIM opening text of that write-up — copy "
    "its first line / first ~8 words EXACTLY as they appear (same language and "
    "characters), so it can be located in the document. Do not paraphrase. If it "
    "is really just one write-up, return a single entry."
)


def split_writeups(text, api_key, model=None):
    """Split a concatenated document into its individual write-ups. Uses one
    cheap AI call to find each write-up's verbatim opening, then cuts locally.
    Returns a list of segment strings (>=1)."""
    conn = db.get_conn()
    model = model or db.get_model(conn)
    conn.close()
    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=3000,
        system=SPLIT_SYSTEM,
        output_config={"format": {"type": "json_schema", "schema": _SPLIT_SCHEMA}},
        messages=[{"role": "user", "content": text}],
    )
    tb = next((b.text for b in resp.content if b.type == "text"), None)
    starts = json.loads(tb).get("starts", []) if tb else []
    idxs = []
    for s in starts:
        frag = (s or "").strip()
        if not frag:
            continue
        i = text.find(frag)
        if i < 0:                            # fuzzy: fall back to first 5 words
            short = " ".join(frag.split()[:5])
            i = text.find(short) if short else -1
        if i >= 0:
            idxs.append(i)
    idxs = sorted(set(idxs))
    if len(idxs) < 2:
        return [text]
    bounds = idxs + [len(text)]
    return [seg for a, b in zip(bounds, bounds[1:]) if (seg := text[a:b].strip())]


def distill_document(text, dest_name, api_key, model=None, progress=None):
    """Distil a whole uploaded document. Short inputs go through a single thread
    call; long ones are split into write-ups and distilled one-by-one (robust to
    size + fast). Returns the same flat item list as distill(thread=True).
    `progress` is an optional callback(done, total)."""
    if len(text) < 12000:
        items = distill(text, dest_name, api_key, model=model, thread=True)
        if progress:
            progress(1, 1)
        return items
    segs = split_writeups(text, api_key, model=model)
    total = len(segs)
    items = []
    for i, seg in enumerate(segs):
        try:
            items += distill(seg, dest_name, api_key, model=model, thread=True)
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            print(f"skip segment {i + 1}/{total}: {e}", flush=True)
        if progress:
            progress(i + 1, total)
    return items


def _norm(s):
    return "".join(ch for ch in (s or "").lower() if ch.isalnum() or ch.isspace()).strip()


def match_attraction(conn, destination_id, place_name):
    """Best-effort match of a free-text place name to one of our attractions in
    this destination. Returns (attraction_id, matched_name) or (None, None).

    Matches on English or Hebrew name; prefers an exact match, then a
    contains-match, preferring higher family_score / must-see rows.
    """
    place = _norm(place_name)
    if not place or len(place) < 3:
        return None, None
    rows = conn.execute(
        "SELECT id, name_en, name_he, COALESCE(family_score,0) AS fs, "
        "       COALESCE(must_see,0) AS ms "
        "FROM attractions WHERE destination_id=? "
        "AND (is_duplicate IS NULL OR is_duplicate=0)",
        (destination_id,),
    ).fetchall()
    best = None
    for r in rows:
        for name in (r["name_en"], r["name_he"]):
            n = _norm(name)
            if not n:
                continue
            if n == place:
                score = 100
            elif place in n or n in place:
                # weight by how much of the shorter string overlaps
                score = 40 + int(20 * min(len(n), len(place)) / max(len(n), len(place)))
            else:
                continue
            score += r["fs"] + (5 if r["ms"] else 0)
            if best is None or score > best[0]:
                best = (score, r["id"], r["name_he"] or r["name_en"])
    if best and best[0] >= 45:      # require a real match, not a 1-char coincidence
        return best[1], best[2]
    return None, None


def save(conn, destination_id, url, default_author, raw_text, items):
    """Persist approved insights, matched to attractions where possible.

    `items` = list of {place, kind, text_he, sentiment, author?}. Items are
    grouped by `author` (falling back to `default_author`) so each family/author
    becomes its OWN source row — keeping repetition across families as a
    consensus signal rather than collapsing it.
    Returns (source_ids, n_saved, n_matched)."""
    from collections import OrderedDict
    groups = OrderedDict()
    for it in items:
        author = (it.get("author") or default_author or "").strip() or None
        groups.setdefault(author, []).append(it)

    source_ids, n_saved, n_matched = [], 0, 0
    for author, group in groups.items():
        src = conn.execute(
            "INSERT INTO sources (destination_id, url, author, raw_text, created_at) "
            "VALUES (?,?,?,?,datetime('now')) RETURNING id",
            (destination_id, url or None, author, raw_text),
        ).fetchone()
        source_id = src["id"]
        source_ids.append(source_id)
        for it in group:
            aid, _ = match_attraction(conn, destination_id, it.get("place", ""))
            if aid:
                n_matched += 1
            conn.execute(
                "INSERT INTO insights (source_id, destination_id, attraction_id, "
                "place_name, kind, text_he, sentiment, status, weight, created_at) "
                "VALUES (?,?,?,?,?,?,?, 'approved', 1, datetime('now'))",
                (source_id, destination_id, aid, it.get("place") or None,
                 it.get("kind"), it.get("text_he"), it.get("sentiment")),
            )
            n_saved += 1
    conn.commit()
    return source_ids, n_saved, n_matched


def list_insights(conn, destination_id=None, limit=500):
    """Approved insights joined to attraction + source, newest first."""
    sql = (
        "SELECT i.*, a.name_he AS attr_he, a.name_en AS attr_en, "
        "       d.city AS dest_city, s.author AS src_author, s.url AS src_url "
        "FROM insights i "
        "LEFT JOIN attractions a ON i.attraction_id=a.id "
        "LEFT JOIN destinations d ON i.destination_id=d.id "
        "LEFT JOIN sources s ON i.source_id=s.id "
    )
    params = []
    if destination_id:
        sql += "WHERE i.destination_id=? "
        params.append(destination_id)
    sql += "ORDER BY i.id DESC LIMIT ?"
    params.append(limit)
    return conn.execute(sql, tuple(params)).fetchall()


def counts(conn):
    """(total insights, distinct destinations, distinct sources)."""
    row = conn.execute(
        "SELECT count(*) AS n, count(DISTINCT destination_id) AS d, "
        "count(DISTINCT source_id) AS s FROM insights"
    ).fetchone()
    return row["n"], row["d"], row["s"]


def delete_insight(conn, insight_id):
    conn.execute("DELETE FROM insights WHERE id=?", (insight_id,))
    conn.commit()
