# -*- coding: utf-8 -*-
"""Happenings — the unified 'what's on' model (extensibility keystone).

One normalized table holds EVERY kind of happening from EVERY source, with a
`temporal` shape so a one-night gig, a months-long musical run, a weekly market,
an annual holiday and a seasonal Christmas period all live side by side. Any
future connector (Ticketmaster / Bandsintown / curated exhibitions) just inserts
rows here; the matcher never changes.

This seeds London's curated tier (no API needed) + a few mock point-events.
"""
import datetime as dt
import json

import db

LONDON = 14
D = dt.date

# (title_he, kind, taste_tags, temporal, start, end, recur, venue, price, performers, source, sid)
ROWS = [
    # --- recurring markets (curated, no API) ---
    ("שוק קמדן", "market", ["vintage_shopping", "food"], "recurring", None, None, "weekly:0,1,2,3,4,5,6", "Camden", 0, [], "curated", "camden_market"),
    ("שוק בורו (אוכל)", "market", ["food"], "recurring", None, None, "weekly:0,1,2,3,4,5", "Borough", 0, [], "curated", "borough_market"),
    ("שוק פורטובלו רוד", "market", ["vintage_shopping"], "recurring", None, None, "weekly:4,5", "Notting Hill", 0, [], "curated", "portobello"),
    ("שוק בריק ליין", "market", ["vintage_shopping", "food"], "recurring", None, None, "weekly:6", "Brick Lane", 0, [], "curated", "brick_lane"),
    ("שוק הפרחים קולומביה רואד", "market", ["family", "nature"], "recurring", None, None, "weekly:6", "Columbia Road", 0, [], "curated", "columbia_flowers"),

    # --- annual observances (fixed date, recur every year) ---
    ("יום האהבה", "holiday", ["romantic"], "annual", None, None, "02-14", "רחבי העיר", 0, [], "curated", "valentines"),
    ("האלווין", "holiday", ["nightlife", "family"], "annual", None, None, "10-31", "רחבי העיר", 0, [], "curated", "halloween"),
    ("ליל המדורות (Bonfire Night)", "festival", ["culture", "family"], "annual", None, None, "11-05", "רחבי העיר", 0, [], "curated", "bonfire"),
    ("חג המולד", "holiday", ["holiday", "family"], "annual", None, None, "12-25", "רחבי העיר", 0, [], "curated", "christmas_day"),
    ("זיקוקי ראש השנה", "festival", ["culture", "nightlife"], "annual", None, None, "12-31", "London Eye", 0, [], "curated", "nye_fireworks"),

    # --- seasonal periods (annual date-range) ---
    ("שוקי חג המולד ותאורת חג", "seasonal", ["seasonal", "vintage_shopping", "food", "family"], "seasonal", None, None, "11-20..12-31", "רחבי העיר", 0, [], "curated", "xmas_markets"),
    ("וינטר וונדרלנד — הייד פארק", "seasonal", ["family", "seasonal"], "seasonal", None, None, "11-21..01-05", "Hyde Park", 0, [], "curated", "winter_wonderland"),
    ("קולנוע פתוח בקיץ", "seasonal", ["culture"], "seasonal", None, None, "06-01..08-31", "רחבי העיר", 0, [], "curated", "openair_cinema"),

    # --- floating annual (seed concrete dates per year; refresh yearly) ---
    ("פרייד לונדון 2027", "festival", ["culture", "nightlife"], "run", D(2027, 6, 26), D(2027, 7, 3), None, "רחבי העיר", 0, [], "curated", "pride_2027"),
    ("קרנבל נוטינג היל 2027", "festival", ["culture", "live_music"], "run", D(2027, 8, 28), D(2027, 8, 30), None, "Notting Hill", 0, [], "curated", "notting_hill_2027"),

    # --- mock point-events (swap for Ticketmaster/Bandsintown) ---
    ("מטאליקה — M72 World Tour", "music", ["live_music"], "point", D(2027, 2, 13), None, None, "The O2", 95, ["Metallica"], "mock", "tm_metallica"),
    ("ארסנל נגד צ׳לסי", "sports", ["sports"], "point", D(2027, 2, 15), None, None, "Emirates Stadium", 70, ["Arsenal"], "mock", "fx_arsenal"),
    ("אגם הברבורים (בלט)", "theatre", ["classical_opera"], "point", D(2027, 2, 14), None, None, "Royal Opera House", 120, [], "mock", "tm_swanlake"),
    ("ליל ג׳אז ב-Ronnie Scott's", "music", ["live_music", "nightlife"], "point", D(2027, 2, 12), None, None, "Soho", 45, [], "mock", "tm_ronnie"),

    # --- mock RUNS (residencies) — a musical that runs for months ---
    ("Hamilton", "theatre", ["theatre"], "run", D(2027, 1, 1), D(2027, 6, 30), None, "Victoria Palace, West End", 85, [], "mock", "tm_hamilton"),
    ("Wicked", "theatre", ["theatre"], "run", D(2027, 1, 1), D(2027, 12, 31), None, "Apollo Victoria, West End", 75, [], "mock", "tm_wicked"),
    ("ואן גוך — חוויה סוחפת", "art", ["art"], "run", D(2027, 1, 15), D(2027, 5, 30), None, "Seward Street", 25, [], "mock", "tm_vangogh"),
]


def main():
    c = db.get_conn()
    c.execute("""
        CREATE TABLE IF NOT EXISTS happenings (
          id serial PRIMARY KEY,
          destination_id integer REFERENCES destinations(id),
          title_he text, kind text, taste_tags jsonb,
          temporal text, start_date date, end_date date, recur text,
          venue text, lat double precision, lng double precision,
          price_from numeric, currency text DEFAULT 'GBP',
          url text, image_url text, performers jsonb,
          source text, source_id text,
          fetched_at timestamptz DEFAULT now(),
          UNIQUE(source, source_id)
        )""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_happ_dest ON happenings(destination_id)")
    c.execute("DELETE FROM happenings WHERE destination_id=? AND source IN ('curated','mock')", (LONDON,))
    for (title, kind, tags, temporal, s, e, recur, venue, price, perf, src, sid) in ROWS:
        c.execute(
            "INSERT INTO happenings (destination_id,title_he,kind,taste_tags,temporal,"
            "start_date,end_date,recur,venue,price_from,performers,source,source_id) "
            "VALUES (?,?,?,?::jsonb,?,?,?,?,?,?,?::jsonb,?,?)",
            (LONDON, title, kind, json.dumps(tags), temporal, s, e, recur, venue, price,
             json.dumps(perf), src, sid))
    c.commit()
    n = c.execute("SELECT count(*) FROM happenings WHERE destination_id=?", (LONDON,)).fetchone()[0]
    print(f"seeded {n} London happenings")
    from collections import Counter
    kinds = Counter(r["temporal"] for r in c.execute(
        "SELECT temporal FROM happenings WHERE destination_id=?", (LONDON,)).fetchall())
    print("by temporal shape:", dict(kinds))
    c.close()


if __name__ == "__main__":
    main()
