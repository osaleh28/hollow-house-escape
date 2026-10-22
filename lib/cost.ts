// COST CAP — server only. Every AI call must pass `reserve()` first, then `record()` the real usage.
//
// - A hard daily spend cap for the whole app (DAILY_SPEND_CAP_USD), checked against the
//   worst case for the next call (its input estimate + its full max_tokens), so a call can
//   never push spending past the cap.
// - Per-visitor daily limits on houses and helper questions.
// - Real cost is computed from the token counts the API returns, not guesses.
//
// The ledger lives in server memory. That's fine for a class demo or a single server; on
// serverless hosting each instance keeps its own ledger and it resets on cold start, so for
// production swap `store` for Redis / Vercel KV (same shape).

import type Anthropic from "@anthropic-ai/sdk";

/** USD per 1M tokens. From https://platform.claude.com/docs/en/about-claude/pricing */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const FALLBACK_PRICE = { input: 5, output: 25 }; // unknown model → assume expensive, so the cap stays safe

export const MODELS = {
  house: process.env.HOUSE_MODEL || "claude-sonnet-5-5",
  helper: process.env.HELPER_MODEL || "claude-haiku-5-5",
  solver: process.env.SOLVER_MODEL || "claude-haiku-5-5", // tries to solve each puzzle without the answer key
  repair: process.env.HOUSE_MODEL || "claude-sonnet-5-5", // fixes only the puzzles that failed a check
};

const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const LIMITS = {
  dailySpendCapUsd: num(process.env.DAILY_SPEND_CAP_USD, 2),
  housesPerVisitorPerDay: num(process.env.HOUSES_PER_VISITOR_PER_DAY, 5),
  helperPerVisitorPerDay: num(process.env.HELPER_QUESTIONS_PER_VISITOR_PER_DAY, 60),
  helperPerRoom: 5,
  houseMaxTokens: 6000, // a full house is ~2,900-4,500 output tokens
  helperMaxTokens: 120, // 1-2 sentences
  houseInputEstimate: 3500, // system prompt + room plan + tool schema
  helperInputEstimate: 900,
  solverMaxTokens: 1500, // 12 short answers
  solverInputEstimate: 3000,
  repairMaxTokens: 3000, // only the broken puzzles are rewritten
  repairInputEstimate: 6000,
};

/**
 * Per-call time limits, so players never wait long. Each worst case (every attempt timing out, plus backoff)
 * stays under the route's maxDuration, so our spooky message is always sent before the host cuts the function off.
 *   helper: 8 s × 2 tries ≈ 17 s                                   (route maxDuration 30 s)
 *   house:  75 + 20 + 45 + 20 s ≈ 160 s for generate, solve, repair, re-solve   (route maxDuration 300 s)
 */
export const CALL_LIMITS = {
  helper: { timeout: 8_000, maxRetries: 1 },
  house: { timeout: 75_000, maxRetries: 0 },
  solver: { timeout: 20_000, maxRetries: 0 },
  repair: { timeout: 45_000, maxRetries: 0 },
};

/**
 * Turns thinking off. The 5.5 models think by default, and thinking tokens count toward max_tokens, so a
 * helper reply could stop mid-word ("put your finger on the G") and a house could be cut off. Each model has
 * its own off switch: Sonnet 5.5 rejects "disabled" and uses "between_tools"; Haiku 5.5 takes "disabled".
 * Our SDK version predates "between_tools", hence the cast.
 */
