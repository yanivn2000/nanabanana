import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getModel } from "./db";
import type { IngestItem } from "./db";

// Distil a traveller's post (or a multi-family thread) into structured
// insights — the same prompts/schemas as the Streamlit tool (insights.py), so
// both ingest paths produce identical knowledge.

const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    place: { type: "string" },
    kind: { type: "string", enum: ["tip", "warning", "verdict", "food", "season", "access"] },
    text_he: { type: "string" },
    sentiment: { type: "string", enum: ["pos", "neg", "neutral"] },
  },
  required: ["place", "kind", "text_he", "sentiment"],
  additionalProperties: false,
} as const;

const PROFILE_ENUM = ["family", "couple", "friends", "solo", "general"] as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    author_profile: { type: "string", enum: PROFILE_ENUM },
    insights: { type: "array", items: INSIGHT_SCHEMA },
  },
  required: ["author_profile", "insights"],
  additionalProperties: false,
} as const;

const THREAD_SCHEMA = {
  type: "object",
  properties: {
    families: {
      type: "array",
      items: {
        type: "object",
        properties: {
          author: { type: "string" },
          author_profile: { type: "string", enum: PROFILE_ENUM },
          insights: { type: "array", items: INSIGHT_SCHEMA },
        },
        required: ["author", "author_profile", "insights"],
        additionalProperties: false,
      },
    },
  },
  required: ["families"],
  additionalProperties: false,
} as const;

const SYSTEM =
  "You are a travel-knowledge editor for an Israeli family trip-planning app. " +
  "You are given a REAL traveller's post about a destination (a blog, forum " +
  "write-up, or a friend's summary). Distil it into concrete, reusable " +
  "insights that would genuinely help a future Israeli family — the kind of " +
  "first-hand knowledge you cannot get from a generic listing. " +
  "Extract one insight per distinct, useful point. For each: " +
  "`place` = the specific place it is about (attraction, restaurant, " +
  "neighbourhood) written EXACTLY as it appears in the post (keep the original " +
  'language); use "" only for a genuinely destination-wide tip. ' +
  "`kind`: tip (practical advice), warning (something to avoid/watch), verdict " +
  "(worth it / overrated / a must / skippable), food (a specific place or dish " +
  "to eat), season (timing / weather / crowds), access (families, strollers, " +
  "wheelchairs, opening logistics). " +
  "`text_he`: ONE short, factual, actionable Hebrew sentence (≤25 words). No " +
  "fluff, no marketing, no repeating the place name unnecessarily — just the " +
  "insight itself. " +
  "`sentiment`: pos / neg / neutral. " +
  "ALSO determine `author_profile` — who wrote this post — one of: 'family' " +
  "(travelling with children), 'couple' (two partners), 'friends' (a group of " +
  "friends / adults, no kids), 'solo' (one traveller), or 'general' (the text " +
  "does not reveal who travelled). Infer ONLY from what the post says about the " +
  "travellers themselves (e.g. 'הלכנו עם הילדים', 'טיול זוגי', 'נסענו חבר׳ה'); " +
  "when in doubt use 'general'. " +
  "Prefer specific, non-obvious, first-hand information over generic filler. " +
  "Do NOT invent anything not supported by the post. De-duplicate. If the post " +
  "has nothing useful, return an empty list.";

const SYSTEM_THREAD =
  "You are a travel-knowledge editor for an Israeli family trip-planning app. " +
  "You are given a THREAD containing posts from SEVERAL DIFFERENT travellers / " +
  "families about the same destination (e.g. a forum thread or a collection of " +
  "write-ups). Split it by author and return one group per distinct write-up. " +
  "For each group: `author` = a short Hebrew label identifying it. Prefer a " +
  "name / handle / signature if the text gives one. If it does NOT (common — " +
  "many summaries are anonymous), synthesize a SHORT descriptive label from " +
  "THAT group's own distinguishing details — group composition, trip length, " +
  "or a distinctive angle. Examples: '2 חברות · 4 ימים', 'הרכב של 8 · גילאים " +
  "25-73', 'שתי חברות ותיקות', 'קבוצה · טירה + זאנסה + וולנדם'. Make each label " +
  "DISTINCT from the others. Only if a group has no distinguishing detail at " +
  "all, fall back to 'מטייל 1', 'מטייל 2', ... in order of appearance. " +
  "`author_profile` = that group's traveller type — one of 'family' (with " +
  "children), 'couple', 'friends' (adults, no kids), 'solo', or 'general' " +
  "(unclear) — inferred only from that group's own words. " +
  "`insights` = that group's insights, using these rules per insight: " +
  "`place` = the specific place, written EXACTLY as in the text (keep original " +
  'language); "" only for a destination-wide tip. ' +
  "`kind`: tip / warning / verdict / food / season / access. " +
  "`text_he`: ONE short, factual, actionable Hebrew sentence (≤25 words). " +
  "`sentiment`: pos / neg / neutral. " +
  "CRITICAL: de-duplicate WITHIN each family, but do NOT merge insights ACROSS " +
  "different families — if two families independently recommend or warn about " +
  "the same place, keep BOTH (that agreement is valuable consensus signal). " +
  "Do NOT invent anything not supported by the text. If a family has nothing " +
  "useful, omit it.";

export async function distillPost(
  rawText: string, destName: string, thread: boolean
): Promise<IngestItem[]> {
  const client = new Anthropic(); // ANTHROPIC_API_KEY from env
  const model = await getModel();
  const prompt = thread
    ? `Destination: ${destName}\n\nSplit the following thread by family and distil each family's insights:\n\n${rawText.trim()}`
    : `Destination: ${destName}\n\nDistil the following traveller's post into structured insights:\n\n${rawText.trim()}`;
  const resp = await client.messages.create({
    model,
    max_tokens: thread ? 20000 : 8000,
    system: thread ? SYSTEM_THREAD : SYSTEM,
    output_config: { format: { type: "json_schema", schema: thread ? THREAD_SCHEMA : OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  } as Parameters<typeof client.messages.create>[0]);
  const r = resp as { content: { type: string; text?: string }[]; stop_reason?: string };
  const text = r.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`no text block (stop_reason=${r.stop_reason})`);
  if (r.stop_reason === "max_tokens") {
    throw new Error("התוכן ארוך מדי לעיבוד בבת אחת — חלקו אותו לשני חלקים והזינו בנפרד.");
  }
  const data = JSON.parse(text);
  if (thread) {
    const items: IngestItem[] = [];
    for (const fam of data.families ?? []) {
      for (const it of fam.insights ?? [])
        items.push({ ...it, author: fam.author || "", author_profile: fam.author_profile || "general" });
    }
    return items;
  }
  const profile = data.author_profile || "general";
  return (data.insights ?? []).map((it: IngestItem) => ({ ...it, author_profile: profile }));
}
