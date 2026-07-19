# Matching logic — insight → attraction

**What it does:** decide which of our attractions a traveller's free-text place
mention refers to — or reject it. Stored as `insights.attraction_id`. Source of
truth for the judgment; the agent applies it — no API. See [README](./README.md).

## Input (per mention)
`{ place (the traveller's words), city, candidates: [{id, name_he, name_en}, …] }`.
Candidates are a fuzzy, transliteration-tolerant shortlist (the runner builds it).

## Output (per mention)
`{ place, id }` — the id of the ONE candidate that IS this place, or `null`.

## Key judgment calls
- Account for Hebrew/English spelling & **transliteration** (`הייניקן` = Heineken,
  `ואן גוך` = Van Gogh).
- Return **null** when NONE of the candidates is clearly the same place, OR when
  the mention is **not a sightseeing attraction**: a supermarket/shop/brand
  (Albert Heijn, Primark), a restaurant/cafe/bakery, a hotel, a shopping street,
  an airport/airline, or a place **outside this city** (a day-trip town), or the
  **city name itself**.
- **Traps:** a market (`שוק אלברט קאופ`) is NOT a monument that merely shares a
  name (`אנדרטת אלברט`); a museum is NOT a park with a similar name.
- **A WRONG match is far worse than NO match.** Return null unless a candidate is
  unmistakably the SAME specific place; a shared word or loose thematic overlap
  is not enough.

## Runner
`python3 logic_agent.py matching pull <dest_id> > /tmp/mentions.json` → distinct
place mentions + their shortlists. The agent applies this spec →
`python3 logic_agent.py matching write <file.json>` (updates every insight with
that place_name). Preview vs apply is the editor's call.

Note: the production ingest path (`web/lib/match.ts`) also does this live for new
uploads; this spec keeps the *criteria* readable and lets a session re-match in bulk.
