"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Sparkles, Loader2, MapPin, ArrowLeft, Users } from "lucide-react";
import { useProfile, profileText, profileSummary, MONTHS_HE } from "@/lib/store";

type Reco = {
  id: number; city: string; city_he: string | null;
  country: string; country_he: string | null; total: number;
  reason: string; highlights: string;
};

export default function RecommendPage() {
  const [profile] = useProfile();
  const [month, setMonth] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [recos, setRecos] = useState<Reco[]>([]);
  const [msg, setMsg] = useState("");

  async function recommend() {
    setStatus("loading"); setMsg("");
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileText: profileText(profile), month }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) { setStatus("error"); setMsg(data?.error || "אירעה שגיאה"); return; }
      setRecos(data.recommendations || []);
      setStatus("done");
    } catch {
      setStatus("error"); setMsg("שגיאת רשת");
    }
  }

  return (
    <main className="mx-auto w-full max-w-[440px] px-5 pb-28 pt-8 lg:max-w-2xl lg:px-8">
      <Link href="/" className="eyebrow mb-3 inline-flex items-center gap-1">
        <ChevronRight size={14} /> בית
      </Link>
      <h1 className="serif text-[30px] leading-none lg:text-[38px]">לאן כדאי לכם?</h1>
      <p className="mt-3 text-[14px] text-[var(--text-2)]">
        לא יודעים לאן לטוס? ספרו לנו מי נוסע ומתי, וה-AI ימליץ על יעדים שמתאימים לכם.
      </p>

      <div className="mt-5 flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow)]">
        <span className="flex items-center gap-2 text-[13px] text-[var(--text-2)]">
          <Users size={15} /> {profileSummary(profile)}
        </span>
        <Link href="/profile" className="text-[12px] text-[var(--accent-ink)]">ערוך פרופיל</Link>
      </div>

      <div className="mt-4">
        <label className="mb-1.5 block text-[13px] text-[var(--text-2)]">מתי בערך? (לעונה)</label>
        <div className="grid grid-cols-4 gap-1.5">
          {MONTHS_HE.map((m, i) => {
            const on = month === i + 1;
            return (
              <button key={m} onClick={() => setMonth(on ? null : i + 1)}
                className="rounded-lg py-2 text-[12.5px] transition"
                style={{ background: on ? "var(--accent)" : "var(--surface-2)",
                         color: on ? "#fff" : "var(--text-2)", fontWeight: on ? 500 : 400 }}>
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <button onClick={recommend} disabled={status === "loading"}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] py-3 text-[15px] font-medium text-white disabled:opacity-50">
        {status === "loading" ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
        {status === "loading" ? "חושב לאן…" : "המליצו לי יעד"}
      </button>
      {status === "error" && <p className="mt-2 text-[12.5px] text-[var(--amber)]">{msg}</p>}

      {status === "done" && (
        <div className="mt-6 flex flex-col gap-3">
          {recos.length === 0 && <p className="text-center text-[14px] text-[var(--text-3)]">לא נמצאו המלצות.</p>}
          {recos.map((r, i) => (
            <Link key={r.id} href={`/destination/${r.id}`}
              className="rise block rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]">
              <div className="flex items-start gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-ink)] font-bold">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-[var(--accent-ink)]" />
                    <p className="serif text-[19px] leading-tight">{r.city_he || r.city}</p>
                    <span className="text-[12px] text-[var(--text-3)]">{r.country_he || r.country}</span>
                  </div>
                  {r.highlights && <p className="mt-1 text-[12.5px] font-medium text-[var(--brand-ink)]">{r.highlights}</p>}
                  <p className="mt-1 text-[13.5px] text-[var(--text-2)]">{r.reason}</p>
                </div>
                <ArrowLeft size={18} className="mt-1 shrink-0 text-[var(--text-3)]" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
