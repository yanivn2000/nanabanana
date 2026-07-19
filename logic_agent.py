# -*- coding: utf-8 -*-
"""logic_agent — the DB side of the AI-logic steps. NO Anthropic API calls.

A Claude session reads the spec in docs/logic/, `pull`s the work as JSON,
APPLIES the judgment itself, and `write`s the result back. This tool only reads
and writes the database.

  python3 logic_agent.py enrich   pull  <dest|all> [--limit N]   -> pending attractions
  python3 logic_agent.py enrich   write <file.json>
  python3 logic_agent.py audience pull  <dest|all> [--limit N]   -> top candidates (+iconic,+notes)
  python3 logic_agent.py audience write <file.json>
  python3 logic_agent.py matching pull  <dest>                   -> place mentions + shortlists
  python3 logic_agent.py matching write <file.json>

See docs/logic/README.md.
"""
import sys, json, re
sys.path.insert(0, "/Users/yanivnuriel/Documents/GitHub/AI/nanabanana")
import db

REPO = "/Users/yanivnuriel/Documents/GitHub/AI/nanabanana"


def _arg(name, default=None, cast=str):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def _dests(conn, target):
    if target == "all":
        return [r[0] for r in conn.execute(
            "SELECT DISTINCT destination_id FROM attractions WHERE quality_keep=1 ORDER BY destination_id").fetchall()]
    return [int(target)]


# ---------------- ENRICHMENT ----------------
PENDING = "enriched_at IS NULL AND (is_duplicate IS NULL OR is_duplicate=0)"

def enrich_pull(conn, target, limit):
    where = PENDING + (f" AND destination_id={int(target)}" if target != "all" else "")
    rows = conn.execute(
        f"SELECT id,name_en,category,subcategory,website FROM attractions WHERE {where} "
        f"ORDER BY (image_url IS NOT NULL) DESC, COALESCE(family_score,0) DESC LIMIT {limit}").fetchall()
    return [dict(id=r[0], name=r[1], category=r[2], subcategory=r[3], website=r[4] or "") for r in rows]

ENRICH_FIELDS = ["name_he", "family_score", "min_age", "max_age", "indoor_outdoor",
                 "quality_keep", "tips_he", "tagline_he", "best_season", "best_time_he",
                 "dress_he", "cost_level", "must_see"]

def enrich_write(conn, items):
    n = 0
    for it in items:
        conn.execute(
            "UPDATE attractions SET name_he=?, family_score=?, min_age=?, max_age=?, "
            "indoor_outdoor=?, quality_keep=?, tips_he=?, tagline_he=?, best_season=?, "
            "best_time_he=?, dress_he=?, cost_level=?, must_see=?, enriched_at=datetime('now') "
            "WHERE id=?",
            (it["name_he"], it["family_score"], it.get("min_age", 0), it.get("max_age", 99),
             it["indoor_outdoor"], 1 if it.get("quality_keep", True) else 0, it["tips_he"],
             it.get("tagline_he"), it.get("best_season"), it.get("best_time_he"),
             it.get("dress_he"), it.get("cost_level"), 1 if it.get("must_see") else 0, it["id"]))
        n += 1
    conn.commit()
    return n


# ---------------- AUDIENCE-FIT ----------------
def audience_pull(conn, target, limit):
    out = []
    for did in _dests(conn, target):
        rows = conn.execute("""
            SELECT a.id, COALESCE(a.name_he,a.name_en), a.category, a.family_score, a.tagline_he,
                   (CASE WHEN ep.rank IS NOT NULL THEN (ep.rank='must')::int ELSE COALESCE(a.must_see,0) END) AS eff_must
            FROM attractions a
            LEFT JOIN (SELECT attraction_id, COUNT(DISTINCT source_id) AS trav FROM insights
                       WHERE destination_id=%s AND status='approved' AND attraction_id IS NOT NULL
                       GROUP BY attraction_id) t ON t.attraction_id=a.id
            LEFT JOIN editor_picks ep ON ep.attraction_id=a.id AND ep.destination_id=a.destination_id
            WHERE a.destination_id=%s AND a.quality_keep=1 AND (a.is_duplicate IS NULL OR a.is_duplicate=0)
              AND (ep.rank IS NULL OR ep.rank <> 'no')
            ORDER BY COALESCE((ep.rank='must')::int,0) DESC, COALESCE((a.must_see=1)::int,0) DESC,
                     COALESCE(t.trav,0) DESC, COALESCE(a.family_score,0) DESC, (a.image_url IS NOT NULL) DESC
            LIMIT %s""", (did, did, limit)).fetchall()
        ids = [r[0] for r in rows]
        notes = {}
        if ids:
            ph = ",".join("%s" for _ in ids)
            for aid, text in conn.execute(
                f"SELECT attraction_id,text_he FROM insights WHERE status='approved' AND attraction_id IN ({ph})",
                tuple(ids)).fetchall():
                notes.setdefault(aid, []).append(text)
        for r in rows:
            out.append(dict(id=r[0], dest=did, name=r[1], category=r[2], iconic=bool(r[5]),
                            family_score=r[3] or 0, tagline=r[4] or "",
                            traveler_notes=" | ".join(x[:90] for x in notes.get(r[0], [])[:6])))
    return out

