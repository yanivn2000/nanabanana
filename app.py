"""NanaBanana — trip planner. Stage 1: data explorer + OSM ingest."""
import json
import streamlit as st
import folium
from streamlit_folium import st_folium

import db
import pipeline_osm
import enrich

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

st.title("🍌 NanaBanana")
st.caption("מאגר נתוני טיולים — שלב א׳: איסוף ובדיקת מידע")

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

tab_browse, tab_ingest, tab_enrich = st.tabs(
    ["🔍 דפדוף בנתונים", "⬇️ איסוף מ-OpenStreetMap", "✨ העשרה עם Claude"])

with tab_ingest:
    st.subheader("משיכת אטרקציות מ-OpenStreetMap")
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

with tab_enrich:
    st.subheader("העשרה עם Claude — תרגום, ציון משפחתי, סינון איכות")
    conn = db.get_conn()
    pending = enrich.pending_count(conn)
    enriched = conn.execute(
        "SELECT count(*) FROM attractions WHERE enriched_at IS NOT NULL").fetchone()[0]
    kept = conn.execute(
        "SELECT count(*) FROM attractions WHERE quality_keep=1").fetchone()[0]
    conn.close()

    e1, e2, e3 = st.columns(3)
    e1.metric("ממתינות להעשרה", f"{pending:,}")
    e2.metric("הועשרו", f"{enriched:,}")
    e3.metric("עברו סינון איכות", f"{kept:,}")

    st.caption("Claude מתרגם לעברית, נותן ציון משפחתי וטיפ, ומסמן אטרקציות לא רלוונטיות (אנדרטאות, שלטים).")
    api_key = st.text_input("Anthropic API key", type="password",
                            help="המפתח לא נשמר — משמש רק להרצה הנוכחית")
    limit = st.slider("כמה אטרקציות להעשיר בהרצה", 15, 150, 60, step=15)

    if st.button("הרץ העשרה", type="primary", disabled=not api_key or pending == 0):
        bar = st.progress(0.0, text="מעשיר...")
        try:
            done = enrich.enrich_pending(
                api_key, limit=limit,
                progress=lambda d, t: bar.progress(d / t, text=f"הועשרו {d}/{t}"))
            st.success(f"הועשרו {done} אטרקציות")
        except Exception as ex:
            st.error(f"שגיאה: {ex}")

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
                srcs = json.loads(r["info_sources"]) if r["info_sources"] else []
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
            srcs = json.loads(r["info_sources"]) if r["info_sources"] else []
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
