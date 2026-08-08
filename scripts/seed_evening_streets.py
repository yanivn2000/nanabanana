"""Mark the streets that are actually alive after dinner (streets.evening).

The evening slot only fires for no-kids trips, and only from a curated street —
so a city without this layer ends every couples day with dessert. 37 of 65 cities
had none, including Berlin, New York, Milan, Copenhagen and Porto.

Hand-picked per city, from the streets already in the DB. The test is narrow and
literal: WOULD A COUPLE WALK HERE AT 21:30 AND FIND IT ALIVE? A famous shopping
street that shutters at 19:00 (Fifth Avenue, Zeil, Bahnhofstrasse) fails it; a
bar lane, a restaurant square or a lit waterfront passes. Cities where no listed
street passes are left alone — Tokyo's three streets are all daytime shopping,
and a wrong evening pick sends couples to a closed arcade.

Usage:  .venv/bin/python scripts/seed_evening_streets.py [--apply]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402

# city_he → exact streets.name_he values
EVENING: dict[str, list[str]] = {
    "ברלין":     ["אורניינשטראסה", "סימון-דאך-שטראסה", "האקשר מרקט"],
    "ניו יורק":  ["רחוב מקדוגל", "רחוב בליקר", "סנט מרקס פלייס"],
    "מילאנו":    ["אלצאיה נאוויליו גראנדה", "קורסו קומו", "ויה בררה"],
    "פורטו":     ["רחוב קנדידו דוש רייש", "רחוב הפרחים", "טיילת הריביירה"],
    "קופנהגן":   ["ניוהאבן", "גראברודרטורב", "איסטדגאדה"],
    "זלצבורג":   ["שטיינגאסה", "גטריידגאסה", "טיילת נהר הזלצאך"],
    "ציריך":     ["נידרדורפשטראסה", "לאנגשטראסה", "לימאטקוואי"],
    "פרנקפורט":  ["ברגר שטראסה", "שווייצר שטראסה"],
    "בוקרשט":    ["סטרדה ליפסקאני", "סטרדה סמרדן", "קאלאה ויקטוריאי"],
    "טביליסי":   ["רחוב שארדני", "רחוב קוטה אפחזי", "שדרות רוסתאבלי"],
    "מיאמי":     ["אושן דרייב", "לינקולן רואד", "אספניולה ווי"],
    "דוברובניק": ["סטראדוּן", "פּרייֶקו"],
    "תסלוניקי":  ["רחוב נווארחו ווטסי", "כיכר אריסטוטלוס"],
    "רודוס":     ["רחוב סוקרטוס", "אקטי מיאולי"],
    "בראשוב":    ["רחוב רפובליצ'י", "כיכר המועצה"],
    "כרתים":     ["רחוב 25 באוגוסט", "טיילת הנמל הוונציאני חאניה"],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    conn = db.get_conn()

    hits, misses = [], []
    for city, names in EVENING.items():
        for nm in names:
            row = conn.execute(
                "SELECT s.id FROM streets s JOIN destinations d ON d.id = s.destination_id"
                " WHERE d.city_he = %s AND s.name_he = %s", (city, nm)).fetchall()
            if len(row) == 1:
                hits.append(row[0][0])
            else:
                misses.append(f"{city} · {nm} → {len(row)} שורות")

    print(f"{len(hits)} רחובות יסומנו כרחובות-ערב ב-{len(EVENING)} ערים")
    for m in misses:
        print("   ⚠️", m)
    if not args.apply:
        print("\n(יבש — הרץ עם --apply לכתיבה)")
        return
    conn.execute("UPDATE streets SET evening = true WHERE id = ANY(%s)", (hits,))
    conn.commit()
    n = conn.execute("SELECT count(DISTINCT destination_id) FROM streets WHERE evening IS TRUE").fetchone()[0]
    print(f"\nסומנו {len(hits)} · לשכבת ערב יש עכשיו {n} ערים")


if __name__ == "__main__":
    main()
