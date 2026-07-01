"""Detect sub-attractions — components of a bigger venue (zoo animals,
theme-park rides, aquarium tanks, water-park slides) that were ingested as
standalone attractions.

A component is a GENERIC POI (subcategory='attraction') sitting inside a parent
venue (zoo / theme_park / water_park / aquarium). Places with a SPECIFIC
subcategory (museum, gallery, castle, viewpoint, park, memorial…) are never
flagged — so two important neighbours like the Van Gogh Museum and the Stedelijk
(both 'museum') are always safe, however close they are.

Reversible: hiding sets is_component=1; the consumer app skips those. Restore
sets it back to 0. Nothing is deleted.
"""
import math

import db

PARENT_SUBS = ("zoo", "theme_park", "water_park", "aquarium")


def _km(a, b, x, y):
    p = math.pi / 180
    dla = (x - a) * p
    dlo = (y - b) * p
    h = math.sin(dla / 2) ** 2 + math.cos(a * p) * math.cos(x * p) * math.sin(dlo / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def find_candidates(conn, radius_m=200):
    """Component candidates not yet hidden. Each is the component row plus
    parent_id / parent_name / parent_sub / distance_m (to the nearest parent)."""
    r_km = radius_m / 1000.0
    parents = conn.execute(
        "SELECT id, destination_id, name_he, name_en, subcategory, lat, lng "
        "FROM attractions WHERE subcategory = ANY(?) AND quality_keep=1 "
        "AND lat IS NOT NULL",
        (list(PARENT_SUBS),),
    ).fetchall()
    by_dest = {}
    for p in parents:
        by_dest.setdefault(p["destination_id"], []).append(p)
    parent_ids = {p["id"] for p in parents}

    rows = conn.execute(
        "SELECT id, destination_id, name_he, name_en, subcategory, lat, lng, "
        "COALESCE(family_score,0) AS fs, COALESCE(must_see,0) AS ms, image_url "
        "FROM attractions WHERE subcategory='attraction' AND quality_keep=1 "
        "AND (is_component IS NULL OR is_component=0) AND lat IS NOT NULL",
    ).fetchall()

    out = []
    for a in rows:
        if a["id"] in parent_ids:
            continue
        best = None
        for p in by_dest.get(a["destination_id"], []):
            d = _km(a["lat"], a["lng"], p["lat"], p["lng"])
            if d <= r_km and (best is None or d < best[1]):
                best = (p, d)
        if best:
            p, d = best
            out.append({
                "id": a["id"], "name_he": a["name_he"], "name_en": a["name_en"],
                "must_see": a["ms"], "image_url": a["image_url"],
                "parent_id": p["id"], "parent_name": p["name_he"] or p["name_en"],
                "parent_sub": p["subcategory"], "distance_m": int(d * 1000),
            })
    return out


def hide(conn, ids):
    if not ids:
        return 0
    conn.execute("UPDATE attractions SET is_component=1 WHERE id = ANY(?)", (list(ids),))
    conn.commit()
    return len(ids)


def restore(conn, ids):
    if not ids:
        return 0
    conn.execute("UPDATE attractions SET is_component=0 WHERE id = ANY(?)", (list(ids),))
    conn.commit()
    return len(ids)


def hidden_count(conn):
    return conn.execute(
        "SELECT count(*) FROM attractions WHERE is_component=1").fetchone()[0]


def list_hidden(conn, limit=1000):
    return conn.execute(
        "SELECT id, name_he, name_en FROM attractions "
        "WHERE is_component=1 ORDER BY name_he LIMIT ?", (limit,)).fetchall()
