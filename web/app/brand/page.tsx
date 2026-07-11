import { Fredoka, Rubik, IBM_Plex_Sans_Hebrew } from "next/font/google";
import { WhyFits, TravelersSay } from "@/components/Signature";
import { CategoryTile } from "@/components/CategoryTiles";

// -----------------------------------------------------------------------------
// Yalle — internal brand board (direction B: warm editorial × modern product).
// Hidden route, not linked from nav. Tokens here are LOCAL to this page until
// the direction is approved; the app's globals.css is untouched.
// -----------------------------------------------------------------------------

const fredoka = Fredoka({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600", "700"], variable: "--f-fred" });
const rubik = Rubik({ subsets: ["hebrew", "latin"], weight: ["500", "700", "800"], variable: "--f-rubik" });
const plex = IBM_Plex_Sans_Hebrew({ subsets: ["hebrew", "latin"], weight: ["500", "700"], variable: "--f-plex" });

// --- palette (AA-verified; contrast vs white / vs its soft pair) -------------
const C = {
  bg: "#FAF6EC", surface: "#FFFFFF", surface2: "#F2ECDF",
  ink: "#101D2B", ink2: "#4F5D6A", ink3: "#8A94A0",
  green: "#0E6B5E", greenInk: "#0A5044", greenSoft: "#E3F0EA",
  terra: "#C64F26", terraInk: "#A63E1B", terraSoft: "#FBE7DD", terraBright: "#E76F51",
  amberInk: "#8A5A0B", amberSoft: "#F7E9C8",
  blue: "#2E7A96", blueSoft: "#E1EEF3",
};

const SWATCHES: { hex: string; name: string; role: string; contrast: string }[] = [
  { hex: C.green, name: "ירוק יער", role: "ראשי — כפתורים, לוגו, ניווט", contrast: "לבן עליו 6.4 · AA" },
  { hex: C.terra, name: "טרקוטה", role: "אקסנט — CTA, הדגשות", contrast: "לבן עליו 4.6 · AA" },
  { hex: C.terraBright, name: "טרקוטה בהיר", role: "דקורטיבי בלבד (איור, מוטיבים)", contrast: "לא לטקסט" },
  { hex: C.ink, name: "נייבי דיו", role: "טקסט ראשי", contrast: "על קרם 15.8 · AAA" },
  { hex: C.bg, name: "קרם", role: "רקע קנבס", contrast: "—" },
  { hex: C.surface2, name: "קרם כהה", role: "משטח משני, מקטעים", contrast: "—" },
  { hex: C.greenSoft, name: "ירוק רך", role: "צ'יפים, הדגשות חיוביות", contrast: "דיו-ירוק עליו 8.0 · AAA" },
  { hex: C.amberSoft, name: "ענבר רך", role: "\"בולט\" / דחיפה עדינה", contrast: "דיו-ענבר עליו 4.9 · AA" },
];

// --- the pin — the brand mark (pure SVG, scalable) ---------------------------
function Pin({ size = 28, fill = C.terraBright }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2.2c-3.9 0-7 3.1-7 7 0 4.9 5.8 11.3 6.6 12.1a.55.55 0 0 0 .8 0c.8-.8 6.6-7.2 6.6-12.1 0-3.9-3.1-7-7-7z" fill={fill} />
      <circle cx="12" cy="9.1" r="2.7" fill="#FFF8EE" />
    </svg>
  );
}

// spark lines above the pin (the "yalla, let's go" energy)
function PinSpark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <g stroke={C.terraBright} strokeWidth="1.8" strokeLinecap="round">
        <path d="M18.5 4.5l2.2-2.2" /><path d="M20 8h2.6" /><path d="M15.5 3v-2.4" />
      </g>
      <path d="M10 4.2c-3.5.5-6 3.3-6 6.9 0 4.4 5.2 10.2 5.9 10.9a.5.5 0 0 0 .72 0c.7-.7 5.88-6.5 5.88-10.9 0-3.6-2.5-6.4-6-6.9z" fill={C.terraBright} />
      <circle cx="10.25" cy="10.6" r="2.5" fill="#FFF8EE" />
    </svg>
  );
}

