"""Materialize approved city photos from the /admin/posters picker.

Reads poster_picks rows where materialized=false, downloads the full-res photo,
crops it to the two poster aspect ratios (2:1 banner + 3:4 portrait), optimises
with sips, writes web/public/posters/<slug>-4x2.jpg and -3x4.jpg, records the
photographer credit in manifest.json, and marks the row materialized.

Idempotent: only processes not-yet-materialized picks. Run:  python finalize_posters.py
"""
import os, json, subprocess, tempfile
import requests
import db

REPO = os.path.dirname(os.path.abspath(__file__))
POSTERS = os.path.join(REPO, "web", "public", "posters")
MANIFEST = os.path.join(POSTERS, "manifest.json")
UA = {"User-Agent": "Mozilla/5.0 NanaBanana/0.1"}

# id -> slug (mirror of web/lib/posters.ts POSTER_SLUG)
SLUG = {1:"vienna",2:"salzburg",3:"rome",4:"athens",5:"budapest",6:"prague",
    7:"barcelona",8:"amsterdam",9:"berlin",10:"thessaloniki",11:"larnaca",
    12:"batumi",13:"tel-aviv",14:"london",15:"paris",16:"lisbon",17:"madrid",
    18:"milan",19:"venice",20:"florence",21:"munich",22:"zurich",23:"tbilisi",
    24:"nice",25:"rhodes"}

# (crop suffix, aspect w/h, longest-side px)
CROPS = [("4x2", 2/1, 1600), ("3x4", 3/4, 1200)]

def sips(*args):
    subprocess.run(["sips", *args], check=True, capture_output=True)

def make_crop(src, out, aspect, longest):
    # source dims
    o = subprocess.run(["sips","-g","pixelWidth","-g","pixelHeight",src],
                       capture_output=True, text=True).stdout
    w = int([l for l in o.splitlines() if "pixelWidth" in l][0].split(":")[1])
    h = int([l for l in o.splitlines() if "pixelHeight" in l][0].split(":")[1])
    if w/h > aspect:            # too wide -> trim width
        cw, ch = round(h*aspect), h
    else:                       # too tall -> trim height
        cw, ch = w, round(w/aspect)
    sips("-c", str(ch), str(cw), src, "--out", out)          # centered crop
    sips("-Z", str(longest), "-s", "format", "jpeg",
         "-s", "formatOptions", "72", out, "--out", out)     # resize + compress

def main():
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT dest_id, source, photo_id, photographer, photographer_url, page_url, src_url "
        "FROM poster_picks WHERE variant='default' AND materialized=false").fetchall()
    print(f"to publish: {len(rows)}")
    manifest = {}
    if os.path.exists(MANIFEST):
        manifest = json.load(open(MANIFEST))
    for r in rows:
        slug = SLUG.get(r["dest_id"])
        if not slug:
            print(f"  skip dest {r['dest_id']} (no slug)"); continue
        try:
            img = requests.get(r["src_url"], headers=UA, timeout=60).content
        except Exception as e:
            print(f"  {slug}: download failed {e}"); continue
        with tempfile.TemporaryDirectory() as td:
            orig = os.path.join(td, "orig.jpg")
            open(orig, "wb").write(img)
            for suf, aspect, longest in CROPS:
                out = os.path.join(POSTERS, f"{slug}-{suf}.jpg")
                try:
                    make_crop(orig, out, aspect, longest)
                except Exception as e:
                    print(f"  {slug}-{suf}: crop failed {e}")
        kb = [os.path.getsize(os.path.join(POSTERS, f"{slug}-{s}.jpg"))//1024 for s,_,_ in CROPS]
        manifest[slug] = {"source": r["source"], "photo_id": r["photo_id"],
            "photographer": r["photographer"], "photographer_url": r["photographer_url"],
            "page_url": r["page_url"]}
        conn.execute("UPDATE poster_picks SET materialized=true WHERE dest_id=%s AND variant='default'",
                     (r["dest_id"],))
        conn.commit()
        print(f"  {slug}: published ({kb[0]}KB / {kb[1]}KB) — {r['photographer']}")
    json.dump(manifest, open(MANIFEST, "w"), ensure_ascii=False, indent=2)
    print("manifest updated")

if __name__ == "__main__":
    main()
