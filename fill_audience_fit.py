# -*- coding: utf-8 -*-
# Fill audience_fit (+family_score if NULL) for must-sees missing it.
# Deterministic keyword classifier, hand-authored values, existing type vocabulary.
# Only touches rows where audience_fit IS NULL. usage: fill_audience.py [--apply]
import sys, json, re
sys.path.insert(0,'/Users/yanivnuriel/Documents/GitHub/AI/nanabanana')
import db
APPLY="--apply" in sys.argv

# (regex over name_en+name_he+category+subcategory) -> (type, families, couples, friends, fs, why_he)
RULES=[
 (r"water ?park|aqua ?park|aquarium|sea ?life|seaquarium|dolphinarium|zoo\b|jungle island|planetarium|sea lion|puppet|nickelodeon|dreamworks|dino |luna ?park|amusement|theme park|ferris|big snow|toy|fao schwarz|kinder|ילדים|לונה פארק|אקווריום|דולפינריום|גן החיות|פלנטריום|בובות",
   ("family",95,62,70,9,"אטרקציה כיפית במיוחד לילדים ולמשפחות")),
 (r"science|technology museum|natural history|מדע|הטבע|טכנולוגי",
   ("family",92,72,74,9,"מוזיאון חווייתי ואינטראקטיבי לכל המשפחה")),
 (r"cable car|funicular|teleferic|רכבל|פוניקולר",
   ("family",90,80,78,8,"נסיעה חווייתית עם נוף — אהוב על ילדים")),
 (r"beach|plage|spiaggia|praia|playa|חוף",
   ("outdoors",88,82,85,9,"חוף ים — שמש, מים ובילוי לכל קהל")),
 (r"cabaret|bangla|nightlife|קברט|חיי לילה",
   ("social",40,72,92,3,"בילוי ערב — מתאים בעיקר למבוגרים")),
 (r"winery|wine|יקב",
   ("romantic",35,92,85,2,"טעימות יין — חוויה למבוגרים")),
 (r"viewpoint|panorama|lookout|observation|skyline|summit|peak|cape |lighthouse|תצפית|מגדלור|פסגת|כף ",
   ("romantic",78,90,82,7,"נקודת תצפית מרהיבה — קסומה במיוחד בשקיעה")),
 (r"cave|grotto|gorge|canyon|waterfall|volcano|geyser|מערת|מערה|קניון|מפל|הר הגעש",
   ("outdoors",86,80,86,8,"פלא טבע — חוויה הרפתקנית לכולם")),
 (r"market|bazaar|souk|mercato|pescheria|בזאר|שוק",
   ("foodie",78,85,88,7,"שוק תוסס — טעמים, ריחות וצבעים")),
 (r"memorial|mausoleum|cemetery|holocaust|necropolis|catacomb|אנדרט|בית הקברות|מאוזוליאום|השואה|קטקומב|נקרופוליס",
   ("cultural",48,68,60,3,"אתר זיכרון מרגש ומעורר מחשבה")),
 (r"castle|fortress|fort |citadel|walls of|city walls|טירת|מצודת|מבצר|חומות",
   ("iconic",85,82,78,8,"מצודה היסטורית שילדים אוהבים לחקור")),
 (r"cathedral|basilica|duomo|minster|church|mosque|synagogue|temple|monastery|convent|chapel|shrine|pagoda|^wat |קתדרל|כנסיי|בזיליק|מסגד|בית הכנסת|מנזר|מקדש|פגוד|ואט ",
   ("cultural",55,80,65,4,"אתר דת ואדריכלות מרשים")),
 (r"opera|theatre|theater|teatro|teatr |concert|philharmon|אופרה|תיאטרון|קונצרט",
   ("cultural",55,86,70,4,"מקדש תרבות — פנים מפואר וסיורים")),
 (r"palace|palazzo|palais|villa |ארמון|וילה",
   ("cultural",72,85,72,6,"ארמון מפואר עם גנים ואולמות ראווה")),
 (r"museum|gallery|pinacoteca|collection|מוזיאון|גלרי|אוסף",
   ("cultural",60,84,72,5,"מוזיאון איכותי — אמנות והיסטוריה")),
 (r"park|garden|botanic|lagoon|lake|reserve|forest|island|oasis|פארק|גן |גני |לגונ|אגם|שמורת|יער|אי ",
   ("outdoors",86,78,76,8,"פינה ירוקה — מרחב, אוויר ומשחק")),
 (r"bay|cruise|boat|harbor|harbour|marina|port |מפרץ|שייט|מרינ|נמל",
   ("outdoors",84,88,84,8,"חוויית מים ונוף — הפלגה או טיילת")),
 (r"square|plaza|piazza|platz|street|quarter|old town|chinatown|bridge|gate|arch|fountain|promenade|pier|boulevard|כיכר|רחוב|רובע|העיר העתיקה|גשר|שער|מזרקת|טיילת|שדרת",
   ("universal",80,84,82,7,"לב העיר — אווירה, אנשים וצילומים")),
]
DEFAULT=("universal",72,80,76,6,"אתר מרכזי ששווה עצירה")

def classify(txt):
    t=txt.lower()
    for rx,val in RULES:
        if re.search(rx,t): return val
    return DEFAULT

c=db.get_conn()
rows=c.execute("""SELECT id,name_en,name_he,category,subcategory,family_score FROM attractions
  WHERE must_see=1 AND quality_keep IS DISTINCT FROM 0 AND (is_component IS NULL OR is_component=0)
    AND audience_fit IS NULL ORDER BY destination_id,id""").fetchall()
print(f"rows={len(rows)} apply={APPLY}")
from collections import Counter
cnt=Counter(); n_af=n_fs=0
for r in rows:
    txt=" ".join(filter(None,[r["name_en"],r["name_he"],r["category"],r["subcategory"]]))
    typ,fam,cpl,fr,fs,why=classify(txt)
    cnt[typ]+=1
    af={"type":typ,"why_he":why,"families":fam,"couples":cpl,"friends":fr}
    if APPLY:
        c.execute("UPDATE attractions SET audience_fit=%s WHERE id=%s",(json.dumps(af,ensure_ascii=False),r["id"])); n_af+=1
        if r["family_score"] is None:
            c.execute("UPDATE attractions SET family_score=%s WHERE id=%s",(fs,r["id"])); n_fs+=1
    else:
        if len(sys.argv)>1 and sys.argv[1]=="--sample": pass
print("type distribution:",dict(cnt))
if APPLY:
    c.commit(); print(f"updated audience_fit={n_af}, family_score={n_fs}")
else:
    # print 25 samples across the classification
    import itertools
    shown=set()
    for r in rows:
        txt=" ".join(filter(None,[r["name_en"],r["name_he"],r["category"],r["subcategory"]]))
        typ,fam,cpl,fr,fs,why=classify(txt)
        if cnt[typ] and typ not in shown or len(shown)<9:
            pass
    for r in rows[::max(1,len(rows)//30)]:
        txt=" ".join(filter(None,[r["name_en"],r["name_he"],r["category"],r["subcategory"]]))
        typ,fam,cpl,fr,fs,why=classify(txt)
        print(f"  [{typ:<9}] fam={fam} cpl={cpl} fs={fs}  {r['name_en'][:44]}")
c.close()
