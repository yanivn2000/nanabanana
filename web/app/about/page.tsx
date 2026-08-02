import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "אודות · Yalle",
  description: "הטיול שלכם. בול בשבילכם. הסיפור מאחורי יאלה — מתכנן הטיולים שבונה לכם מסלול שמתאים בדיוק לכם.",
};

// Editorial "About" page — brand voice, Frank Ruhl Libre headlines, tokenised
// colours. Static content; independent of the DB.
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[760px] px-6 pb-24 pt-8 lg:pt-12">
      <Link href="/" className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">
        <ArrowRight size={15} /> חזרה לאתר
      </Link>

      {/* hero */}
      <header className="border-b border-[var(--border)] pb-9">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-ink)]">אודות יַאלֶה</p>
        <h1 className="serif mt-3 text-[38px] font-bold leading-[1.08] text-[var(--text)] lg:text-[52px]">
          הטיול שלכם.<br />בול בשבילכם.
        </h1>
      </header>

      {/* story */}
      <div className="mt-10 space-y-7 text-[16.5px] leading-[1.85] text-[var(--text)]">
        <p>
          זה התחיל מתסכול מוכר. אתם רוצים לטוס, פותחים ארבעים טאבים, וכל אחד מהם צועק עליכם
          אותו דבר: <span className="font-semibold">"10 האטרקציות שחייבים!"</span> — אותה רשימה
          שכולם מקבלים, אותן תמונות, אותו תור. פורומים באנגלית, בלוגים ממומנים, ומפה עם מאה
          סיכות שאין לכם מושג מה לעשות איתה. בסוף מגיעים ליעד עם דף אקסל, זוג נעליים והרגשה
          שפספסתם משהו.
        </p>

        <p className="serif border-r-[3px] border-[var(--brand)] pr-5 text-[21px] font-medium leading-[1.6] text-[var(--brand-ink)]">
          יַאלֶה נולד מתוך אמונה פשוטה: טיול טוב הוא לא רשימה — הוא התאמה.
        </p>

        <p>
          לקצב שלכם, לאנשים שאיתכם, לטעם שלכם. זוג בירח דבש, משפחה עם ילדים ומטייל סולו
          שאוהב שווקים — לא אמורים לקבל את אותו יום. אצלנו הם לא מקבלים.
        </p>

        <div>
          <h2 className="serif text-[24px] font-bold text-[var(--text)]">מאחורי הקלעים יש "מוח"</h2>
          <p className="mt-3">
            לא באזז של בינה מלאכותית — מנוע חשיבה שקוף שבנוי כמו חבר ישראלי טוב שכבר היה שם.
            הוא יודע מה חובה לראות, אבל גם באיזו שכונה זה יושב, איך הולכים משם לאטרקציה הבאה,
            מתי הכי יפה להגיע ומה כדאי ללבוש. הוא מרכיב לכם יום שמתגלגל בהיגיון — לא קפיצות
            מטורפות מקצה העיר לקצה.
          </p>
        </div>

        <div>
          <h2 className="serif text-[24px] font-bold text-[var(--text)]">המידע אמיתי</h2>
          <p className="mt-3">
            במקום לגרד את האינטרנט ולקוות לטוב, יַאלֶה נשען על שכבת ידע שהצוות אישר — תובנות של
            מטיילים אמיתיים, זיקוק של מה שבאמת שווה, ולא רעש. מה שמופיע — מופיע כי יש לו סיבה.
          </p>
        </div>

        <div>
          <h2 className="serif text-[24px] font-bold text-[var(--text)]">והכול גלוי</h2>
          <p className="mt-3">
            אתם רואים מה נכנס ליומן ומה נשאר בבנק בצד, ואתם שולטים. להוסיף, להוריד, להזיז,
            לבנות מחדש. הטיול נשאר שלכם — אנחנו רק עושים את העבודה השחורה.
          </p>
        </div>
      </div>

      {/* closing */}
      <div className="mt-12 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] px-7 py-9 text-center">
        <p className="serif text-[26px] font-bold text-[var(--brand-ink)]">הטיול שלכם. בול בשבילכם.</p>
        <Link href="/"
          className="mt-5 inline-flex items-center justify-center rounded-full bg-[var(--brand)] px-7 py-3 text-[16px] font-semibold text-white shadow-[var(--shadow)] transition hover:brightness-95">
          בואו נבנה טיול
        </Link>
      </div>
    </main>
  );
}
