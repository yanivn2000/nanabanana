"""Mark the floodlit icons — shut after dark, but worth walking past.

The owner's case: "קולוסיאום מקסים בערב לילה לצילום... אבל הוא סגור אז רק לעבור
דרכו". attractions.time_of_day already says these are daytime places, which is
right for a VISIT. night_passby says the outside is still worth a stop.

Hand-picked, not swept. A regex over must-see landmarks returns 206 rows, and
most are neither floodlit nor icons. Two hard rules:
  - NO memorials. A Holocaust memorial as a night photo stop is exactly the
    thing the owner objected to in the first place.
  - Only places whose EXTERIOR is the attraction after dark: a lit facade, a
    dome, a bridge, a fountain show, a castle on a hill.

Usage:  .venv/bin/python scripts/seed_night_passby.py [--apply]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402

# destination_id → exact name_he values
ICONS: dict[int, list[str]] = {
    1: ["קתדרלת סנט סטפן"],                                     # וינה
    3: ["הקולוסיאום", "טירת סנט אנג'לו", "מזרקת ארבעת הנהרות",
        "כיפת כנסיית פטרוס הקדוש"],                              # רומא
    4: ["האקרופוליס באתונה", "מקדש זאוס האולימפי",
        "תצפית פנורמית על האקרופוליס, אתונה"],                   # אתונה
    5: ["מבנה הפרלמנט ההונגרי", "ארמון בודה", "בזיליקת סנט אישטוון",
        "כנסיית מתיאס", "טירת ויידהוניאד"],                      # בודפשט
    6: ["ארמון פראג — הרדצ'ין", "כנסיית מרים לפני טין",
        "תצפית גשר קארל והטירה"],                                # פראג
    7: ["המזרקה הקסומה של מונז'ואיק"],                            # ברצלונה
    8: ["הארמון המלכותי"],                                       # אמסטרדם
    9: ["שער ברנדנבורג", "קתדרלת ברלין",
        "מגדל הטלוויזיה של ברלין – פרנזטורם"],                    # ברלין
    10: ["המגדל הלבן של תסלוניקי"],                               # סלוניקי
    14: ["מגדל לונדון", "קתדרלת סנט פול"],                        # לונדון
    15: ["מגדל אייפל", "שער הניצחון", "קתדרלת נוטר-דאם פריז",
         "בזיליקת סקרה קר", "האופרה גרנייה"],                     # פריז
    16: ["מגדל בלם", "טירת סאו ז'ורז'", "אנדרטת הגילויים"],       # ליסבון
    17: ["ארמון המלוכה של מדריד"],                                # מדריד
    19: ["בזיליקת סן מרקו", "ארמון הדוג'ה"],                      # ונציה
    20: ["קתדרלת סנטה מריה דל פיורה — פירנצה", "כיפת ברונלסקי"],  # פירנצה
    21: ["פראוונקירכה — קתדרלת מינכן"],                           # מינכן
    29: ["טירת ואוול", "שער פלוריאן", "כנסיית מריה הקדושה"],      # קרקוב
    30: ["קתדרלת פורטו", "מגדל הכמרים"],                          # פורטו
    35: ["מזרקת סילון המים"],                                     # ז'נבה
    36: ["הטירה המלכותית בוורשה"],                                # ורשה
    37: ["קתדרלת אלכסנדר נבסקי"],                                 # סופיה
    38: ["מזרקת דובאי"],                                          # דובאי
    39: ["מקדש השחר"],                                            # בנגקוק
    40: ["מגדל טוקיו"],                                           # טוקיו
    48: ["בית האופרה בקופנהגן"],                                  # קופנהגן
    49: ["קתדרלת זאגרב"],                                         # זאגרב
    50: ["קתדרלת דוברובניק", "שער פּילֶה"],                        # דוברובניק
    54: ["האובליסק של בואנוס איירס"],                             # בואנוס איירס
    56: ["ארמון גיונגבוקגונג", "מגדל סיאול"],                     # סיאול
    61: ["מקדש סווטי סאבה"],                                      # בלגרד
}
PASSBY_MIN = 20   # a photo stop, not a visit


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    conn = db.get_conn()

    hits, misses = [], []
    for dest, names in ICONS.items():
        for nm in names:
            row = conn.execute(
                "SELECT id, name_he, category FROM attractions"
                " WHERE destination_id = %s AND name_he = %s"
                "   AND quality_keep IS DISTINCT FROM 0"
                "   AND (is_duplicate IS NULL OR is_duplicate = 0)", (dest, nm)
            ).fetchall()
            # Sofia has two rows named "קתדרלת אלכסנדר נבסקי" (the cathedral and
            # its crypt museum) — when a name is ambiguous, the must-see is the one
            # travellers mean.
            best = [r for r in row if r[1] and (len(row) == 1 or r[2] != "museum")]
            if len(row) == 1 or len(best) == 1:
                hits.append((best or row)[0][0])
            else:
                misses.append(f"[{dest}] {nm} → {len(row)} שורות")

    print(f"נמצאו {len(hits)} אייקונים · לא נמצאו {len(misses)}")
    for m in misses:
        print("   ⚠️", m)
    if not args.apply:
        print("\n(יבש — הרץ עם --apply לכתיבה)")
        return
    conn.execute("UPDATE attractions SET night_passby = false WHERE night_passby")
    conn.execute(
        "UPDATE attractions SET night_passby = true,"
        " passby_minutes = COALESCE(passby_minutes, %s) WHERE id = ANY(%s)", (PASSBY_MIN, hits)
    )
    conn.commit()
    print(f"סומנו {len(hits)}")


if __name__ == "__main__":
    main()
