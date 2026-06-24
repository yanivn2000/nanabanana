# 🍌 NanaBanana

Smart trip-planning data platform for the Israeli travel market.

**Stage 1 (current):** build and fill a smart attractions database from free,
reliable sources, with a Streamlit explorer.

## Data sources (free)
- **OpenStreetMap / Overpass API** — attractions, coordinates, categories,
  opening hours, website links, Wikipedia/Wikidata source links.
- _(planned)_ Wikipedia, Wikivoyage, YouTube, Google Places, Claude enrichment
  (Hebrew translation, `tips_he`, `family_score`).

## Run locally
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline_osm.py        # smoke test: ingest Salzburg
.venv/bin/streamlit run app.py
```

## Files
- `db.py` — SQLite schema + upsert helpers
- `pipeline_osm.py` — Overpass ingestion pipeline
- `app.py` — Streamlit data explorer + ingest UI

## Deployment
Runs on `cashflow-eu` server, port **8503**, via systemd + nginx.
Deploy: `~/nanabanana.sh` (git fetch, reset --hard, restart service).
