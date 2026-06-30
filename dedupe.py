"""De-duplicate attractions.

OSM often has several rows for one real place (a bridge as a way + viewpoint
nodes, etc.), and enrichment gives them slightly different Hebrew names — so
naive name dedup misses them. Two reliable signals:

1. Same Wikidata id  -> same real-world entity (100% reliable).
2. No wikidata: very close coordinates + same category + near-identical name.

The lower-value row in each cluster is flagged is_duplicate=1 (reversible —
nothing is deleted). Re-runnable: resets the flag each run.
"""
import json
import re
from difflib import SequenceMatcher
from math import radians, sin, cos, atan2, sqrt

import db


def _haversine_m(a, b):
    R = 6371000
    dlat = radians(b[0] - a[0]); dlng = radians(b[1] - a[1])
    h = sin(dlat / 2) ** 2 + cos(radians(a[0])) * cos(radians(b[0])) * sin(dlng / 2) ** 2
    return R * 2 * atan2(sqrt(h), sqrt(1 - h))


def _wikidata(info_sources):
    if not info_sources:
        return None
    try:
        for s in db.jloads(info_sources):
            if s.get("title") == "Wikidata":
                return s["url"].rstrip("/").split("/")[-1]
    except Exception:
        pass
    return None


def _norm(name):
    return re.sub(r"\s+", " ", re.sub(r"[^\w֐-׿ ]", "", (name or ""))).strip().lower()


def _score(r):
    """Higher = better canonical (keep this one)."""
    s = 0
    if r["enriched_at"]: s += 100
    if r["image_url"]: s += 50
    if r["tagline_he"]: s += 20
    if r["quality_keep"] == 1: s += 10
    s += (r["family_score"] or 0)
    s += len(r["name_he"] or "") * 0.1
    return s


def dedupe(progress=None):
    db.init_db()
    conn = db.get_conn()
    conn.execute("UPDATE attractions SET is_duplicate=0")
    conn.commit()

    rows = conn.execute(
        "SELECT id, destination_id, name_he, name_en, lat, lng, category, "
        "info_sources, image_url, family_score, tagline_he, quality_keep, enriched_at "
        "FROM attractions WHERE lat IS NOT NULL AND lng IS NOT NULL"
    ).fetchall()

    clusters = []  # each = list of rows that are the same place

    # --- pass 1: group by Wikidata id ---
    by_wd = {}
    no_wd = []
    for r in rows:
        wd = _wikidata(r["info_sources"])
        if wd:
            by_wd.setdefault(wd, []).append(r)
        else:
            no_wd.append(r)
    clusters.extend([g for g in by_wd.values() if len(g) > 1])

    # --- pass 2: no-wikidata rows — proximity + same category + similar name ---
    # bucket by destination + rounded coords (~110m cells) to keep it cheap
    buckets = {}
    for r in no_wd:
        key = (r["destination_id"], round(r["lat"], 3), round(r["lng"], 3))
        buckets.setdefault(key, []).append(r)
    for items in buckets.values():
        used = set()
        for i in range(len(items)):
            if items[i]["id"] in used:
                continue
            group = [items[i]]
            for j in range(i + 1, len(items)):
                if items[j]["id"] in used:
                    continue
                a, b = items[i], items[j]
                if a["category"] != b["category"]:
                    continue
                if _haversine_m((a["lat"], a["lng"]), (b["lat"], b["lng"])) > 60:
                    continue
                na, nb = _norm(a["name_he"] or a["name_en"]), _norm(b["name_he"] or b["name_en"])
                if na and nb and (na in nb or nb in na or SequenceMatcher(None, na, nb).ratio() >= 0.82):
                    group.append(b); used.add(b["id"])
            if len(group) > 1:
                used.add(items[i]["id"])
                clusters.append(group)

    # --- flag all but the best in each cluster ---
    dup_ids = []
    for group in clusters:
        canonical = max(group, key=_score)
        for r in group:
            if r["id"] != canonical["id"]:
                dup_ids.append(r["id"])

    for did in dup_ids:
        conn.execute("UPDATE attractions SET is_duplicate=1 WHERE id=?", (did,))
    conn.commit()
    total = conn.execute("SELECT count(*) FROM attractions").fetchone()[0]
    conn.close()
    if progress:
        progress(len(dup_ids), total)
    return {"clusters": len(clusters), "duplicates_flagged": len(dup_ids), "total": total}


if __name__ == "__main__":
    print(dedupe())
