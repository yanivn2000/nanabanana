"""NanaBanana — trip planner. Stage 1: data explorer + OSM ingest."""
import json
import streamlit as st

import db
import pipeline_osm

st.set_page_config(page_title="NanaBanana", page_icon="🍌", layout="wide")
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

tab_browse, tab_ingest = st.tabs(["🔍 דפדוף בנתונים", "⬇️ איסוף מ-OpenStreetMap"])

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

with tab_browse:
    conn = db.get_conn()
    total = conn.execute("SELECT count(*) FROM attractions").fetchone()[0]
    dests = conn.execute("SELECT count(*) FROM destinations").fetchone()[0]

    m1, m2, m3 = st.columns(3)
    m1.metric("אטרקציות", f"{total:,}")
    m2.metric("יעדים", dests)
    with_site = conn.execute(
        "SELECT count(*) FROM attractions WHERE website IS NOT NULL AND website!=''"
    ).fetchone()[0]
    m3.metric("עם קישור לאתר", with_site)

    cats = [r[0] for r in conn.execute(
        "SELECT DISTINCT category FROM attractions WHERE category IS NOT NULL ORDER BY category")]
    fcat = st.multiselect("סינון לפי קטגוריה", cats, default=cats)

    if fcat:
        q = ("SELECT name_en, name_he, category, subcategory, website, "
             "opening_hours, info_sources FROM attractions "
             f"WHERE category IN ({','.join('?'*len(fcat))}) "
             "ORDER BY family_score DESC, name_en LIMIT 300")
        rows = conn.execute(q, fcat).fetchall()
        st.write(f"מציג {len(rows)} אטרקציות")
        table = []
        for r in rows:
            srcs = json.loads(r["info_sources"]) if r["info_sources"] else []
            table.append({
                "שם": r["name_en"],
                "עברית": r["name_he"] or "—",
                "קטגוריה": r["category"],
                "סוג": r["subcategory"] or "—",
                "אתר": r["website"] or "",
                "שעות": r["opening_hours"] or "—",
                "מקורות": ", ".join(s["title"] for s in srcs) or "—",
            })
        st.dataframe(table, use_container_width=True,
                     column_config={"אתר": st.column_config.LinkColumn("אתר")})
    conn.close()
