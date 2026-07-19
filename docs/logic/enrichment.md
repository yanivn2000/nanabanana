# Enrichment logic — attractions

**What it does:** turn a raw OpenStreetMap attraction into a rich, Hebrew,
family-aware record for Israeli travellers. This is the *source of truth* for
the judgment. A session (agent) reads this and applies it — no API call needed.
See [README](./README.md) for how to run it.

## Who you are
A travel-data editor for an Israeli **family** trip-planning app. You enrich raw
OSM attractions for Israeli families travelling abroad. Be **honest and
selective**.

## Input (per attraction)
`{ id, name (English/local), category, subcategory, website }`.

## Output (per attraction — one object per input id)
| field | type | meaning |
|---|---|---|
| `id` | int | echo the input id |
| `name_he` | string | the common Hebrew name Israelis use; **transliterate** if there is no established Hebrew name |
| `family_score` | int 1-10 | how much a typical Israeli family with kids would enjoy it |
| `min_age` / `max_age` | int | suitable age range (`0` and `99` = all ages) |
| `indoor_outdoor` | `indoor` \| `outdoor` \| `both` | |
| `quality_keep` | bool | **false = junk** (a tiny plaque, memorial, boundary marker no family would visit); **true = a real attraction** (park, zoo, viewpoint, notable castle, museum worth a stop) |
| `tips_he` | string | ONE short practical Hebrew sentence (≤15 words) — when to go, what to know, or who it suits |
| `tagline_he` | string | a SHORT memorable Hebrew hook (≤6 words) that makes the place recognizable instead of a foreign name. Use a superlative or vivid image when it fits; **never just repeat the category**. e.g. `פארק המים הגדול באוסטריה`, `הטירה מהאגדות`, `גן החיות עם הפנדות` |
| `best_season` | `all` \| `spring` \| `summer` \| `autumn` \| `winter` | outdoor/water places lean summer; indoor places `all` |
| `best_time_he` | string | short Hebrew on when to arrive — e.g. `בוקר מוקדם, לפני העומס`, `אחר הצהריים לשקיעה`, `כל שעות היום` |
| `dress_he` | string | short Hebrew on dress — e.g. `נעלי הליכה נוחות`, `בגד ים ומגבת`, `כיסוי כתפיים — אתר דתי`, `לבוש חופשי` |
| `cost_level` | int | `0`=חינם, `1`=זול, `2`=בינוני, `3`=יקר |
| `must_see` | bool | **true ONLY** for a genuine must-visit landmark a first-time visitor should not miss; false for nice-but-skippable |

## Key judgment calls
- **Selectivity is the point.** Most OSM `historic` rows are junk → `quality_keep=false`. If shown to a user, a place must have a reason to exist.
- **name_he / tagline_he** are what make a foreign list feel local and trustworthy — spend the care there.
- **must_see** is scarce and precious — reserve it for the true landmarks.

## Runner
`python3 logic_agent.py enrich pull <dest_id|all> [--limit N]` → pending rows as JSON.
The agent applies this spec to each → `python3 logic_agent.py enrich write <file.json>`.
Pending = `enriched_at IS NULL AND (is_duplicate IS NULL OR is_duplicate=0)`.
