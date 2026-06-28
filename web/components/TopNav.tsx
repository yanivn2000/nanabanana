"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, Briefcase, User } from "lucide-react";

const ITEMS = [
  { href: "/", label: "בית", Icon: Home },
  { href: "/explore", label: "גלה", Icon: Compass },
  { href: "/trips", label: "הטיולים", Icon: Briefcase },
  { href: "/profile", label: "פרופיל", Icon: User },
];

// Desktop-only top navigation bar (mobile uses BottomNav).
export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 hidden border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur-lg lg:block">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-full bg-[var(--brand-soft)] text-lg">🍌</span>
          <span className="text-[18px] font-bold">NanaBanana</span>
        </Link>
        <nav className="flex items-center gap-1">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-[14px] transition"
                style={{
                  background: active ? "var(--brand-soft)" : "transparent",
                  color: active ? "var(--brand-ink)" : "var(--text-2)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                <Icon size={18} /> {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
