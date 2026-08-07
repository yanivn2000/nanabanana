"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { UsageStats } from "@/lib/db";

// "What are people doing" — the question Search Console cannot answer, because it
// stops at the click. Four events, one funnel, and the list of searches that
// found nothing, which is the site telling us which destination to add next.
export function UsagePanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(d = days) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/usage?days=${d}`);
      setData(res.ok ? await res.json() : null);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  const f = data?.funnel;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className="rounded-full border px-3 py-1.5 text-[13px] font-medium transition"
            style={days === d
              ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
              : { borderColor: "var(--border)", color: "var(--text-2)" }}>
            {d} ימים
          </button>
        ))}
        <button onClick={() => load()} className="ms-auto flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px]">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} רענון
        </button>
      </div>

      {/* the funnel — each step and what share of the one before it survived */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "צפיות בעמוד עיר", n: f?.cityViews ?? 0, sub: null },
          { label: "התחילו לבנות", n: f?.buildsStarted ?? 0, sub: f ? `${pct(f.buildsStarted, f.cityViews)}% מהצפיות` : null },
          { label: "טיול נבנה", n: f?.buildsDone ?? 0, sub: f ? `${pct(f.buildsDone, f.buildsStarted)}% מההתחלות` : null },
          { label: "שיתפו טיול", n: f?.shares ?? 0, sub: f ? `${pct(f.shares, f.buildsDone)}% מהבניות` : null },
        ].map((c) => (
          <div key={c.label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[26px] font-bold leading-none">{c.n.toLocaleString("he-IL")}</div>
            <div className="mt-1.5 text-[13px] text-[var(--text-2)]">{c.label}</div>
            {c.sub && <div className="mt-0.5 text-[12px] text-[var(--text-3)]">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Which cities people actually open, and whether they convert. A city with
            views and no builds is a page that is not doing its job. */}
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-[15px] font-bold">ערים — צפיות מול בניות</h3>
          {!data?.topCities.length ? <Empty /> : (
            <table className="w-full text-[13.5px]">
              <thead className="text-[12px] text-[var(--text-3)]">
                <tr><th className="text-start font-normal">עיר</th><th className="text-start font-normal">צפיות</th>
                  <th className="text-start font-normal">בניות</th><th className="text-start font-normal">המרה</th></tr>
              </thead>
              <tbody>
                {data.topCities.map((c) => (
                  <tr key={c.slug} className="border-t border-[var(--border)]">
                    <td className="py-1.5">{c.slug}</td>
                    <td>{c.views}</td>
                    <td>{c.builds}</td>
                    <td className={c.views >= 5 && c.builds === 0 ? "font-bold text-[var(--amber)]" : ""}>
                      {pct(c.builds, c.views)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* The most actionable list on the page. */}
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-[15px] font-bold">חיפשו ולא מצאו</h3>
          <p className="mb-2 mt-0.5 text-[12.5px] text-[var(--text-3)]">
            כל שורה היא מישהו שאמר לנו איזה יעד להוסיף.
          </p>
          {!data?.misses.length ? <Empty /> : (
            <ul className="flex flex-col">
              {data.misses.map((m) => (
                <li key={m.q} className="flex items-center justify-between border-t border-[var(--border)] py-1.5 text-[13.5px]">
                  <span className="font-medium">{m.q}</span>
                  <span className="text-[12px] text-[var(--text-3)]">{m.n} · {m.last.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* What the builds look like — the numbers that should drive defaults. */}
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-[15px] font-bold">איך נראה טיול טיפוסי</h3>
          {!data?.buildShape.days.length && !data?.buildShape.kids.length ? <Empty /> : (
            <div className="flex flex-col gap-3 text-[13.5px]">
              <div>
                <div className="mb-1 text-[12px] text-[var(--text-3)]">מספר ימים</div>
                {data.buildShape.days.map((d) => (
                  <div key={d.days} className="flex items-center gap-2">
                    <span className="w-10 shrink-0">{d.days} ימים</span>
                    <Bar n={d.n} max={Math.max(...data.buildShape.days.map((x) => x.n))} />
                    <span className="w-8 shrink-0 text-[12px] text-[var(--text-3)]">{d.n}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-[12px] text-[var(--text-3)]">עם ילדים</div>
                {data.buildShape.kids.map((k) => (
                  <div key={String(k.kids)} className="flex items-center gap-2">
                    <span className="w-10 shrink-0">{k.kids ? "עם" : "בלי"}</span>
                    <Bar n={k.n} max={Math.max(...data.buildShape.kids.map((x) => x.n))} />
                    <span className="w-8 shrink-0 text-[12px] text-[var(--text-3)]">{k.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-[15px] font-bold">לפי יום</h3>
          {!data?.daily.length ? <Empty /> : (
            <div className="flex flex-col gap-1 text-[13px]">
              {data.daily.slice(-14).map((d) => (
                <div key={d.day} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[12px] text-[var(--text-3)]">{d.day.slice(5)}</span>
                  <Bar n={d.views} max={Math.max(...data.daily.map((x) => x.views), 1)} />
                  <span className="w-16 shrink-0 text-[12px] text-[var(--text-3)]">{d.views} · {d.builds} בניות</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const Empty = () => (
  <p className="py-3 text-[13px] text-[var(--text-3)]">אין עדיין נתונים בטווח הזה.</p>
);

const Bar = ({ n, max }: { n: number; max: number }) => (
  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
    <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${max > 0 ? (n / max) * 100 : 0}%` }} />
  </div>
);
