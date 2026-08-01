import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Shared presentational shell for the legal pages — consistent editorial type,
// comfortable measure, tokenised colors. Children are the policy sections.
export function LegalArticle({
  title, updated, intro, children,
}: {
  title: string;
  updated: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[720px] px-6 pb-24 pt-10 lg:pt-14">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-[14px] text-[var(--text-2)] transition hover:text-[var(--brand-ink)]">
        <ArrowRight size={15} /> חזרה לאתר
      </Link>
      <h1 className="serif text-[30px] font-bold leading-tight text-[var(--text)] lg:text-[38px]">{title}</h1>
      <p className="mt-2 text-[13px] text-[var(--text-3)]">עודכן לאחרונה: {updated}</p>
      {intro && <p className="mt-5 text-[16px] leading-relaxed text-[var(--text-2)]">{intro}</p>}
      <div className="legal-prose mt-8 space-y-7 text-[15.5px] leading-relaxed text-[var(--text)]">
        {children}
      </div>
    </main>
  );
}

// A numbered section with a heading.
export function LegalSection({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="serif mb-2 text-[19px] font-bold text-[var(--text)]">
        <span className="text-[var(--accent-ink)]">{n}.</span> {title}
      </h2>
      <div className="space-y-2.5 text-[var(--text-2)]">{children}</div>
    </section>
  );
}