// logo tile (app-icon variant)
function Tile({ bg, fg, pin, label }: { bg: string; fg: string; pin: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative grid size-20 place-items-center rounded-[22px]"
        style={{ background: bg, boxShadow: "0 2px 6px rgba(16,29,43,.08), 0 12px 28px rgba(16,29,43,.10)" }}>
        <span className="disp text-[44px] font-black leading-none" style={{ color: fg }}>Y</span>
        <span className="absolute" style={{ top: 10, insetInlineEnd: 12 }}><Pin size={16} fill={pin} /></span>
      </div>
      <span className="text-[11px]" style={{ color: C.ink3 }}>{label}</span>
    </div>
  );
}

// passport-stamp motif
function Stamp() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden style={{ transform: "rotate(-8deg)" }}>
      <circle cx="60" cy="60" r="54" fill="none" stroke={C.green} strokeWidth="3" strokeDasharray="2.5 5" strokeLinecap="round" />
      <circle cx="60" cy="60" r="43" fill="none" stroke={C.green} strokeWidth="1.5" />
      <text x="60" y="52" textAnchor="middle" fontFamily="var(--f-fred)" fontWeight="900" fontSize="26" fill={C.green}>Yalle</text>
      <text x="60" y="74" textAnchor="middle" fontFamily="var(--f-fred)" fontWeight="500" fontSize="12" fill={C.green}>בול בשבילך</text>
      <g stroke={C.green} strokeWidth="1.5" strokeLinecap="round">
        <path d="M28 60h-8" /><path d="M100 60h-8" />
      </g>
    </svg>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <p className="mb-1 text-[11px] font-semibold tracking-[0.18em]" style={{ color: C.terra }}>{n}</p>
      <h2 className="disp mb-5 text-[26px] font-black" style={{ color: C.ink }}>{title}</h2>
      {children}
    </section>
  );
}

