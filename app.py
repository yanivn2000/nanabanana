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
import insights

st.set_page_config(page_title="ניהול מאגר · Yalle", page_icon="🗺️", layout="wide")

# RTL + a slicker, tighter, more professional look. Streamlit has no built-in
# RTL, so we set direction on the app container, right-align text, switch to a
# clean Hebrew font (Assistant), condense spacing, and card-ify inputs/metrics.
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&display=swap');

/* base */
html, body, .stApp, .stApp * { font-family:'Assistant',-apple-system,'Segoe UI','Noto Sans Hebrew',sans-serif; }
.stApp { direction: rtl; }
.stApp [data-testid="stMarkdownContainer"],
.stApp h1,.stApp h2,.stApp h3,.stApp h4,.stApp h5,.stApp p,.stApp li,.stApp label,
.stApp [data-testid="stMetricValue"],.stApp [data-testid="stMetricLabel"],
.stApp [data-testid="stWidgetLabel"] { text-align: right; }
.stApp input, .stApp textarea { text-align: right; }

/* layout: reclaim top space, cap width, tighten vertical rhythm */
.stApp [data-testid="stMainBlockContainer"],
.stApp .block-container { padding-top:2.2rem; padding-bottom:3rem; max-width:1180px; }
.stApp [data-testid="stHeader"] { background:transparent; }
[data-testid="stVerticalBlock"] { gap:.55rem; }
[data-testid="stHorizontalBlock"] { gap:.8rem; }

/* headings */
.stApp h1 { font-size:1.85rem; font-weight:800; letter-spacing:-.01em; }
.stApp h2 { font-size:1.35rem; font-weight:700; }
.stApp h3 { font-size:1.12rem; font-weight:700; }

