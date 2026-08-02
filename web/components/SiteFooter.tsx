import Link from "next/link";

// Global footer — legal links + contact. Bottom padding on mobile clears the
// fixed BottomNav. Kept lightweight; all colors on tokens.
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--border)] pb-28 pt-8 lg:pb-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 text-center lg:flex-row lg:justify-between lg:text-right">
        <p className="text-[13px] text-[var(--text-3)]">
          © {new Date().getFullYear()} Yalle · הטיול שלכם. בול בשבילכם.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13.5px]">
          <Link href="/about" className="text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">אודות</Link>
          <Link href="/legal/terms" className="text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">תנאי שימוש</Link>
          <Link href="/legal/privacy" className="text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">מדיניות פרטיות</Link>
          <Link href="/contact" className="text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">צרו קשר</Link>
        </nav>
      </div>
    </footer>
  );
}
