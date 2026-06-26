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

export function BottomNav() {
  const pathname = usePathname();
  // Hide on the immersive trip screen (it has its own AskBar).
  if (pathname.startsWith("/trip/")) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[440px] border-t border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-lg lg:hidden">
      <div className="flex items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-2">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-1 flex-col items-center gap-1 py-1.5"
              style={{ color: active ? "var(--brand)" : "var(--text-3)" }}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              <span className="text-[11px]" style={{ fontWeight: active ? 500 : 400 }}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
