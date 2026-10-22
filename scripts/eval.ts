// EVAL — builds many houses through the real pipeline and reports how reliable and affordable it is.
//
//   npm run eval                     20 real houses (needs ANTHROPIC_API_KEY in .env.local; about $1)
//   npm run eval -- --n 5            fewer houses
//   npm run eval -- --max-usd 0.50   stop before spending more than this
//   npm run eval -- --mock           free offline run: a fake Claude that sometimes writes broken puzzles,
//                                    to show the checks and repair working
//
// Results are printed and saved to evals/results-<time>.json.

import { mkdirSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";

const args = process.argv.slice(2);
const arg = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const MOCK = args.includes("--mock");
const N = Math.max(1, Math.min(100, Number(arg("n", "20")) || 20));
const MAX_USD = Number(arg("max-usd", "3")) || 3;
const CONCURRENCY = Math.max(1, Math.min(4, Number(arg("concurrency", "2")) || 2));

// The eval gets its own budget: the pipeline's cost cap enforces it.
process.env.DAILY_SPEND_CAP_USD = String(MAX_USD);
const { buildHouse } = await import("../lib/pipeline.ts");
const { snapshot } = await import("../lib/cost.ts");
const { planOf, SAMPLE_HOUSE } = await import("../lib/house.ts");
const { THEMES } = await import("../lib/themes.ts");
const { AGE_LEVELS } = await import("../lib/prompts.ts");
type Claude = import("../lib/pipeline.ts").Claude;
type BuildResult = import("../lib/pipeline.ts").BuildResult;

/* ---------------- the client: real Claude, or a mock that simulates typical mistakes ---------------- */

type Scenario = "clean" | "wrong-code" | "wrong-riddle" | "repair-fails" | "broken-shape";
const SCENARIOS: Scenario[] = ["clean", "clean", "clean", "clean", "clean", "wrong-code", "wrong-code", "wrong-riddle", "wrong-riddle", "repair-fails", "broken-shape"];

function mockClient(scenario: Scenario): Claude {
  const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) as Anthropic.Usage;
  const reply = (name: string, input: unknown, u: Anthropic.Usage) =>
    ({ id: "mock", type: "message", role: "assistant", model: "mock", stop_reason: "tool_use", stop_sequence: null, usage: u,
       content: [{ type: "tool_use", id: "t", name, input }] }) as unknown as Anthropic.Message;
  return {
    messages: {
      async create(p) {
        await new Promise((r) => setTimeout(r, 20));
        const tool = (p.tools?.[0] as { name: string }).name;
        if (tool === "create_house") {
          const h = structuredClone(SAMPLE_HOUSE);
          if (scenario === "wrong-code") h.rooms[2].puzzles[0].answer = "candies"; // code spells CANDY
          if (scenario === "wrong-riddle" || scenario === "repair-fails") Object.assign(h.rooms[0].puzzles[3], { answer: "night", alternates: [] }); // the riddle's real answer is "dark"
          if (scenario === "repair-fails") h.rooms[1].puzzles[1].clue = "Letters on the spell book: R O M O B S"; // extra S
          if (scenario === "broken-shape") h.rooms.pop();
          return reply(tool, h, usage(3400, 2900));
        }
        if (tool === "submit_answers") {
          // The mock solver knows the true answers.
          const answers = SAMPLE_HOUSE.rooms.flatMap((r, ri) => r.puzzles.map((z, pi) => ({ id: `r${ri + 1}p${pi + 1}`, answer: z.answer, unsure: false })));
          return reply(tool, { answers }, usage(1300, 420));
        }
        if (tool === "fix_puzzles") {
          const text = String((p.messages[0] as { content: string }).content);
          const ids = [...text.slice(text.indexOf("PROBLEMS TO FIX")).matchAll(/\[(r\dp\d)\]/g)].map((m) => m[1]);
          const fixes = [...new Set(ids)].map((id) => {
            const [ri, pi] = [Number(id[1]) - 1, Number(id[3]) - 1];
            const good = SAMPLE_HOUSE.rooms[ri].puzzles[pi];
            // In "repair-fails", the fixer corrects the riddle but leaves the jumbled letters broken.
            if (scenario === "repair-fails" && id === "r2p2") return { id, ...good, clue: "Letters on the spell book: R O M O B S" };
            return { id, ...good };
          });
          return reply(tool, { fixes }, usage(3100, 650));
        }
        throw new Error(`mock: unexpected tool ${tool}`);
      },
    },
  };
}

let realClient: Claude | null = null;
if (!MOCK) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("No ANTHROPIC_API_KEY found. Add it to .env.local, or run a free practice eval with: npm run eval -- --mock");
    process.exit(1);
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  realClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
}

/* ---------------- run ---------------- */

interface Row {
  i: number;
  age: string;
  scenario?: Scenario;
  monsters: string[];
  ok: boolean;
  firstDraftPassed: boolean;
  repairAttempted: boolean;
  repaired: number;
  costUsd: number;
  seconds: number;
  issues: { source: string; message: string }[];
  warnings: string[];
  error?: string;
}
const rows: Row[] = [];
const PER_HOUSE_RESERVE = 0.1; // stop starting new houses when less than this is left in the budget
let next = 0;

console.log(`\nHollow House Escape eval — ${N} houses${MOCK ? " (MOCK: simulated Claude, no cost)" : ""}, budget $${MAX_USD.toFixed(2)}\n`);

