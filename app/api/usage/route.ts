// GET /api/usage — whether the AI is set up, and today's AI spending against the cap.

import { json } from "@/lib/ai.ts";
import { snapshot } from "@/lib/cost.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return json({ ok: true, configured: !!process.env.ANTHROPIC_API_KEY, usage: snapshot() });
}
