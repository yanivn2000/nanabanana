"""NanaBanana — trip planner. Stage 1: data explorer + OSM ingest."""
import json
import os
import subprocess
import sys
import time
import streamlit as st
import folium
from streamlit_folium import st_folium

import db
import pipeline_osm
import enrich
import pipeline_images
import dedupe
import tickets

st.set_page_config(page_title="NanaBanana", page_icon="🍌", layout="wide")

# Marker colour per category (folium named colours)
CAT_COLOR = {
    "nature": "green",
    "museum": "blue",
    "attraction": "red",
    "sport": "orange",
    "food": "purple",
    "shopping": "pink",
}
CAT_LABEL_HE = {
    "nature": "טבע", "museum": "מוזיאון", "attraction": "אטרקציה",
    "sport": "ספורט", "food": "אוכל", "shopping": "קניות",
    "tourism": "תיירות", "leisure": "פנאי", "historic": "היסטורי",
}
db.init_db()

st.title("🍌 NanaBanana — ניהול מאגר")

# Pipeline overview + live funnel. Gives an at-a-glance picture of the whole
# data flow so it's clear what each tab does and where the data stands.
_oc = db.get_conn()
_o = {
    "dests": _oc.execute("SELECT count(*) FROM destinations").fetchone()[0],
    "attr": _oc.execute("SELECT count(*) FROM attractions").fetchone()[0],
    "img": _oc.execute("SELECT count(*) FROM attractions WHERE image_url IS NOT NULL").fetchone()[0],
    "enriched": _oc.execute("SELECT count(*) FROM attractions WHERE enriched_at IS NOT NULL").fetchone()[0],
    "kept": _oc.execute("SELECT count(*) FROM attractions WHERE quality_keep=1").fetchone()[0],
}
_oc.close()
st.caption(
    "צינור העבודה: **1) איסוף** ערים מ-OpenStreetMap ← **2) תמונות** מ-Wikipedia ← "
    "**3) העשרה** עם Claude (תרגום, ציון, סינון) ← **4) ניקוי כפילויות**. "
    "כל שלב בטאב נפרד למטה.")
o1, o2, o3, o4, o5 = st.columns(5)
o1.metric("יעדים", f"{_o['dests']:,}", help="ערים במאגר.")
o2.metric("אטרקציות", f"{_o['attr']:,}",
          help="כל המקומות שנקלטו מ-OpenStreetMap — לפני סינון איכות.")
o3.metric("עם תמונה", f"{_o['img']:,}",
          help="אטרקציות שנמשכה להן תמונה מ-Wikipedia/Wikidata.")
o4.metric("הועשרו", f"{_o['enriched']:,}",
          help="עובדו ע\"י Claude: תרגום לעברית, ציון משפחתי, טיפ וסינון keep/skip.")
o5.metric("עברו סינון", f"{_o['kept']:,}",
          help="אטרקציות אמיתיות ששווה להציג (quality_keep=1) — אלה שהמשתמש רואה באפליקציה.")
st.divider()

# Seed list of popular Israeli destinations (city, country, lat, lng)
SEED_CITIES = {
    "Salzburg": ("Austria", 47.8095, 13.0550),
    "Vienna": ("Austria", 48.2082, 16.3738),
    "Prague": ("Czechia", 50.0755, 14.4378),
    "Budapest": ("Hungary", 47.4979, 19.0402),
    "Rome": ("Italy", 41.9028, 12.4964),
    "Athens": ("Greece", 37.9838, 23.7275),
    "Tbilisi": ("Georgia", 41.7151, 44.8271),
}

tab_browse, tab_ingest, tab_enrich, tab_tickets, tab_settings = st.tabs(
    ["🔍 דפדוף בנתונים", "⬇️ איסוף מ-OpenStreetMap", "✨ העשרה עם Claude",
     "🎫 בקשות פיתוח", "⚙️ הגדרות"])

