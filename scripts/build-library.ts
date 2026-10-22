// HOUSE LIBRARY — builds checked houses through the real pipeline and saves them to data/houses.json.
// The game picks a house from this library on every page load, so players get variety with no wait and no AI cost.
//
//   npm run library                    add 15 houses (needs ANTHROPIC_API_KEY in .env.local; about $1)
//   npm run library -- --n 5           add fewer houses
//   npm run library -- --max-usd 0.50  stop before spending more than this
//
// Only houses that pass every check (validation, code checks, AI tester, repair) are saved.
// Running it again adds to the library; houses with a title that's already there are skipped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const N = Math.max(1, Math.min(50, Number(arg("n", "15")) || 15));
const MAX_USD = Number(arg("max-usd", "1.5")) || 1.5;
const CONCURRENCY = 3;
const MAX_ATTEMPTS = N * 2; // rejected houses are retried, but never forever
const FILE = "data/houses.json";

// The run gets its own budget: the pipeline's cost cap enforces it.
process.env.DAILY_SPEND_CAP_USD = String(MAX_USD);
const { buildHouse } = await import("../lib/pipeline.ts");
const { snapshot } = await import("../lib/cost.ts");
const { SAMPLE_HOUSE, validateHouse } = await import("../lib/house.ts");
const { THEMES } = await import("../lib/themes.ts");
type House = import("../lib/house.ts").House;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("No ANTHROPIC_API_KEY found. Add it to .env.local first.");
  process.exit(1);
}
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });

const library: House[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
const titles = new Set([SAMPLE_HOUSE, ...library].map((h) => h.title.toLowerCase()));
const save = () => {
  mkdirSync("data", { recursive: true });
  writeFileSync(FILE, JSON.stringify(library, null, 2) + "\n");
};

const PER_HOUSE_RESERVE = 0.1; // stop starting new houses when less than this is left in the budget
let added = 0;
let attempts = 0;
let inFlight = 0; // houses being built right now, so workers don't start more than we need

console.log(`\nBuilding ${N} houses for the library (budget $${MAX_USD.toFixed(2)}). Already in the library: ${library.length}\n`);

async function worker() {
  while (added + inFlight < N && attempts < MAX_ATTEMPTS) {
    if (snapshot().spentTodayUsd + PER_HOUSE_RESERVE > MAX_USD) {
      console.log("Budget reached, stopping.");
      return;
    }
    const i = ++attempts;
    const t0 = Date.now();
    inFlight++;
    try {
      const res = await buildHouse(client, { age: "8-10", idea: "" }).finally(() => inFlight--);
      const monsters = res.report.plan.map((p) => THEMES[p.theme].label).join(", ");
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const cost = `$${res.report.costUsd.toFixed(3)}`;
      if (!res.ok) {
        console.log(`${String(i).padStart(3)}. REJECT ${monsters.padEnd(40)} ${cost} ${secs}s  ${res.problems[0]?.slice(0, 80) ?? ""}`);
        continue;
      }
      if (validateHouse(res.house).length || titles.has(res.house.title.toLowerCase())) {
        console.log(`${String(i).padStart(3)}. SKIP   ${monsters.padEnd(40)} ${cost} ${secs}s  duplicate title or failed recheck`);
        continue;
      }
      if (added >= N) return;
      titles.add(res.house.title.toLowerCase());
      library.push(res.house);
      added++;
      save(); // save after every house, so a crash never loses paid-for work
      console.log(`${String(i).padStart(3)}. ADDED  ${monsters.padEnd(40)} ${cost} ${secs}s  "${res.house.title}"`);
    } catch (e) {
      console.log(`${String(i).padStart(3)}. ERROR  ${(e as Error).message?.slice(0, 120)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nAdded ${added} house(s). Library now has ${library.length} (plus the built-in sample house).`);
console.log(`Spent $${snapshot().spentTodayUsd.toFixed(2)} of the $${MAX_USD.toFixed(2)} budget. Saved to ${FILE}.`);
