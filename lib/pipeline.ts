// THE HOUSE PIPELINE — shared by the /api/house route and the eval script.
//
//   1. plan      the server picks 3 monsters + puzzle types        (code)
//   2. generate  Claude writes the house                           (Sonnet, forced tool)
//   3. validate  shape, plan, kid-safety                           (code)
//   4. check     code checks for decodable puzzles                 (code, exact)
//                AI solver tries the rest without the answer key   (Haiku, cheap)
//   5. repair    one try: Claude rewrites only the broken puzzles  (Sonnet)
//   6. recheck   validate + code checks must pass; the solver's second opinion becomes a warning
//
// Every AI call passes the daily cost cap first. Nothing here loops: at most 4 calls per house.

import type Anthropic from "@anthropic-ai/sdk";
import { codeCheckHouse, validatorIssues, type Issue, type Verdict } from "./checks.ts";
import { CALL_LIMITS, LIMITS, MODELS, record, reserveExtra } from "./cost.ts";
import { cleanHouse, isCorrect, norm, validateHouse, type House, type Puzzle } from "./house.ts";
import {
  HOUSE_TOOL, makerTask, REPAIR_TOOL, repairTask, SOLVER_TOOL, solverTask,
  SYSTEM_MAKER, SYSTEM_REPAIR, SYSTEM_SOLVER, type AgeLevel,
} from "./prompts.ts";
import { planHouse, type RoomPlan } from "./themes.ts";

/** The one method we use from the Anthropic client (lets the eval swap in a mock). */
export interface Claude {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions): Promise<Anthropic.Message> };
}

export type Step = "house" | "solver" | "repair";
export interface CallRecord { step: Step; model: string; inputTokens: number; outputTokens: number; costUsd: number; ms: number }
export interface BuildReport {
  plan: RoomPlan[];
  firstDraft: { passed: boolean; issues: Issue[] };
  repair: { attempted: boolean; fixed: number; note?: string };
  final: { passed: boolean; issues: Issue[] };
  warnings: string[];
  checks: { total: number; byCode: number; bySolver: number; solverRan: boolean };
  calls: CallRecord[];
  costUsd: number;
  ms: number;
}
export type BuildResult =
  | { ok: true; house: House; report: BuildReport }
  | { ok: false; problems: string[]; report: BuildReport };

const MAX_PUZZLES_TO_REPAIR = 6; // more than half broken = regenerate, not repair

/**
 * Sonnet 5.5 thinks by default, and thinking tokens count toward max_tokens, which cut houses off mid-write.
 * "between_tools" is Sonnet 5.5's way to turn thinking off (it rejects "disabled"); the code checks, AI tester
 * and repair catch wrong puzzles instead. Our SDK version predates this setting, hence the cast.
 */