with tab_tickets:
    st.subheader("🎫 בקשות פיתוח")
    st.caption(
        "פתחו בקשה — באג, פיצ'ר, רעיון או עיצוב. אפשר לצרף תמונות וטקסט חופשי. "
        "לכל בקשה יינתן מספר טיקט; תנו אותו למפתח (דרך Claude Code) והוא ימשוך את הבקשה לדיון.")

    TICKET_TYPES = {"bug": "באג 🐞", "feature": "פיצ'ר ✨", "idea": "רעיון 💡", "design": "עיצוב 🎨"}

    with st.form("new_ticket", clear_on_submit=True):
        tc1, tc2 = st.columns([1, 2])
        ttype = tc1.selectbox("סוג", list(TICKET_TYPES.keys()), format_func=lambda k: TICKET_TYPES[k])
        ttitle = tc2.text_input("כותרת קצרה")
        tbody = st.text_area("תיאור — מה להוסיף / לתקן, איך זה אמור לעבוד, באיזה מסך…", height=140)
        tfiles = st.file_uploader("תמונות (לא חובה)",
                                  type=["png", "jpg", "jpeg", "webp", "gif"],
                                  accept_multiple_files=True)
        tsubmit = st.form_submit_button("פתח טיקט", type="primary")
    if tsubmit:
        if not ttitle.strip() and not tbody.strip():
            st.warning("הוסיפו לפחות כותרת או תיאור.")
        else:
            imgs = [(f.name, f.getvalue()) for f in (tfiles or [])]
            tid = tickets.create_ticket(ttype, ttitle.strip(), tbody.strip(), imgs)
            st.success(f"נפתח טיקט #{tid} ✓ — מסרו את המספר הזה למפתח.")

    st.divider()
    fcol1, fcol2 = st.columns([1, 3])
    status_filter = fcol1.selectbox("סינון", ["הכל", "פתוחים", "בוצעו"])
    status_map = {"הכל": None, "פתוחים": "open", "בוצעו": "done"}
    ticket_rows = tickets.list_tickets(status_map[status_filter])
    st.caption(f"{len(ticket_rows)} טיקטים")

    for t in ticket_rows:
        done = t["status"] == "done"
        label = (f"#{t['id']} · {TICKET_TYPES.get(t['type'], t['type'])} · "
                 f"{t['title'] or '(ללא כותרת)'} · {'✅ בוצע' if done else '🟠 פתוח'}")
        with st.expander(label):
            st.caption(t["created_at"])
            if t["body"]:
                st.write(t["body"])
            imgs = tickets.image_paths(t)
            if imgs:
                icols = st.columns(min(len(imgs), 3))
                for i, p in enumerate(imgs):
                    try:
                        icols[i % len(icols)].image(p, width=260)
                    except Exception:
                        icols[i % len(icols)].caption(p)
            bc1, bc2, _ = st.columns([1, 1, 3])
            if done:
                if bc1.button("פתח מחדש", key=f"reopen{t['id']}"):
                    tickets.set_status(t["id"], "open"); st.rerun()
            else:
                if bc1.button("סמן כבוצע", key=f"done{t['id']}"):
                    tickets.set_status(t["id"], "done"); st.rerun()
            if bc2.button("מחק", key=f"del{t['id']}"):
                tickets.delete_ticket(t["id"]); st.rerun()

# Available Claude models (id -> Hebrew label). Shared by both apps via DB.
MODELS = {
    "claude-opus-4-8": "Opus 4.8 — הכי חכם (מומלץ)",
    "claude-opus-4-7": "Opus 4.7",
    "claude-sonnet-4-6": "Sonnet 4.6 — מהיר וזול יותר",
    "claude-haiku-4-5": "Haiku 4.5 — הכי זול ומהיר",
    "claude-fable-5": "Fable 5 — הכי חזק (יקר)",
}

with tab_settings:
    st.subheader("הגדרות AI")
    _sconn = db.get_conn()
    current_model = db.get_model(_sconn)
    ids = list(MODELS.keys())
    if current_model not in ids:
        ids = [current_model] + ids
    idx = ids.index(current_model)
    chosen = st.selectbox(
        "מודל הבינה (משפיע על האפליקציה ועל ההעשרה)",
        ids, index=idx,
        format_func=lambda m: MODELS.get(m, m))
    st.caption(f"מודל נוכחי: `{current_model}`")
    if chosen != current_model:
        if st.button("שמור מודל", type="primary"):
            db.set_setting(_sconn, "model", chosen)
            st.success(f"נשמר: {MODELS.get(chosen, chosen)}. משפיע על שתי האפליקציות מיד.")
            st.rerun()
    _sconn.close()
    st.divider()
    st.caption("המודל נשמר במאגר המשותף — האפליקציה הצרכנית קוראת אותו בכל בקשה, ללא צורך בפריסה מחדש.")

    st.divider()
    st.subheader("ניקוי כפילויות")
    _dconn = db.get_conn()
    dup_now = _dconn.execute(
        "SELECT count(*) FROM attractions WHERE is_duplicate = 1").fetchone()[0]
    _dconn.close()
    st.metric("מסומנות ככפילות (מוסתרות)", f"{dup_now:,}")
    st.caption("מזהה כפילויות לפי מזהה Wikidata משותף + קרבה גאוגרפית ושם דומה. הפיך — לא מוחק.")
    if st.button("הרץ ניקוי כפילויות"):
        with st.spinner("מנקה..."):
            res = dedupe.dedupe()
        st.success(f"נמצאו {res['clusters']} קבוצות · {res['duplicates_flagged']} כפילויות הוסתרו")