/* widget labels: compact + muted, hugging their field */
[data-testid="stWidgetLabel"] p { font-size:.82rem; font-weight:600; color:#5b6472; margin-bottom:.2rem; }

/* inputs / selects / textareas: rounded, subtle border, focus ring */
.stTextInput input, .stNumberInput input, .stTextArea textarea,
[data-baseweb="select"] > div, [data-baseweb="input"] {
  border-radius:11px !important; border:1px solid #e6e8ec !important;
  background:#fff !important; box-shadow:none !important;
}
.stTextInput input:focus, .stTextArea textarea:focus {
  border-color:#1fa8a0 !important; box-shadow:0 0 0 3px rgba(31,168,160,.13) !important;
}

/* metrics as clean cards */
[data-testid="stMetric"] {
  background:#fff; border:1px solid #eef0f2; border-radius:14px; padding:.75rem 1rem;
  box-shadow:0 1px 2px rgba(16,38,63,.04);
}
[data-testid="stMetricValue"] { font-size:1.55rem; font-weight:800; color:#16263f; }
[data-testid="stMetricLabel"] p { color:#6b7280; font-weight:600; }

/* buttons */
.stButton > button, .stFormSubmitButton > button, .stDownloadButton > button {
  border-radius:11px; font-weight:700; padding:.5rem 1.15rem; border:1px solid #e6e8ec;
}
.stButton > button[kind="primary"], .stFormSubmitButton > button[kind="primary"],
[data-testid="stBaseButton-primary"] {
  background:#f4685e !important; border-color:#f4685e !important; color:#fff !important;
}
.stButton > button:hover { border-color:#1fa8a0; color:#1fa8a0; }

/* tabs: slick underline in brand color */
.stTabs [data-baseweb="tab-list"] { direction:rtl; gap:.35rem; border-bottom:1px solid #eef0f2; }
.stTabs [data-baseweb="tab"] { font-weight:600; padding:.45rem .8rem; }
.stTabs [aria-selected="true"] { color:#f4685e; }
.stTabs [data-baseweb="tab-highlight"] { background:#f4685e; }

/* misc polish */
hr { margin:1rem 0 !important; border-color:#eef0f2; }
[data-testid="stCaptionContainer"], .stApp small { color:#6b7280; line-height:1.5; }
[data-testid="stExpander"] { border-radius:12px; border:1px solid #eef0f2; }
[data-testid="stExpander"] summary { font-weight:600; }
.stAlert { border-radius:12px; }
[data-testid="stFileUploaderDropzone"] { border-radius:12px; }
</style>
""", unsafe_allow_html=True)

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

st.title("🗺️ ניהול מאגר · Yalle")

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

tab_browse, tab_ingest, tab_enrich, tab_knowledge, tab_tickets, tab_settings = st.tabs(
    ["🔍 דפדוף בנתונים", "⬇️ איסוף מ-OpenStreetMap", "✨ העשרה עם Claude",
     "💬 מקורות ידע", "🎫 בקשות פיתוח", "⚙️ הגדרות"])

with tab_knowledge:
    st.subheader("💬 מקורות ידע — אימון על תוכן אמין")
    st.caption(
        "הדביקו פוסט אמיתי של מטייל (בלוג, פורום, סיכום של חבר) על יעד. Claude "
        "ינתח אותו **פעם אחת** ויחלץ תובנות מובנות לפי מקום (טיפ / אזהרה / שווה-לא-שווה "
        "/ אוכל / עונה / נגישות). אתם מאשרים את מה ששווה לשמור — ומאז המערכת מעדיפה "
        "את הידע הזה על-פני מידע כללי מהרשת, **גם עם וגם בלי AI**.")

    kn_conn = db.get_conn()
    total_ins, n_dests, n_srcs = insights.counts(kn_conn)
    k1, k2, k3 = st.columns(3)
    k1.metric("תובנות שנשמרו", f"{total_ins:,}")
    k2.metric("יעדים מכוסים", f"{n_dests:,}")
    k3.metric("מקורות (פוסטים)", f"{n_srcs:,}")

    kn_dest_rows = kn_conn.execute(
        "SELECT id, city, country, city_he FROM destinations ORDER BY city").fetchall()
    kn_opts = {r["id"]: f"{r['city_he'] or r['city']} · {r['country']}" for r in kn_dest_rows}

    st.divider()
    st.markdown("##### ➕ הכנס פוסט חדש")
    if not kn_opts:
        st.info("אין עדיין יעדים במאגר — הוסיפו עיר בלשונית האיסוף קודם.")
    else:
        kn_mode = st.radio(
            "סוג הזנה", ["single", "thread"], horizontal=True, key="kn_mode",
            format_func=lambda m: "פוסט יחיד" if m == "single" else "שרשור (כמה משפחות)")
        kn_is_thread = kn_mode == "thread"
        if kn_is_thread:
            st.caption(
                "הדביקו שרשור — או **העלו קובץ PDF/טקסט** — עם כמה המלצות ממשפחות שונות. "
                "Claude יזהה גבולות בין המשפחות וייצור **מקור נפרד לכל אחת** — בלי לאחד "
                "ביניהן, כדי לשמור על חוזק הקונצנזוס (כמה משפחות המליצו על אותו דבר). "
                "מסמכים גדולים מפוצלים אוטומטית לסיכומים ומעובדים אחד-אחד.")
        kn_dest = st.selectbox("יעד", list(kn_opts.keys()),
                               format_func=lambda i: kn_opts[i], key="kn_dest")
        c1, c2 = st.columns(2)
        kn_author = c1.text_input(
            "מקור כללי (לא חובה)" if kn_is_thread else "מקור / כותב (לא חובה)",
            key="kn_author",
            placeholder="שם השרשור/הפורום" if kn_is_thread else "למשל: משפחת כהן, בלוג ׳מטיילים באירופה׳",
            help="בשרשור — Claude מזהה שם לכל משפחה; זה משמש רק כברירת מחדל למי שלא זוהה." if kn_is_thread else None)
        kn_url = c2.text_input("קישור (לא חובה)", key="kn_url", placeholder="https://…")

        # Optional file upload (thread mode): PDF/txt → extracted text.
        kn_upload_text = ""
        if kn_is_thread:
            kn_file = st.file_uploader("או העלו קובץ (PDF / טקסט)", type=["pdf", "txt"], key="kn_file")
            if kn_file is not None:
                try:
                    kn_upload_text = insights.extract_text(kn_file.name, kn_file.getvalue())
                    st.caption(f"📄 חולצו {len(kn_upload_text):,} תווים מתוך {kn_file.name}")
                except Exception as ex:
                    st.error(f"לא הצלחתי לחלץ טקסט מהקובץ: {ex}")

        kn_text = st.text_area(
            "או הדביקו כאן את השרשור" if kn_is_thread else "הדביקו כאן את תוכן הפוסט",
            height=180 if kn_is_thread else 220, key="kn_text",
            placeholder="הדביקו את כל השרשור — כמה המלצות ממשפחות שונות (אם לא העליתם קובץ)." if kn_is_thread
            else "הטקסט המלא של הפוסט/הסיכום — באיזו שפה שהיא.")
        # File takes precedence over pasted text when both are present.
        kn_src_text = kn_upload_text or kn_text

        # Anthropic key: prefer the server-side key, fall back to a pasted one.
        def _server_key():
            k = os.environ.get("ANTHROPIC_API_KEY")
            if k:
                return k
            try:
                for line in open(os.path.expanduser("~/.nanabanana-web.env")):
                    if line.strip().startswith("ANTHROPIC_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
            except FileNotFoundError:
                pass
            return ""
        kn_key = _server_key()
        if not kn_key:
            kn_key = st.text_input("מפתח API של Anthropic", type="password", key="kn_key",
                                   help="לא נמצא מפתח בשרת — הדביקו לשימוש חד-פעמי")

        if st.button("🧠 נתח עם Claude", disabled=not (kn_src_text.strip() and kn_key)):
            try:
                if kn_is_thread:
                    bar = st.progress(0.0, text="מנתח…")
                    items = insights.distill_document(
                        kn_src_text, kn_opts[kn_dest], kn_key,
                        progress=lambda d, t: bar.progress(d / t, text=f"מעבד סיכום {d}/{t}"))
                    bar.empty()
                else:
                    with st.spinner("Claude מנתח את הפוסט…"):
                        items = insights.distill(kn_src_text, kn_opts[kn_dest], kn_key)
                if not items:
                    st.warning(
                        "לא חולצו תובנות מהתוכן. ודאו שהקובץ טקסטואלי (לא סרוק כתמונה), "
                        "שהתוכן רלוונטי ליעד שנבחר, ונסו שוב. אם זה שרשור ארוך — נסו לפצל "
                        "אותו לשני חלקים ולהזין בנפרד.")
                else:
                    # precompute the attraction match for each, for the review table
                    mc = db.get_conn()
                    for it in items:
                        _, mname = insights.match_attraction(mc, kn_dest, it.get("place", ""))
                        it["match"] = mname or ""
                    mc.close()
                    st.session_state["kn_draft"] = {
                        "dest": kn_dest, "author": kn_author, "url": kn_url,
                        "text": kn_src_text, "items": items, "thread": kn_is_thread,
                    }
                    st.success(f"✓ חולצו {len(items)} תובנות — אשרו למטה מה לשמור.")
            except Exception as ex:
                st.error(f"שגיאה בניתוח: {ex}")

    draft = st.session_state.get("kn_draft")
    if draft and draft.get("items"):
        is_thread = draft.get("thread")
        st.divider()
        st.markdown("##### ✅ אשרו את התובנות שכדאי לשמור")
        cap = ("ערכו את הטקסט אם צריך, בטלו סימון למה שלא שווה, ואז שמרו. "
               "עמודת ׳זוהה כ׳ מראה לאיזו אטרקציה במאגר קישרנו את התובנה (אם בכלל).")
        if is_thread:
            fam_n = len({(it.get("author") or "").strip() for it in draft["items"] if (it.get("author") or "").strip()})
            cap += f" זוהו **{fam_n} משפחות** — כל אחת נשמרת כמקור נפרד. אפשר לתקן שם משפחה בעמודת ׳משפחה׳."
        st.caption(cap)
        import pandas as pd
        df = pd.DataFrame([{
            "שמור": True,
            **({"משפחה": (it.get("author") or draft["author"] or "")} if is_thread else {}),
            "סוג": it.get("kind"),
            "מקום": it.get("place", ""),
            "תובנה (עברית)": it.get("text_he", ""),
            "יחס": it.get("sentiment", "neutral"),
            "זוהה כ": it.get("match", ""),
        } for it in draft["items"]])
        col_cfg = {
            "שמור": st.column_config.CheckboxColumn(width="small"),
            "סוג": st.column_config.SelectboxColumn(options=list(insights.KIND_HE.keys()), width="small"),
            "מקום": st.column_config.TextColumn(width="medium"),
            "תובנה (עברית)": st.column_config.TextColumn(width="large"),
            "יחס": st.column_config.SelectboxColumn(options=["pos", "neg", "neutral"], width="small"),
            "זוהה כ": st.column_config.TextColumn(width="medium", disabled=True),
        }
        if is_thread:
            col_cfg["משפחה"] = st.column_config.TextColumn(width="small")
        edited = st.data_editor(
            df, hide_index=True, width="stretch", key="kn_editor", column_config=col_cfg)
        kept = edited[edited["שמור"]]
        if st.button(f"💾 שמור {len(kept)} תובנות מאושרות", disabled=len(kept) == 0):
            items = [{
                "place": r["מקום"], "kind": r["סוג"],
                "text_he": r["תובנה (עברית)"], "sentiment": r["יחס"],
                **({"author": r["משפחה"]} if is_thread else {}),
            } for _, r in kept.iterrows()]
            sc = db.get_conn()
            src_ids, n_saved, n_matched = insights.save(
                sc, draft["dest"], draft["url"], draft["author"], draft["text"], items)
            sc.close()
            src_note = f" ב-{len(src_ids)} מקורות" if is_thread else ""
            st.success(f"נשמרו {n_saved} תובנות{src_note} · מתוכן {n_matched} קושרו לאטרקציה במאגר")
            del st.session_state["kn_draft"]
            st.rerun()

    st.divider()
    st.markdown("##### 📚 תובנות שמורות")
    browse_dest = st.selectbox(
        "סנן לפי יעד", [0] + list(kn_opts.keys()),
        format_func=lambda i: "כל היעדים" if i == 0 else kn_opts[i], key="kn_browse")
    saved = insights.list_insights(kn_conn, browse_dest or None, limit=300)
    if not saved:
        st.info("עדיין אין תובנות שמורות. הכניסו פוסט ראשון למעלה.")
    for row in saved:
        attr = row["attr_he"] or row["attr_en"]
        where = attr or (row["place_name"] or "כללי")
        badge = "🔗" if row["attraction_id"] else "•"
        with st.container(border=True):
            tc, dc = st.columns([10, 1])
            tc.markdown(
                f"**{insights.KIND_HE.get(row['kind'], row['kind'])}** — {row['text_he']}  \n"
                f"<span style='color:#888;font-size:12px'>{badge} {where} · "
                f"{row['dest_city']}{(' · ' + row['src_author']) if row['src_author'] else ''}</span>",
                unsafe_allow_html=True)
            if dc.button("🗑️", key=f"del_ins_{row['id']}", help="מחק תובנה"):
                dc2 = db.get_conn()
                insights.delete_insight(dc2, row["id"])
                dc2.close()
                st.rerun()
    kn_conn.close()

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
    st.caption(
        "מחזור חיים: **פתוח** → המפתח מסמן **בוצע (ממתין לאישור)** → הצוות עובר ומאשר. "
        "אם זה לא לשביעות רצונכם — פתחו מחדש עם הערה, או פתחו **טיקט המשך** (עם הפניה לטיקט המקור).")

    STATUS_HE = {"open": "🟠 פתוח", "done": "🔵 בוצע · ממתין לאישור", "approved": "✅ אושר"}
    fcol1, _ = st.columns([1, 3])
    status_filter = fcol1.selectbox("סינון", ["הכל", "ממתינים לאישור", "פתוחים", "אושרו"])
    status_map = {"הכל": None, "ממתינים לאישור": "done", "פתוחים": "open", "אושרו": "approved"}
    ticket_rows = tickets.list_tickets(status_map[status_filter])
    st.caption(f"{len(ticket_rows)} טיקטים")

    for t in ticket_rows:
        status = t["status"]
        label = (f"#{t['id']} · {TICKET_TYPES.get(t['type'], t['type'])} · "
                 f"{t['title'] or '(ללא כותרת)'} · {STATUS_HE.get(status, status)}")
        with st.expander(label, expanded=(status == "done" and status_filter == "ממתינים לאישור")):
            st.caption(t["created_at"])
            if t.get("parent_id"):
                st.caption(f"↪︎ המשך לטיקט #{t['parent_id']}")
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
            if t.get("notes"):
                st.info(f"💬 הערות צוות:\n\n{t['notes']}")

            if status == "done":
                st.markdown("**הצוות: לאשר שבוצע כראוי?**")
                note = st.text_input("הערה (לפתיחה מחדש / לטיקט המשך)", key=f"note{t['id']}")
                a1, a2, a3, a4 = st.columns(4)
                if a1.button("✅ אשר", key=f"appr{t['id']}", type="primary"):
                    tickets.set_status(t["id"], "approved", note); st.rerun()
                if a2.button("↩︎ פתח מחדש", key=f"reopen{t['id']}"):
                    tickets.set_status(t["id"], "open", note); st.rerun()
                if a3.button("➕ טיקט המשך", key=f"follow{t['id']}"):
                    nid = tickets.create_ticket(
                        t["type"], f"המשך: {t['title'] or ''}".strip(),
                        note.strip() or "(ראו טיקט מקור)", parent_id=t["id"])
                    st.success(f"נפתח טיקט המשך #{nid} (מקושר ל-#{t['id']})"); st.rerun()
                if a4.button("מחק", key=f"del{t['id']}"):
                    tickets.delete_ticket(t["id"]); st.rerun()
            else:
                b1, b2, _ = st.columns([1, 1, 2])
                if status == "approved":
                    if b1.button("↩︎ פתח מחדש", key=f"reopen{t['id']}"):
                        tickets.set_status(t["id"], "open"); st.rerun()
                else:
                    b1.caption("ממתין לפיתוח")
                if b2.button("מחק", key=f"del{t['id']}"):
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
    st.dataframe(table, hide_index=True, width="stretch")

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
    api_key = st.text_input("מפתח API של Anthropic", type="password",
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
