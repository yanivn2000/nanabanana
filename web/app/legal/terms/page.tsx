import type { Metadata } from "next";
import { LegalArticle, LegalSection } from "../LegalArticle";

export const metadata: Metadata = {
  title: "תנאי שימוש · Yalle",
  description: "תנאי השימוש בשירות תכנון הטיולים Yalle.",
};

// NOTE (for the team): starting draft — have it reviewed/finalised before an open
// launch, and fill the [bracketed] placeholders (legal entity, jurisdiction, date).
export default function TermsPage() {
  return (
    <LegalArticle
      title="תנאי שימוש"
      updated="[תאריך]"
      intro="ברוכים הבאים ל‑Yalle. השימוש באתר ובשירות מהווה הסכמה לתנאים שלהלן. אנא קראו אותם בעיון."
    >
      <LegalSection n={1} title="מהו השירות">
        <p>Yalle הוא כלי לתכנון מסלולי טיול. השירות מציע המלצות, מסלולים יומיים ומידע על אטרקציות לצורכי תכנון והשראה בלבד. Yalle אינו סוכנות נסיעות, אינו מוכר טיסות, מלונות או כרטיסים, ואינו מבצע הזמנות בשמכם.</p>
      </LegalSection>

      <LegalSection n={2} title="דיוק המידע ואחריות">
        <p>המידע באתר (שמות אתרים, שעות פתיחה, מחירים, מרחקים, זמני הליכה ותחבורה ועוד) מבוסס על מקורות ציבוריים וצד‑שלישי (בהם OpenStreetMap) ועשוי להיות חלקי, לא מעודכן או שגוי. עליכם לאמת פרטים קריטיים — שעות, מחירים, נגישות והזמנות — ישירות מול הספק הרלוונטי לפני היציאה.</p>
        <p>השירות ניתן "כפי שהוא" (AS IS). במידה המרבית המותרת בדין, Yalle אינו אחראי לכל נזק ישיר או עקיף הנובע מהסתמכות על המידע או השימוש בשירות. ההחלטות והטיול הם באחריותכם בלבד.</p>
      </LegalSection>

      <LegalSection n={3} title="תוכן שמשתמשים יוצרים ומשתפים">
        <p>בעת שיתוף טיול או פרסום תגובה, אתם מצהירים שהתוכן חוקי, שלכם או שיש לכם הרשאה לפרסמו, ואינו פוגעני, מטעה או מפר זכויות. אתם מעניקים ל‑Yalle רישיון לא‑בלעדי להציג, לאחסן ולהפיץ את התוכן במסגרת השירות.</p>
        <p>אנו רשאים להסיר או להסתיר תוכן, לפי שיקול דעתנו, אם הוא מפר תנאים אלה או מדווח כפוגעני. שמות של קטינים בטיולים משותפים מוסתרים אוטומטית.</p>
      </LegalSection>

      <LegalSection n={4} title="שימוש הוגן">
        <p>אין לעשות שימוש אוטומטי חורג (scraping), להעמיס על השירות, לנסות לעקוף מגבלות או אבטחה, או להשתמש בשירות למטרה בלתי‑חוקית. אנו רשאים להגביל או לחסום שימוש לרעה.</p>
      </LegalSection>

      <LegalSection n={5} title="קניין רוחני">
        <p>המותג Yalle, העיצוב, הטקסטים המקוריים והקוד הם קניינם של [שם הישות המשפטית]. מפות ותמונות עשויות להיות בבעלות צד‑שלישי ולהיות כפופות לרישיונות שלהם (למשל OpenStreetMap, Pexels).</p>
      </LegalSection>

      <LegalSection n={6} title="שינויים בשירות ובתנאים">
        <p>אנו עשויים לעדכן את השירות ואת התנאים מעת לעת. המשך השימוש לאחר עדכון מהווה הסכמה לתנאים המעודכנים. תאריך העדכון האחרון מופיע בראש העמוד.</p>
      </LegalSection>

      <LegalSection n={7} title="פרטיות">
        <p>השימוש בשירות כפוף גם ל<a href="/legal/privacy" className="text-[var(--brand-ink)] underline">מדיניות הפרטיות</a> שלנו.</p>
      </LegalSection>

      <LegalSection n={8} title="דין וסמכות שיפוט">
        <p>על תנאים אלה יחול הדין של [מדינת ישראל / תחום שיפוט], וסמכות השיפוט הבלעדית תהיה לבתי המשפט המוסמכים ב[מקום].</p>
      </LegalSection>

      <LegalSection n={9} title="יצירת קשר">
        <p>לשאלות בנוגע לתנאים <a href="/contact" className="text-[var(--brand-ink)] underline">צרו קשר</a>.</p>
      </LegalSection>
    </LegalArticle>
  );
}