export function noThinking(model: string): Anthropic.ThinkingConfigParam | undefined {
  if (model === "claude-sonnet-5-5") return { type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam;
  if (model === "claude-haiku-5-5") return { type: "disabled" };
  return undefined;
}

type Kind = "house" | "helper";
type CallKind = Kind | "solver" | "repair";
interface Ledger {
  day: string;
  spentUsd: number;
  calls: Record<CallKind, number>;
  inputTokens: number;
  outputTokens: number;
  visitors: Map<string, Record<Kind, number>>;
}

const g = globalThis as unknown as { __hhLedger?: Ledger };
const today = () => new Date().toISOString().slice(0, 10);
function store(): Ledger {
  if (!g.__hhLedger || g.__hhLedger.day !== today()) {
    g.__hhLedger = { day: today(), spentUsd: 0, calls: { house: 0, helper: 0, solver: 0, repair: 0 }, inputTokens: 0, outputTokens: 0, visitors: new Map() };
  }
  return g.__hhLedger;
}

export function costOf(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export type Gate = { ok: true } | { ok: false; message: string; reason: string };

/** Checks every limit before a call. Counts the visitor's call only if it is allowed. */
export function reserve(kind: Kind, visitor: string): Gate {
  const s = store();
  const v = s.visitors.get(visitor) ?? { house: 0, helper: 0 };
  if (kind === "house" && v.house >= LIMITS.housesPerVisitorPerDay)
    return { ok: false, reason: "visitor house limit", message: "That's all the new houses for today. Come back tomorrow, or play this one again!" };
  if (kind === "helper" && v.helper >= LIMITS.helperPerVisitorPerDay)
    return { ok: false, reason: "visitor helper limit", message: "Your helper is all talked out for today. You can do it!" };

  const model = kind === "house" ? MODELS.house : MODELS.helper;
  const worstCase =
    kind === "house"
      ? costOf(model, LIMITS.houseInputEstimate, LIMITS.houseMaxTokens)
      : costOf(model, LIMITS.helperInputEstimate, LIMITS.helperMaxTokens);
  if (s.spentUsd + worstCase > LIMITS.dailySpendCapUsd)
    return { ok: false, reason: "daily spend cap", message: "The AI is out of energy for today. The game still works without it!" };

  v[kind]++;
  s.visitors.set(visitor, v);
  return { ok: true };
}

/** Checks the daily cap for a follow-up call inside a house build (solver or repair); no per-visitor count. */
export function reserveExtra(kind: "solver" | "repair"): Gate {
  const s = store();
  const worstCase =
    kind === "solver"
      ? costOf(MODELS.solver, LIMITS.solverInputEstimate, LIMITS.solverMaxTokens)
      : costOf(MODELS.repair, LIMITS.repairInputEstimate, LIMITS.repairMaxTokens);
  if (s.spentUsd + worstCase > LIMITS.dailySpendCapUsd)
    return { ok: false, reason: "daily spend cap", message: "The AI is out of energy for today." };
  return { ok: true };
}

/** Records the real token usage the API reported. Returns this call's cost. */
export function record(kind: CallKind, model: string, usage: Anthropic.Usage) {
  const s = store();
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const output = usage.output_tokens ?? 0;
  const cost = costOf(model, input, output);
  s.spentUsd += cost;
  s.calls[kind]++;
  s.inputTokens += input;
  s.outputTokens += output;
  return { inputTokens: input, outputTokens: output, costUsd: cost };
}

export function snapshot() {
  const s = store();
  return {
    day: s.day,
    spentTodayUsd: s.spentUsd,
    capUsd: LIMITS.dailySpendCapUsd,
    remainingPct: Math.max(0, Math.round(100 * (1 - s.spentUsd / LIMITS.dailySpendCapUsd))),
    houseCalls: s.calls.house,
    helperCalls: s.calls.helper,
    solverCalls: s.calls.solver,
    repairCalls: s.calls.repair,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    models: MODELS,
    limits: {
      housesPerVisitorPerDay: LIMITS.housesPerVisitorPerDay,
      helperPerVisitorPerDay: LIMITS.helperPerVisitorPerDay,
      helperPerRoom: LIMITS.helperPerRoom,
      houseMaxTokens: LIMITS.houseMaxTokens,
      helperMaxTokens: LIMITS.helperMaxTokens,
    },
  };
}
export type UsageSnapshot = ReturnType<typeof snapshot>;