async function worker() {
  while (next < N) {
    const i = next++;
    if (snapshot().spentTodayUsd + PER_HOUSE_RESERVE > MAX_USD) {
      rows.push({ i, age: "-", monsters: [], ok: false, firstDraftPassed: false, repairAttempted: false, repaired: 0, costUsd: 0, seconds: 0, issues: [], warnings: [], error: "skipped: eval budget reached" });
      continue;
    }
    const age = AGE_LEVELS[i % AGE_LEVELS.length];
    const scenario = MOCK ? SCENARIOS[i % SCENARIOS.length] : undefined;
    const client = MOCK ? mockClient(scenario!) : realClient!;
    const t0 = Date.now();
    let res: BuildResult | null = null;
    let error: string | undefined;
    try {
      res = await buildHouse(client, { age, idea: "", plan: MOCK ? planOf(SAMPLE_HOUSE) : undefined });
    } catch (e) {
      error = (e as Error).message?.slice(0, 160) || "error";
    }
    const r = res?.report;
    const row: Row = {
      i, age, scenario,
      monsters: (r?.plan ?? []).map((p) => THEMES[p.theme].label),
      ok: !!res?.ok,
      firstDraftPassed: !!r?.firstDraft.passed,
      repairAttempted: !!r?.repair.attempted,
      repaired: r?.repair.fixed ?? 0,
      costUsd: r?.costUsd ?? 0,
      seconds: (Date.now() - t0) / 1000,
      issues: (r?.firstDraft.issues ?? []).map((x) => ({ source: x.source, message: x.message })),
      warnings: r?.warnings ?? [],
      error,
    };
    rows.push(row);
    const status = error ? "ERROR " : row.ok ? (row.firstDraftPassed ? "PASS  " : "FIXED ") : "REJECT";
    console.log(
      `${String(i + 1).padStart(3)}. ${status} ${row.age.padEnd(5)} ${row.monsters.join(", ").padEnd(42)} $${row.costUsd.toFixed(3)}  ${row.seconds.toFixed(1)}s` +
        (scenario ? `  [${scenario}]` : "") +
        (error ? `  ${error}` : row.issues.length ? `  ${row.issues.length} issue(s) in first draft` : ""),
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
rows.sort((a, b) => a.i - b.i);

/* ---------------- report ---------------- */

const ran = rows.filter((r) => !r.error);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
const firstPass = ran.filter((r) => r.firstDraftPassed).length;
const finalPass = ran.filter((r) => r.ok).length;
const repairs = ran.filter((r) => r.repairAttempted);
const repairWins = repairs.filter((r) => r.ok).length;
const cost = ran.reduce((s, r) => s + r.costUsd, 0);
const shipped = ran.filter((r) => r.ok);

const reasons = new Map<string, number>();
for (const r of ran)
  for (const x of r.issues) {
    const type = x.message.match(/\(([^)]+)\):/)?.[1];
    const key =
      x.source === "code" ? `code check: ${type} doesn't match its answer`
      : x.source === "solver" ? `AI solver disagreed: ${type}`
      : `validator: ${x.message.replace(/^room \d+ (puzzle \d+ )?/, "")}`.slice(0, 80);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
const monsters = new Map<string, number>();
for (const r of ran) for (const m of r.monsters) monsters.set(m, (monsters.get(m) ?? 0) + 1);

const line = "─".repeat(64);
console.log(`\n${line}\nRESULTS${MOCK ? " (mock)" : ""}\n${line}`);
console.log(`Houses built:                ${ran.length}${rows.length - ran.length ? `  (${rows.length - ran.length} errored or skipped)` : ""}`);
console.log(`Passed on the first draft:   ${firstPass}  (${pct(firstPass, ran.length)})`);
console.log(`Repairs attempted:           ${repairs.length}, succeeded ${repairWins}  (${pct(repairWins, repairs.length)})`);
console.log(`Passed in the end (shipped): ${finalPass}  (${pct(finalPass, ran.length)})`);
console.log(`Rejected (kids never see):   ${ran.length - finalPass}`);
console.log(`Avg cost per house:          $${(cost / Math.max(1, ran.length)).toFixed(3)}   total $${cost.toFixed(2)}`);
console.log(`Avg cost per shipped house:  $${(cost / Math.max(1, shipped.length)).toFixed(3)}`);
console.log(`Avg time per house:          ${(ran.reduce((s, r) => s + r.seconds, 0) / Math.max(1, ran.length)).toFixed(1)} s`);
console.log(`Houses per $2 daily cap:     about ${Math.floor(2 / Math.max(0.001, cost / Math.max(1, shipped.length)))}`);
if (reasons.size) {
  console.log(`\nMost common first-draft problems:`);
  [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, n]) => console.log(`  ${String(n).padStart(3)} × ${k}`));
}
const warnCount = ran.reduce((s, r) => s + r.warnings.length, 0);
if (warnCount) console.log(`\nWarnings (not blocking): ${warnCount}  — see the JSON file for details`);
if (!MOCK) console.log(`\nMonster mix: ${[...monsters].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(", ")}`);

mkdirSync("evals", { recursive: true });
const file = `evals/results-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}${MOCK ? "-mock" : ""}.json`;
writeFileSync(
  file,
  JSON.stringify(
    { when: new Date().toISOString(), mock: MOCK, n: N, summary: { built: ran.length, firstDraftPass: firstPass, finalPass, repairsAttempted: repairs.length, repairsSucceeded: repairWins, totalCostUsd: cost }, reasons: Object.fromEntries(reasons), rows },
    null,
    2,
  ),
);
console.log(`\nSaved ${file}\n`);
