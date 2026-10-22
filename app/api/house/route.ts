// POST /api/house — builds a new house with a surprise mix of 3 monsters.
// Order: input guardrails → cost cap → pipeline (generate → validate → code checks → AI solver → one repair → recheck).

import { anthropic, aiError, json, noKey, visitorId } from "@/lib/ai.ts";
import { reserve, snapshot } from "@/lib/cost.ts";
import { checkInput, cleanInput, INPUT_LIMITS } from "@/lib/guardrails.ts";
import { buildHouse } from "@/lib/pipeline.ts";
import { AGE_LEVELS, type AgeLevel } from "@/lib/prompts.ts";

export const runtime = "nodejs";
export const maxDuration = 300; // generation + checks + a possible repair

export async function POST(req: Request) {
  // Off unless ENABLE_HOUSE_API=true. The game doesn't use this route (houses come from the prebuilt library),
  // and each call costs ~5¢, so on a public deploy it would only be a way for strangers to spend the API budget.
  if (process.env.ENABLE_HOUSE_API !== "true")
    return json({ ok: false, code: "disabled", message: "Building new houses is turned off on this server." }, 404);

  const body = (await req.json().catch(() => null)) as { age?: string; idea?: string } | null;
  const age: AgeLevel = AGE_LEVELS.includes(body?.age as AgeLevel) ? (body!.age as AgeLevel) : "8-10";
  const idea = cleanInput(body?.idea, INPUT_LIMITS.ideaChars);

  // 1. Input guardrail — blocked ideas never reach the AI (and cost nothing).
  if (idea) {
    const chk = checkInput(idea, "idea");
    if (chk.block) return json({ ok: false, code: "blocked", reason: chk.reason, message: chk.say });
  }

  const ai = anthropic();
  if (!ai) return noKey();

  // 2. Cost cap.
  const gate = reserve("house", visitorId(req));
  if (!gate.ok) return json({ ok: false, code: "capped", reason: gate.reason, message: gate.message, usage: snapshot() }, 429);

  // 3. Build, check and (if needed) repair.
  try {
    const result = await buildHouse(ai, { age, idea });
    const r = result.report;
    const call = {
      inputTokens: r.calls.reduce((s, c) => s + c.inputTokens, 0),
      outputTokens: r.calls.reduce((s, c) => s + c.outputTokens, 0),
      costUsd: r.costUsd,
    };
    if (result.ok) return json({ ok: true, house: result.house, report: r, call, usage: snapshot() });
    return json({
      ok: false,
      code: "rejected",
      problems: result.problems,
      report: r,
      message: "The new house didn't pass the safety and correctness checks, so it was thrown away. Try again!",
      call,
      usage: snapshot(),
    });
  } catch (e) {
    return aiError(e);
  }
}
