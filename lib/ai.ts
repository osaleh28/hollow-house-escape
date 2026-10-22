// Server-only helpers: the Anthropic client, visitor identity, and friendly error messages.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

let client: Anthropic | null = null;
export function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 90_000, // a house takes ~20-60 s
    maxRetries: 2, // the SDK retries 429/5xx with backoff, at most twice
  });
  return client;
}

/** A rough visitor id for per-visitor limits (IP from the hosting proxy). */
export function visitorId(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim().slice(0, 64);
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function noKey() {
  return json({ ok: false, code: "not_configured", message: "The AI isn't set up yet. Add ANTHROPIC_API_KEY to .env.local and restart." }, 503);
}

/** Maps API failures to messages a kid (or grown-up) can act on. Never leaks raw errors. */
export function aiError(e: unknown) {
  if (e instanceof Anthropic.APIError) {
    const s = e.status ?? 0;
    if (s === 401 || s === 403) return json({ ok: false, code: "auth", message: "The AI key isn't working. A grown-up needs to check the server settings." }, 502);
    if (s === 429) return json({ ok: false, code: "rate_limited", message: "The AI needs a little rest. Try again in a minute." }, 429);
    if (s === 529 || s >= 500) return json({ ok: false, code: "busy", message: "The AI is very busy right now. Try again soon." }, 503);
    if (s === 400) return json({ ok: false, code: "bad_request", message: "Something went wrong making that request. Try again." }, 502);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError || (e as Error)?.name === "APIConnectionTimeoutError")
    return json({ ok: false, code: "timeout", message: "That took too long. Try again." }, 504);
  console.error("[ai] unexpected error", e);
  return json({ ok: false, code: "error", message: "Something went wrong. Try again!" }, 500);
}
