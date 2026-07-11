import { Sparkles, MessageCircle, BadgeCheck } from "lucide-react";

// -----------------------------------------------------------------------------
// Yalle signature components — the product's branded "explanation language".
// Everywhere the system made a choice FOR this traveler, it explains itself in
// one consistent, recognizable voice. Two shapes:
//   <WhyFits>      — "✨ למה זה מתאים לכם": the personalization reason.
//   <TravelersSay> — "💬 מטיילים כמוכם אומרים": a verified traveller insight.
// Both render only from data we actually have (calibrated taste, day "why",
// approved insights) — the design never promises more than the product knows.
// -----------------------------------------------------------------------------

export function WhyFits({ title = "למה זה מתאים לכם", children }: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] p-3.5"
      style={{ background: "var(--brand-soft)", borderInlineStart: "3px solid var(--brand)" }}>
      <p className="serif mb-1 flex items-center gap-1.5 text-[13.5px] font-bold text-[var(--brand-ink)]">
        <Sparkles size={15} className="shrink-0" /> {title}
      </p>
      <div className="text-[13.5px] leading-relaxed text-[var(--brand-ink)]">{children}</div>
    </div>
  );
}

export function TravelersSay({ quote, kind }: {
  quote: string;
  kind?: string; // Hebrew kind label (טיפ / לתשומת לב / שורה תחתונה …)
}) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5"
      style={{ border: "1.5px dashed color-mix(in srgb, var(--brand) 40%, transparent)" }}>
      <p className="serif mb-1 flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-[var(--text)]">
        <MessageCircle size={15} className="shrink-0 text-[var(--brand)]" />
        מטיילים כמוכם אומרים
        <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--brand-ink)]">
          <BadgeCheck size={11} /> מאומת
        </span>
        {kind && (
          <span className="rounded-full bg-[var(--amber-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--amber)]">{kind}</span>
        )}
      </p>
      <p className="text-[13.5px] italic leading-relaxed text-[var(--text-2)]">"{quote}"</p>
    </div>
  );
}
