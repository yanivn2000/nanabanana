import type { Metadata } from "next";
import { LegalArticle, LegalSection } from "../LegalArticle";

export const metadata: Metadata = {
  title: "מדיניות פרטיות · Yalle",
  description: "כיצד Yalle אוסף, משתמש ושומר מידע.",
};

// NOTE (for the team): starting draft — have it reviewed/finalised before an open
// launch, and fill the [bracketed] placeholders (legal entity, date). Keep this in
// sync with the actual third parties in use (Supabase, Vercel, Sentry, Pexels…).
export default function PrivacyPage() {
  return (
    <LegalArticle
      title="מדיניות פרטיות"
      updated="[תאריך]"
      intro="אנחנו מכבדים את הפרטיות שלכם ואוספים כמה שפחות מידע. הפירוט הבא מסביר מה נאסף, לשם מה, ועם מי הוא משותף."
    >
      <LegalSection n={1} title="איזה מידע נאסף">
        <p><b>מידע שאתם מספקים:</b> משוב שאתם שולחים (וכתובת אימייל אם בחרתם להשאיר), פרטי מלון שאתם מוסיפים לטיול, ותוכן שאתם מפרסמים (טיולים משותפים, תגובות).</p>
        <p><b>חשבון (אופציונלי):</b> אם אתם מתחברים, ספק ההזדהות שלנו (Supabase) שומר מזהה משתמש וכתובת אימייל לצורך סנכרון הטיולים שלכם בין מכשירים.</p>
        <p><b>מידע טכני:</b> כתובת IP וכותרות בקשה נשמרות באופן זמני לצורך הגבלת קצב ומניעת שימוש לרעה, ודיווחי שגיאות (דרך Sentry) לצורך יציבות.</p>
        <p><b>מקומי במכשיר:</b> הטיולים וההעדפות שלכם נשמרים ב‑localStorage בדפדפן שלכם, ולא נשלחים לשרת אלא אם בחרתם לסנכרן או לשתף.</p>
      </LegalSection>

      <LegalSection n={2} title="למה אנחנו משתמשים במידע">
        <p>כדי לספק ולשפר את השירות: לבנות מסלולים, לשמור ולסנכרן טיולים, להציג טיולים משותפים, לענות למשוב, למנוע שימוש לרעה ולשמור על יציבות ואבטחה. איננו מוכרים מידע אישי.</p>
      </LegalSection>

      <LegalSection n={3} title="עוגיות">
        <p>אנו משתמשים בעוגיות חיוניות בלבד — בעיקר לשמירת מצב ההתחברות. אם נוסיף בעתיד כלי אנליטיקה, נעדכן מדיניות זו ונבקש הסכמה היכן שנדרש.</p>
      </LegalSection>

      <LegalSection n={4} title="צדדים שלישיים">
        <p>אנו נעזרים בספקים המעבדים מידע עבורנו: <b>Vercel</b> (אירוח), <b>Supabase</b> (מסד נתונים והזדהות), <b>Sentry</b> (דיווחי שגיאות), <b>OpenStreetMap/Nominatim</b> (מפות וגיאוקוד), ו‑<b>Pexels</b> (תמונות). לכל אחד מהם מדיניות פרטיות משלו.</p>
      </LegalSection>

      <LegalSection n={5} title="תוכן משותף וקטינים">
        <p>טיול שתבחרו לשתף הופך לציבורי בקישור. שמות של קטינים בטיולים משותפים מוסתרים אוטומטית. אל תכללו בתוכן משותף מידע רגיש שאינכם רוצים שיהיה גלוי.</p>
      </LegalSection>

      <LegalSection n={6} title="שמירת מידע">
        <p>אנו שומרים מידע כל עוד הוא נדרש למתן השירות. מידע טכני להגבלת קצב נמחק אוטומטית לאחר זמן קצר. תוכן שתמחקו מוסר מהשירות.</p>
      </LegalSection>

      <LegalSection n={7} title="הזכויות שלכם">
        <p>אתם רשאים לבקש גישה, תיקון, מחיקה או ייצוא של המידע האישי שלכם. עד להשקת כלים לניהול עצמי, פנו אלינו ב‑<a href="mailto:hello@yalle.co" className="text-[var(--brand-ink)] underline">hello@yalle.co</a> ונטפל בבקשה. תוכלו גם למחוק את הנתונים המקומיים על ידי ניקוי אחסון הדפדפן.</p>
      </LegalSection>

      <LegalSection n={8} title="ילדים">
        <p>השירות אינו מיועד לילדים מתחת לגיל 16, ואיננו אוספים מהם מידע ביודעין.</p>
      </LegalSection>

      <LegalSection n={9} title="שינויים ויצירת קשר">
        <p>נעדכן מדיניות זו מעת לעת; תאריך העדכון מופיע בראש העמוד. לשאלות בנושא פרטיות: <a href="mailto:hello@yalle.co" className="text-[var(--brand-ink)] underline">hello@yalle.co</a> · האחראי על המידע: [שם הישות המשפטית].</p>
      </LegalSection>
    </LegalArticle>
  );
}
