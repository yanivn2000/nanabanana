import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "./db";

// Best-effort client IP behind Vercel's proxy. x-forwarded-for is a comma list
// (client, proxies…) — take the first. Falls back to a constant so a missing
// header buckets everyone together (fails safe toward limiting, not bypassing).
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Guard a route: returns a 429 Response if over the limit, else null. The bucket
// namespaces the limit per route so they don't share a counter.
export async function rateLimit(
  req: NextRequest, name: string, limit: number, windowSec: number
): Promise<NextResponse | null> {
  const { ok } = await checkRateLimit(`${name}:${clientIp(req)}`, limit, windowSec);
  if (ok) return null;
  return NextResponse.json(
    { error: "rate_limited", message: "יותר מדי בקשות — נסו שוב בעוד רגע." },
    { status: 429, headers: { "Retry-After": String(windowSec) } });
}

// Honeypot: a form field real users never see/fill. Any non-empty value → bot.
// The client sends `hp: ""`; a bot that auto-fills every field trips it.
export function honeypotTripped(body: unknown): boolean {
  const hp = (body as { hp?: unknown } | null)?.hp;
  return typeof hp === "string" && hp.trim().length > 0;
}