with tab_ingest:
    st.subheader("➕ הוסף עיר חדשה לפי שם")
    st.caption("הקלידו שם עיר חופשי — נאתר אותה ב-OpenStreetMap ונמשוך את האטרקציות. אחרי זה כדאי להריץ 'משיכת תמונות' ו'העשרה'.")
    nc1, nc2, nc3 = st.columns([2, 2, 1])
    with nc1:
        new_city = st.text_input("שם העיר", placeholder="למשל: Lisbon")
    with nc2:
        new_city_he = st.text_input("שם בעברית (לא חובה)", placeholder="למשל: ליסבון")
    with nc3:
        new_radius = st.slider("רדיוס (ק\"מ)", 5, 30, 12, key="newcity_radius")
    if st.button("אתר והוסף עיר", type="primary", disabled=not new_city.strip()):
        with st.spinner(f"מאתר את {new_city}..."):
            try:
                geo = pipeline_osm.geocode_city(new_city.strip())
            except Exception as e:
                geo = None
                st.error(f"שגיאת איתור: {e}")
        if geo is None:
            st.warning("לא מצאנו את העיר — נסו שם מדויק יותר (למשל: Lisbon, Portugal).")
        else:
            st.info(f"נמצא: **{geo['city']}, {geo['country']}** · ({geo['lat']:.4f}, {geo['lng']:.4f})")
            with st.spinner(f"מושך אטרקציות מ-{geo['city']}..."):
                res = pipeline_osm.fetch_city(
                    geo["city"], geo["country"], geo["lat"], geo["lng"], radius_km=new_radius)
            # Hebrew display names: user override → known dict → leave as-is.
            _c = db.get_conn()
            he = new_city_he.strip() or db.CITY_HE.get(geo["city"])
            country_he = db.COUNTRY_HE.get(geo["country"])
            _c.execute(
                "UPDATE destinations SET city_he=COALESCE(?, city_he), "
                "country_he=COALESCE(?, country_he) WHERE city=? AND country=?",
                (he, country_he, geo["city"], geo["country"]))
            _c.commit()
            _c.close()
            st.success(
                f"נוספה **{he or geo['city']}** · נמצאו {res['found']} · "
                f"נוספו {res['inserted']} · כפילויות {res['skipped']}")
            if not he:
                st.caption("טיפ: לא נמצא שם עברי אוטומטי — הוסיפו אותו בשדה למעלה כדי שיוצג יפה באפליקציה.")

    st.divider()
    st.subheader("משיכת אטרקציות מ-OpenStreetMap (ערים מוכרות)")
    col1, col2, col3 = st.columns([2, 1, 1])
    with col1:
        city = st.selectbox("עיר", list(SEED_CITIES.keys()))
    with col2:
        radius = st.slider("רדיוס (ק\"מ)", 5, 30, 12)
    with col3:
        st.write("")
        st.write("")
        go = st.button("התחל איסוף", type="primary")
    if go:
        country, lat, lng = SEED_CITIES[city]
        with st.spinner(f"מושך אטרקציות מ-{city}..."):
            res = pipeline_osm.fetch_city(city, country, lat, lng, radius_km=radius)
        st.success(f"נמצאו {res['found']} · נוספו {res['inserted']} · כפילויות {res['skipped']}")

    st.divider()
    st.subheader("משיכת תמונות מ-Wikipedia")
    st.caption(
        "תמונות נמשכות **רק** מאטרקציות שיש להן קישור Wikipedia/Wikidata (נשמר בזמן "
        "הקליטה מ-OSM). \"ממתינות\" = יש קישור אך עוד לא נבדק; אחרי בדיקה מסומן כ\"נבדק\" "
        "(גם אם לא נמצאה תמונה). חינם, ללא מפתח. המשיכה לפי ציון משפחתי — המקומות החשובים קודם.")

    _iconn = db.get_conn()
    img_pending = pipeline_images.pending_count(_iconn)
    img_have = _iconn.execute(
        "SELECT count(*) FROM attractions WHERE image_url IS NOT NULL").fetchone()[0]
    # Per-city coverage — surfaces exactly which cities still need images.
    city_rows = _iconn.execute(
        "SELECT d.id, COALESCE(d.city_he, d.city) AS city, COUNT(*) AS total, "
        "SUM((a.image_url IS NOT NULL)::int) AS with_img, "
        f"SUM(({pipeline_images._PENDING_WHERE})::int) AS pending "
        "FROM attractions a JOIN destinations d ON a.destination_id=d.id "
        "GROUP BY d.id ORDER BY pending DESC, total DESC").fetchall()
    _iconn.close()

    ic1, ic2 = st.columns(2)
    ic1.metric("ממתינות לבדיקת תמונה (סה\"כ)", f"{img_pending:,}",
               help="יש קישור Wikipedia/Wikidata אך עוד לא נבדק. אחרי בדיקה מסומן "
                    "כ'נבדק' (image_checked_at) גם אם לא נמצאה תמונה, כדי לא לבדוק שוב.")
    ic2.metric("עם תמונה (סה\"כ)", f"{img_have:,}",
               help="אטרקציות שנמצאה ונשמרה להן תמונה.")

    # Coverage table: city, total, with image, % covered, pending.
    table = [{
        "עיר": r["city"],
        "סה\"כ": r["total"],
        "עם תמונה": r["with_img"] or 0,
        "כיסוי": f"{round(100 * (r['with_img'] or 0) / r['total'])}%" if r["total"] else "—",
        "ממתינות": r["pending"] or 0,
    } for r in city_rows]
    st.dataframe(table, hide_index=True, use_container_width=True)

    # Optional focus: only fetch for one city (new cities rank below old ones globally).
    pending_cities = [r for r in city_rows if (r["pending"] or 0) > 0]
    focus_opts = {"כל הערים": None}
    focus_opts.update({f"{r['city']} ({r['pending']} ממתינות)": r["id"] for r in pending_cities})
    fc1, fc2 = st.columns([2, 1])
    with fc1:
        focus_label = st.selectbox("התמקד בעיר (לא חובה)", list(focus_opts.keys()))
    with fc2:
        img_limit = st.slider("כמה לבדוק בהרצה", 20, 500, 200, step=20)
    focus_id = focus_opts[focus_label]
    if st.button("משוך תמונות", type="primary", disabled=img_pending == 0):
        ibar = st.progress(0.0, text="מושך תמונות...")
        res = pipeline_images.fetch_images(
            limit=img_limit, destination_id=focus_id,
            progress=lambda d, t: ibar.progress(d / t if t else 1.0, text=f"נבדקו {d}/{t}"))
        st.success(f"נבדקו {res['checked']} · נמצאו {res['found']} תמונות")
        st.rerun()