export default function BrandBoard() {
  return (
    <main dir="rtl" className={`${fredoka.variable} ${rubik.variable} ${plex.variable} min-h-screen pb-32`}
      style={{ background: C.bg, color: C.ink }}>
      <style>{`.disp{font-family:var(--f-fred)} .rubik{font-family:var(--f-rubik)} .plex{font-family:var(--f-plex)}`}</style>
      <div className="mx-auto max-w-[760px] px-6 pt-14">

        <p className="text-[11px] font-semibold tracking-[0.2em]" style={{ color: C.ink3 }}>YALLE · BRAND BOARD · כיוון B · פנימי</p>

        {/* ---------- 1 · the lockup ---------- */}
        <Section n="01" title="הלוגו">
          <div className="rounded-[24px] p-10 text-center"
            style={{ background: C.surface, boxShadow: "0 2px 6px rgba(16,29,43,.05), 0 18px 44px rgba(16,29,43,.08)" }}>
            <div className="inline-flex items-start justify-center" dir="ltr">
              <span className="disp font-black leading-none" style={{ fontSize: 92, color: C.green, letterSpacing: "-0.02em" }}>Yalle</span>
              <span className="-ms-2 mt-1"><PinSpark size={40} /></span>
            </div>
            <p className="disp mt-3 text-[22px] font-700" style={{ color: C.ink, fontWeight: 700 }}>הטיול שלך. בול בשבילך.</p>
            <p className="mt-1 text-[13px]" style={{ color: C.ink2 }}>וורדמארק ירוק-יער · פין טרקוטה עם ניצוץ — האנרגיה של "יאללה, יוצאים"</p>
          </div>
          <div className="mt-6 flex flex-wrap items-end justify-center gap-7">
            <Tile bg={C.green} fg="#FFFFFF" pin={C.terraBright} label="ראשי" />
            <Tile bg={C.surface} fg={C.green} pin={C.terraBright} label="בהיר" />
            <Tile bg={C.bg} fg={C.green} pin={C.terra} label="קרם" />
            <Tile bg={C.terraBright} fg="#FFFFFF" pin="#FFF3E9" label="חם (קמפיינים)" />
            <div className="flex flex-col items-center gap-2"><Stamp /><span className="text-[11px]" style={{ color: C.ink3 }}>חותמת (מוטיב)</span></div>
          </div>
        </Section>

        {/* ---------- 2 · palette ---------- */}
        <Section n="02" title="פלטת צבעים — נבדקה לנגישות">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SWATCHES.map((s) => (
              <div key={s.hex} className="overflow-hidden rounded-[16px]"
                style={{ background: C.surface, boxShadow: "0 1px 3px rgba(16,29,43,.06), 0 8px 20px rgba(16,29,43,.06)" }}>
                <div style={{ background: s.hex, height: 64, borderBottom: `1px solid ${C.surface2}` }} />
                <div className="p-2.5">
                  <p className="text-[13px] font-bold" style={{ color: C.ink }}>{s.name}</p>
                  <p className="text-[11px] leading-snug" style={{ color: C.ink2 }}>{s.role}</p>
                  <p className="mt-1 font-mono text-[10px]" dir="ltr" style={{ color: C.ink3 }}>{s.hex} · {s.contrast}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px]" style={{ color: C.ink2 }}>
            הטרקוטה של הבורד המקורי (#E76F51) נכשלה בנגישות טקסט (3.1) — הוכהתה ל-#C64F26 (4.6 · AA).
            הגוון הבהיר נשמר לאיור ולמוטיבים בלבד.
          </p>
        </Section>

        {/* ---------- 3 · typography ---------- */}
        <Section n="03" title="טיפוגרפיה — סן-סריף לכותרות (הוחלף 2026-07-11)">
          <div className="flex flex-col gap-4">
            {[
              { cls: "disp", name: "Fredoka", tag: "הנבחר", weight: 600,
                why: "סן-סריף גיאומטרי-מעוגל — חם, ידידותי ומודרני. שומר על האנושיות של המותג בלי רטרו, ונבדל מ-Assistant של הטקסט הרץ." },
              { cls: "rubik", name: "Rubik", tag: "חלופה", weight: 800,
                why: "גיאומטרי מאוזן במשקל כבד — מודרני ובטוח. נפוץ יחסית בעברית, פחות ייחודי." },
              { cls: "plex", name: "IBM Plex Sans Hebrew", tag: "חלופה", weight: 700,
                why: "תחושת פרודקט פרימיום, נקי וטכנולוגי — אבל קר יותר מרוח המותג." },
            ].map((f) => (
              <div key={f.name} className="rounded-[20px] p-6"
                style={{ background: C.surface, boxShadow: "0 1px 3px rgba(16,29,43,.05), 0 10px 26px rgba(16,29,43,.07)" }}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                    style={{ background: f.tag === "הנבחר" ? C.greenSoft : C.surface2, color: f.tag === "הנבחר" ? C.greenInk : C.ink2 }}>{f.tag}</span>
                  <span className="font-mono text-[11px]" dir="ltr" style={{ color: C.ink3 }}>{f.name}</span>
                </div>
                <p className={f.cls} style={{ fontSize: 30, fontWeight: f.weight, lineHeight: 1.25, color: C.ink }}>
                  לטייל כמו שאתם אוהבים
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: C.ink2 }}>{f.why}</p>
              </div>
            ))}
            <div className="rounded-[20px] p-6" style={{ background: C.surface2 }}>
              <p className="text-[11px] font-semibold tracking-wider" style={{ color: C.ink3 }}>טקסט רץ — Assistant (נשאר)</p>
              <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: C.ink }}>
                אנחנו כאן כדי להפוך את התכנון לחוויה — פשוטה, אישית ומרגשת. הטקסט הרץ נשאר Assistant: קריא,
                חם, ועובד מצוין בעברית. <span dir="ltr" className="font-mono text-[13px]">Aa Bb 0123456789</span>
              </p>
            </div>
          </div>
        </Section>

        {/* ---------- 4 · depth & components ---------- */}
        <Section n="04" title="עומק, כפתורים וצ'יפים">
          <div className="rounded-[24px] p-7" style={{ background: C.surface, boxShadow: "0 2px 6px rgba(16,29,43,.05), 0 18px 44px rgba(16,29,43,.08)" }}>
            {/* buttons — locked 2026-07-11: primary=green fill, secondary=green outline, tertiary=link */}
            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-full px-6 py-3 text-[14.5px] font-bold text-white transition"
                style={{ background: C.green, boxShadow: "0 6px 16px rgba(14,107,94,.35)" }}>כפתור ראשי</button>
              <button className="rounded-full px-6 py-3 text-[14.5px] font-medium"
                style={{ background: C.surface, color: C.greenInk, border: `1.5px solid ${C.green}` }}>כפתור משני</button>
              <a className="text-[14px] font-medium" style={{ color: C.greenInk }}>קישור משני ‹</a>
            </div>
            {/* choice chips — FILLED (board): green / amber(+ink text, AA) / terracotta */}
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full px-3.5 py-1.5 text-[13px] font-bold text-white" style={{ background: C.green }}>✓ כן</span>
              <span className="rounded-full px-3.5 py-1.5 text-[13px] font-bold" style={{ background: "#EF9F27", color: C.ink }}>? אולי</span>
              <span className="rounded-full px-3.5 py-1.5 text-[13px] font-bold text-white" style={{ background: C.terra }}>✕ לא</span>
              <span className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: C.greenSoft, color: C.greenInk }}>חובה</span>
              <span className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: C.amberSoft, color: C.amberInk }}>בולט</span>
              <span className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: C.blueSoft, color: C.blue }}>מקורה</span>
              <span className="rounded-full px-3 py-1.5 text-[12px]" style={{ background: C.surface2, color: C.amberInk }}>★ מועדף</span>
            </div>
            {/* category tiles — two-tone filled icon set (live component) */}
            <p className="mb-2 mt-6 text-[13px] font-bold" style={{ color: C.ink }}>קטגוריות</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {["תרבות", "טבע", "לילדים", "אוכל", "קניות", "חופים"].map((l, i) => (
                <CategoryTile key={l} label={l} selected={i === 1} />
              ))}
            </div>
            <p className="mt-5 text-[12.5px] leading-relaxed" style={{ color: C.ink2 }}>
              שפת העומק: משטחים לבנים על קרם, צל כפול (קרוב + רחוק) במקום מסגרות, פינות 16–24,
              והרבה אוויר. הערת נגישות: "אולי" מלא בענבר מקבל טקסט כהה — לבן על ענבר נכשל ב-AA.
            </p>
          </div>
        </Section>

        {/* ---------- 5 · signature components (the LIVE ones) ---------- */}
        <Section n="05" title='חתימת המוצר — "שפת ההסבר"'>
          <div className="flex flex-col gap-3">
            <WhyFits>
              כי אתם אוהבים אוכל ווינטג׳ · בלי ילדים · קצב רגוע — פתחנו את היום בשוק קמדן.
            </WhyFits>
            <WhyFits title="למה בנינו את היום ככה">
              ריכזנו את דרום קנזינגטון ביום אחד — שלושת המוזיאונים במרחק הליכה, והפארק ביניהם לאוויר.
            </WhyFits>
            <TravelersSay
              quote="הגענו ב-16:00 ולא היה תור בכלל. אל תפספסו את הדוכן מאחורי הכנסייה."
              kind="טיפ" />
            <p className="text-[12px]" style={{ color: C.ink3 }}>
              * רכיבי מערכת חיים (components/Signature.tsx) — אלה בדיוק הרכיבים שרצים במוצר, על דאטה אמיתי
              (טעמים מכוילים, שדה ה-"למה" של כל יום, תובנות מאומתות).
            </p>
          </div>
        </Section>

      </div>
    </main>
  );
}