const noThinking = (model: string) =>
  model === "claude-sonnet-5-5" ? ({ type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam) : undefined;
const pid = (r: number, p: number) => `r${r + 1}p${p + 1}`;

function toolInput(msg: Anthropic.Message, name: string): unknown {
  const b = msg.content.find((c) => c.type === "tool_use" && c.name === name);
  return b?.type === "tool_use" ? b.input : null;
}

/** Does the solver's answer match the key? Lenient on plurals and extra words ("the dark" vs "dark"). */
export function solverAgrees(z: Puzzle, given: string) {
  if (isCorrect(z, given)) return true;
  const g = norm(given);
  if (g.length < 3) return false;
  return [z.answer, ...(z.alternates || [])].map(norm).some((a) => a.length >= 3 && (g.includes(a) || a.includes(g)));
}

export async function buildHouse(ai: Claude, opts: { age: AgeLevel; idea: string; plan?: RoomPlan[] }): Promise<BuildResult> {
  const t0 = Date.now();
  const plan = opts.plan ?? planHouse();
  const calls: CallRecord[] = [];
  const warnings: string[] = [];
  const report: BuildReport = {
    plan,
    firstDraft: { passed: false, issues: [] },
    repair: { attempted: false, fixed: 0 },
    final: { passed: false, issues: [] },
    warnings,
    checks: { total: 0, byCode: 0, bySolver: 0, solverRan: false },
    calls,
    costUsd: 0,
    ms: 0,
  };
  const finish = <T extends BuildResult>(r: T): T => {
    report.costUsd = calls.reduce((s, c) => s + c.costUsd, 0);
    report.ms = Date.now() - t0;
    return r;
  };
  const fail = (problems: string[]) => finish({ ok: false as const, problems, report });

  async function call(step: Step, model: string, params: Anthropic.MessageCreateParamsNonStreaming) {
    const start = Date.now();
    const msg = await ai.messages.create(params, CALL_LIMITS[step]);
    calls.push({ step, model, ...record(step, model, msg.usage), ms: Date.now() - start });
    return msg;
  }

  /** The AI solver: one cheap call that answers all 12 puzzles without the key. Never throws. */
  async function solve(house: House, verdicts: Verdict[][]) {
    const out = { issues: [] as Issue[], notes: [] as string[], ran: false, agreed: 0 };
    const gate = reserveExtra("solver");
    if (!gate.ok) {
      out.notes.push("Skipped the AI solver check: the daily cost cap is nearly reached.");
      return out;
    }
    let answers: { id?: string; answer?: string; unsure?: boolean }[] = [];
    try {
      const msg = await call("solver", MODELS.solver, {
        model: MODELS.solver,
        max_tokens: LIMITS.solverMaxTokens,
        system: SYSTEM_SOLVER,
        tools: [SOLVER_TOOL],
        tool_choice: { type: "tool", name: SOLVER_TOOL.name },
        messages: [{ role: "user", content: solverTask(house) }],
      });
      answers = ((toolInput(msg, SOLVER_TOOL.name) as { answers?: typeof answers })?.answers ?? []).filter(Boolean);
      out.ran = true;
    } catch {
      out.notes.push("The AI solver check was unavailable, so only the code checks ran.");
      return out;
    }
    const byId = new Map(answers.map((a) => [String(a.id).toLowerCase(), a]));
    house.rooms.forEach((r, ri) =>
      r.puzzles.forEach((z, pi) => {
        if (verdicts[ri]?.[pi] === "pass") return; // already proven by code
        const a = byId.get(pid(ri, pi));
        if (!a?.answer) return;
        if (solverAgrees(z, a.answer)) {
          out.agreed++;
          if (a.unsure) out.notes.push(`Room ${ri + 1} puzzle ${pi + 1} (${z.type}): the AI tester got it right but found it confusing.`);
        } else {
          out.issues.push({
            room: ri, puzzle: pi, source: "solver",
            message: `room ${ri + 1} puzzle ${pi + 1} (${z.type}): an AI tester answered "${String(a.answer).slice(0, 40)}" but the answer key says "${z.answer}". Make the clue lead clearly to one answer, or fix the answer.`,
          });
        }
      }),
    );
    return out;
  }

  // 2. Generate
  const msg = await call("house", MODELS.house, {
    model: MODELS.house,
    max_tokens: LIMITS.houseMaxTokens,
    system: SYSTEM_MAKER,
    tools: [HOUSE_TOOL],
    tool_choice: { type: "auto", disable_parallel_tool_use: true }, // one call only; Sonnet 5.5 rejects forced tool_choice; SYSTEM_MAKER rule 1 says to call the tool, and the validator rejects a reply without it
    thinking: noThinking(MODELS.house),
    messages: [{ role: "user", content: makerTask(opts.age, opts.idea, plan) }],
  });
  if (msg.stop_reason === "max_tokens") return fail(["the house was cut off before it was finished"]);
  const raw = toolInput(msg, HOUSE_TOOL.name) as House | null;

  // 3. Validate. Problems that aren't about one puzzle (missing rooms, wrong monster, unsafe words) can't be repaired.
  const problems = validateHouse(raw, plan);
  const vIssues = validatorIssues(problems);
  if (!raw || vIssues.some((i) => i.puzzle === undefined)) {
    report.firstDraft.issues = vIssues;
    report.final.issues = vIssues;
    return fail(problems);
  }
  let house = cleanHouse(raw);

  // 4. Check
  let code = codeCheckHouse(house);
  const s1 = await solve(house, code.verdicts);
  report.checks.solverRan = s1.ran;
  const firstIssues = [...vIssues, ...code.issues, ...s1.issues];
  report.firstDraft = { passed: firstIssues.length === 0, issues: firstIssues };

  if (firstIssues.length === 0) {
    warnings.push(...s1.notes);
    report.final.passed = true;
    report.checks = { total: 12, byCode: count(code.verdicts, "pass"), bySolver: s1.agreed, solverRan: s1.ran };
    return finish({ ok: true as const, house, report });
  }

  // 5. Repair — once, only the broken puzzles
  const broken = new Map<string, string[]>();
  for (const i of firstIssues) broken.set(pid(i.room, i.puzzle!), [...(broken.get(pid(i.room, i.puzzle!)) ?? []), i.message]);
  if (broken.size > MAX_PUZZLES_TO_REPAIR) {
    report.repair.note = `${broken.size} puzzles had problems, too many to repair.`;
    report.final.issues = firstIssues;
    return fail(firstIssues.map((i) => i.message));
  }
  const gate = reserveExtra("repair");
  if (!gate.ok) {
    report.repair.note = "Skipped repair: the daily cost cap is nearly reached.";
    report.final.issues = firstIssues;
    return fail(firstIssues.map((i) => i.message));
  }
  report.repair.attempted = true;
  try {
    const fixMsg = await call("repair", MODELS.repair, {
      model: MODELS.repair,
      max_tokens: LIMITS.repairMaxTokens,
      system: SYSTEM_REPAIR,
      tools: [REPAIR_TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true }, // one call only; Sonnet 5.5 rejects forced tool_choice; SYSTEM_REPAIR rule 1 says to call the tool
      thinking: noThinking(MODELS.repair),
      messages: [{ role: "user", content: repairTask(house, [...broken].map(([id, msgs]) => ({ id, message: msgs.join(" Also: ") }))) }],
    });
    const fixes = ((toolInput(fixMsg, REPAIR_TOOL.name) as { fixes?: (Partial<Puzzle> & { id?: string })[] })?.fixes ?? []).filter(Boolean);
    const next: House = structuredClone(house);
    for (const f of fixes) {
      const m = String(f.id ?? "").toLowerCase().match(/^r(\d)p(\d)$/);
      if (!m || !broken.has(m[0])) continue; // only touch puzzles we asked to fix
      const [ri, pi] = [Number(m[1]) - 1, Number(m[2]) - 1];
      const old = next.rooms[ri]?.puzzles[pi];
      if (!old) continue;
      next.rooms[ri].puzzles[pi] = {
        type: old.type, // the type is part of the plan and never changes
        title: String(f.title ?? old.title),
        clue: String(f.clue ?? old.clue),
        question: String(f.question ?? old.question),
        answer: String(f.answer ?? old.answer),
        alternates: Array.isArray(f.alternates) ? f.alternates.map(String) : old.alternates,
        hint: String(f.hint ?? old.hint),
      };
      report.repair.fixed++;
    }
    house = cleanHouse(next);
  } catch {
    report.repair.note = "The repair step was unavailable.";
    report.final.issues = firstIssues;
    return fail(firstIssues.map((i) => i.message));
  }

  // 6. Recheck. Validator + code checks are proof and must pass; a second solver disagreement is only a warning,
  //    because the solver itself can be wrong (riddles especially).
  const problems2 = validateHouse(house, plan);
  code = codeCheckHouse(house);
  const s2 = await solve(house, code.verdicts);
  const blocking = [...validatorIssues(problems2), ...code.issues];
  report.final = { passed: blocking.length === 0, issues: blocking };
  warnings.push(...s2.notes, ...s2.issues.map((i) => `After repair, ${i.message}`));
  report.checks = { total: 12, byCode: count(code.verdicts, "pass"), bySolver: s2.agreed, solverRan: s2.ran };
  if (blocking.length) return fail(blocking.map((i) => i.message));
  return finish({ ok: true as const, house, report });
}

const count = (v: Verdict[][], x: Verdict) => v.flat().filter((y) => y === x).length;