def audience_write(conn, items):
    n = 0
    for it in items:
        fit = json.dumps({"families": it["families"], "couples": it["couples"],
                          "friends": it["friends"], "type": it["type"], "why_he": it.get("why_he", "")},
                         ensure_ascii=False)
        conn.execute("UPDATE attractions SET audience_fit=?::jsonb WHERE id=?", (fit, it["id"]))
        n += 1
    conn.commit()
    return n


# ---------------- MATCHING (fuzzy shortlist; agent decides) ----------------
def _norm(s):
    return re.sub(r"[^a-z0-9א-ת ]", " ", (s or "").lower()).strip()
def _toks(s):
    return set(t for t in _norm(s).split() if len(t) >= 2)
def _bigrams(s):
    n = _norm(s).replace(" ", "")
    return set(n[i:i+2] for i in range(len(n)-1))
def _dice(a, b):
    return 2*len(a & b)/(len(a)+len(b)) if a and b else 0
def _jac(a, b):
    return len(a & b)/len(a | b) if a and b else 0

def matching_pull(conn, dest):
    atts = [dict(id=r[0], name_he=r[1] or "", name_en=r[2] or "") for r in conn.execute(
        "SELECT id,name_he,name_en FROM attractions WHERE destination_id=%s AND quality_keep=1 "
        "AND (is_duplicate IS NULL OR is_duplicate=0)", (dest,)).fetchall()]
    places = [r[0] for r in conn.execute(
        "SELECT DISTINCT place_name FROM insights WHERE destination_id=%s AND status='approved' "
        "AND place_name IS NOT NULL AND length(place_name)>=3", (dest,)).fetchall()]
    out = []
    for place in places:
        pN, pT, pB = _norm(place), _toks(place), _bigrams(place)
        scored = []
        for a in atts:
            s = 0
            for nm in (a["name_he"], a["name_en"]):
                nN = _norm(nm)
                if len(nN) < 4:
                    continue
                sub = min(len(nN), len(pN))/max(len(nN), len(pN)) if (nN in pN or pN in nN) else 0
                s = max(s, _jac(pT, _toks(nm)), _dice(pB, _bigrams(nm))*0.95, sub*0.9)
            if s >= 0.34:
                scored.append((s, a))
        scored.sort(key=lambda x: -x[0])
        out.append(dict(place=place, candidates=[dict(id=a["id"], name_he=a["name_he"], name_en=a["name_en"])
                                                 for _, a in scored[:10]]))
    return out

def matching_write(conn, items, dest):
    n = 0
    for it in items:
        conn.execute("UPDATE insights SET attraction_id=? WHERE destination_id=? AND place_name=?",
                     (it.get("id"), dest, it["place"]))
        n += conn.execute("SELECT 1").rowcount if False else 1
    conn.commit()
    return n


if __name__ == "__main__":
    domain, action = sys.argv[1], sys.argv[2]
    target = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].endswith(".json") else None
    limit = _arg("--limit", 70, int)
    conn = db.get_conn()
    if action == "pull":
        data = {"enrich": lambda: enrich_pull(conn, target, limit),
                "audience": lambda: audience_pull(conn, target, limit),
                "matching": lambda: matching_pull(conn, int(target))}[domain]()
        print(json.dumps(data, ensure_ascii=False, indent=1))
    elif action == "write":
        items = json.load(open(sys.argv[3]))
        if domain == "enrich":
            print(f"enriched {enrich_write(conn, items)} attractions")
        elif domain == "audience":
            print(f"scored {audience_write(conn, items)} attractions")
        elif domain == "matching":
            print(f"re-matched {matching_write(conn, items, int(target or 0))} place-groups")
    conn.close()
