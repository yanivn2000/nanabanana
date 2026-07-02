import type { FamilyProfile } from "./store";

export type CheckItem = { id: string; label: string };
export type CheckSection = { title: string; items: CheckItem[] };

// Pre-trip preparation checklist for Israeli families flying abroad (#17).
// A curated template; the trip page persists the user's checks / removals /
// additions on top of it. Lightly profile-aware (kids).
export function buildChecklist(profile: FamilyProfile): CheckSection[] {
  const hasKids = profile.kids.length > 0;

  const docs: CheckItem[] = [
    { id: "passport-6m", label: "דרכון בתוקף לפחות 6 חודשים מעבר לתאריך החזרה" },
    { id: "passport-copy", label: "צילום/סריקה של הדרכון — שמרו בענן ובמייל" },
    { id: "visa", label: "ויזה / אישור כניסה (ETA/ESTA) — בדקו אם נדרש ליעד" },
    { id: "intl-license", label: "רישיון נהיגה בינלאומי — אם שוכרים רכב (חובה בהרבה מדינות, הדפיסו!)" },
    { id: "bookings", label: "כרטיסי טיסה ואישורי מלון — מודפס ובנייד" },
  ];
  if (hasKids) {
    docs.push({ id: "minor-consent", label: "מסמכי קטינים — אם ילד נוסע בלי שני ההורים, בדקו דרישות אישור" });
  }

  const money: CheckItem[] = [
    { id: "card-abroad", label: "כרטיס אשראי שעובד בחו״ל + הודעה לחברת האשראי על הנסיעה" },
    { id: "cash", label: "מעט מזומן במטבע המקומי לפריטים קטנים" },
    { id: "fees", label: "בדקו עמלות המרת מט״ח / שקלו כרטיס רב-מטבעי" },
  ];

  const health: CheckItem[] = [
    { id: "insurance", label: hasKids
        ? "ביטוח נסיעות לחו״ל — ודאו כיסוי לילדים ולפעילויות מיוחדות"
        : "ביטוח נסיעות לחו״ל (כולל כיסוי רפואי)" },
    { id: "meds", label: "תרופות קבועות + מרשם באנגלית (בכמות מספקת)" },
    { id: "vaccines", label: "חיסונים/דרישות בריאות — בדקו אם נדרשים ליעד" },
  ];

  const logistics: CheckItem[] = [
    { id: "esim", label: "eSIM / חבילת גלישה / רומינג" },
    { id: "adapter", label: "מתאם חשמל מתאים למדינה" },
    { id: "offline", label: "הורדת מפות ואפליקציות לשימוש אופליין" },
    { id: "emergency", label: "אנשי קשר לחירום + מספר השגרירות הישראלית ביעד" },
  ];

  const taxes: CheckItem[] = [
    { id: "taxfree", label: "החזר מס לתייר (Tax Free) — שמרו קבלות והחתימו במכס בשדה" },
    { id: "customs", label: "מגבלות מכס/יבוא בחזרה לארץ — בדקו מה מותר להביא" },
  ];

  return [
    { title: "מסמכים", items: docs },
    { title: "כספים", items: money },
    { title: "בריאות וביטוח", items: health },
    { title: "תקשורת ולוגיסטיקה", items: logistics },
    { title: "מיסים ומכס", items: taxes },
  ];
}