with tab_enrich:
    st.subheader("העשרה עם Claude — תרגום, ציון משפחתי, סינון איכות")
    conn = db.get_conn()
    pending = enrich.pending_count(conn)
    enriched = conn.execute(
        "SELECT count(*) FROM attractions WHERE enriched_at IS NOT NULL").fetchone()[0]
    kept = conn.execute(
        "SELECT count(*) FROM attractions WHERE quality_keep=1").fetchone()[0]
    conn.close()

    filtered_out = enriched - kept

    e1, e2, e3, e4 = st.columns(4)
    e1.metric("ממתינות להעשרה", f"{pending:,}",
              help="אטרקציות שעוד לא עברו עיבוד של Claude (לא כולל כפילויות מוסתרות).")
    e2.metric("הועשרו", f"{enriched:,}",
              help="כל אטרקציה ש-Claude עיבד: תרגם לעברית, נתן ציון משפחתי, טיפ ותגית, "
                   "וקבע אם היא שווה הצגה. כולל גם את אלה שנדחו בסינון.")
    e3.metric("עברו סינון איכות", f"{kept:,}",
              help="תת-קבוצה של 'הועשרו' — אלה ש-Claude שפט כאטרקציה משפחתית אמיתית "
                   "(quality_keep=1). רק אלה (יחד עם מקומות שטרם הועשרו) מוצגים באפליקציה.")
    e4.metric("נדחו בסינון", f"{filtered_out:,}",
              help="הועשרו אבל סומנו כלא-רלוונטיים (אנדרטאות, לוחות זיכרון, שלטים, פסלים "
                   "זניחים). מוסתרים מהאפליקציה — לא נמחקים, הפיך.")

    st.caption(
        "**הקשר:** 'הועשרו' = כל מה ש-Claude עיבד. בכל עיבוד הוא מסמן keep/skip: "
        "'עברו סינון' הם ה-keep (אטרקציה אמיתית), 'נדחו' הם ה-skip (רעש ש-OSM תייג "
        "כאטרקציה). כלומר **הועשרו = עברו סינון + נדחו**. האפליקציה מציגה רק 'עברו "
        "סינון' או מקומות שטרם הועשרו.")
    api_key = st.text_input("Anthropic API key", type="password",
                            help="המפתח לא נשמר — משמש רק להרצה הנוכחית")
    limit = st.slider("כמה אטרקציות להעשיר בהרצה", 15, 150, 60, step=15)

    if st.button("הרץ העשרה (חד-פעמי, עם מפתח שהודבק)", disabled=not api_key or pending == 0):
        bar = st.progress(0.0, text="מעשיר...")
        try:
            done = enrich.enrich_pending(
                api_key, limit=limit,
                progress=lambda d, t: bar.progress(d / t, text=f"הועשרו {d}/{t}"))
            st.success(f"הועשרו {done} אטרקציות")
        except Exception as ex:
            st.error(f"שגיאה: {ex}")

    st.divider()
    st.subheader("🔄 הרצה רציפה ברקע")
    st.caption(
        "מריץ העשרה batch אחרי batch עד שלא נשאר כלום — או עד שנגמר הקרדיט/קרתה תקלה, "
        "ואז נעצר בעדינות. רץ **ברקע בשרת**, אפשר לסגור את הדף. אם נעצר — פשוט הפעילו שוב "
        "(ימשיך מהמקום שבו עצר). המפתח נקרא אוטומטית מהשרת, אין צורך להדביק. "
        "⚠️ צורך קרדיטים של Claude כל עוד רץ.")

    LOG = os.path.expanduser("~/enrichloop.log")
    running = subprocess.run(
        ["pgrep", "-f", "enrich_loop.py"], capture_output=True).returncode == 0

    if running:
        sc1, sc2 = st.columns([1, 3])
        sc1.success("🟢 רץ כעת")
        if sc2.button("⛔ עצור"):
            subprocess.run(["pkill", "-f", "enrich_loop.py"])
            time.sleep(1)
            st.rerun()
    else:
        _mc = db.get_conn()
        cur_model = db.get_model(_mc)
        _mc.close()
        m_ids = list(MODELS.keys())
        if cur_model not in m_ids:
            m_ids = [cur_model] + m_ids
        bulk_model = st.selectbox(
            "מודל להרצה הזו", m_ids, index=m_ids.index(cur_model),
            format_func=lambda m: MODELS.get(m, m),
            help="לבכמות גדולה כדאי Sonnet — זול ומהיר. לא משנה את מודל האפליקציה.")
        if st.button("▶️ הפעל העשרה ברקע", type="primary", disabled=pending == 0):
            with open(LOG, "a") as f:
                subprocess.Popen(
                    [sys.executable, "-u", "enrich_loop.py", bulk_model],
                    cwd=os.path.dirname(os.path.abspath(__file__)),
                    stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
            st.success("הופעל ברקע ✓")
            time.sleep(1.5)
            st.rerun()

    rc1, rc2 = st.columns([1, 3])
    if rc1.button("🔄 רענן סטטוס"):
        st.rerun()
    if os.path.exists(LOG):
        try:
            tail = "".join(open(LOG).readlines()[-12:])
        except Exception:
            tail = ""
        st.code(tail or "(עוד אין פלט)", language=None)

with tab_browse:
    conn = db.get_conn()
    total = conn.execute("SELECT count(*) FROM attractions").fetchone()[0]
    dests = conn.execute("SELECT count(*) FROM destinations").fetchone()[0]
    with_site = conn.execute(
        "SELECT count(*) FROM attractions WHERE website IS NOT NULL AND website!=''"
    ).fetchone()[0]

    m1, m2, m3 = st.columns(3)
    m1.metric("אטרקציות", f"{total:,}")
    m2.metric("יעדים", dests)
    m3.metric("עם קישור לאתר", with_site)

    # filters: city + category
    city_rows = conn.execute(
        "SELECT id, city, country FROM destinations ORDER BY city").fetchall()
    city_opts = {f"{r['city']} ({r['country']})": r["id"] for r in city_rows}
    cats = [r[0] for r in conn.execute(
        "SELECT DISTINCT category FROM attractions WHERE category IS NOT NULL ORDER BY category")]

    fc1, fc2, fc3 = st.columns([1, 2, 1])
    with fc1:
        fcity = st.selectbox("עיר", ["כל הערים"] + list(city_opts.keys()))
    with fc2:
        fcat = st.multiselect(
            "קטגוריות", cats, default=cats,
            format_func=lambda c: CAT_LABEL_HE.get(c, c))
    with fc3:
        quality_only = st.toggle("רק איכות גבוהה", value=True,
                                 help="הצג רק אטרקציות ש-Claude סימן כשוות ביקור")

    if fcat:
        where = [f"category IN ({','.join('?'*len(fcat))})"]
        params = list(fcat)
        if fcity != "כל הערים":
            where.append("destination_id = ?")
            params.append(city_opts[fcity])
        if quality_only:
            where.append("quality_keep = 1")
        q = ("SELECT name_en, name_he, lat, lng, category, subcategory, website, "
             "opening_hours, info_sources, family_score, tips_he FROM attractions "
             f"WHERE {' AND '.join(where)} "
             "ORDER BY family_score DESC, name_en LIMIT 500")
        rows = conn.execute(q, params).fetchall()
        mapped = [r for r in rows if r["lat"] and r["lng"]]

        st.write(f"מציג {len(rows)} אטרקציות · {len(mapped)} על המפה")

        # interactive map with colour-coded markers
        if mapped:
            clat = sum(r["lat"] for r in mapped) / len(mapped)
            clng = sum(r["lng"] for r in mapped) / len(mapped)
            fmap = folium.Map(location=[clat, clng], zoom_start=12, tiles="CartoDB positron")
            for r in mapped:
                srcs = db.jloads(r["info_sources"])
                name = r["name_he"] or r["name_en"]
                links = ""
                if r["website"]:
                    links += f'<a href="{r["website"]}" target="_blank">אתר רשמי</a><br>'
                for s in srcs:
                    links += f'<a href="{s["url"]}" target="_blank">{s["title"]}</a><br>'
                score = f" · ציון {r['family_score']}/10" if r["family_score"] else ""
                tip = f"<br><i>{r['tips_he']}</i>" if r["tips_he"] else ""
                popup = folium.Popup(
                    f"<b>{name}</b><br>{CAT_LABEL_HE.get(r['category'], r['category'])}"
                    f"{score}{tip}<br>{links}", max_width=260)
                folium.CircleMarker(
                    location=[r["lat"], r["lng"]], radius=6,
                    color=CAT_COLOR.get(r["category"], "gray"),
                    fill=True, fill_opacity=0.8,
                    popup=popup, tooltip=name).add_to(fmap)
            st_folium(fmap, width=None, height=480, returned_objects=[])

        # list below the map
        table = []
        for r in rows:
            srcs = db.jloads(r["info_sources"])
            table.append({
                "עברית": r["name_he"] or "—",
                "שם": r["name_en"],
                "ציון": r["family_score"] if r["family_score"] is not None else "—",
                "קטגוריה": CAT_LABEL_HE.get(r["category"], r["category"]),
                "טיפ": r["tips_he"] or "—",
                "אתר": r["website"] or "",
                "שעות": r["opening_hours"] or "—",
                "מקורות": ", ".join(s["title"] for s in srcs) or "—",
            })
        st.dataframe(table, width="stretch",
                     column_config={"אתר": st.column_config.LinkColumn("אתר")})
    conn.close()
