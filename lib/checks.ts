// CORRECTNESS CHECKS (part 1): exact code checks for puzzles whose answer can be computed.
// These are free, instant and certain. Anything code can't verify goes to the AI solver (lib/pipeline.ts).

import { canonType, norm, type House, type Puzzle } from "./house.ts";

export type Verdict = "pass" | "fail" | "unchecked";
export interface CodeResult {
  verdict: Verdict;
  message?: string; // on "fail": what's wrong, written so the repair step can act on it
}
export interface Issue {
  room: number; // 0-based
  puzzle?: number; // 0-based; missing = a room- or house-level problem
  source: "validator" | "code" | "solver";
  message: string;
}

const letters = (s: string) => norm(s).replace(/[0-9]/g, "");
const sameLetters = (a: string, b: string) => letters(a).split("").sort().join("") === letters(b).split("").sort().join("");
const shift = (word: string, by: number) =>
  word.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + by + 26 * 10) % 26) + 65));
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** "A=1, B=2 ... The note says: 3 1 14 4 25" → "CANDY" */
function checkNumberCode(text: string, answer: string): CodeResult {
  if (!/\bA\s*=\s*1\b/.test(text)) return { verdict: "unchecked" };
  const runs = [...text.matchAll(/\b\d{1,2}(?:[\s,\-–]+\d{1,2}){1,}\b/g)].map((m) => m[0]);
  const run = runs.at(-1);
  if (!run) return { verdict: "unchecked" };
  const nums = run.split(/[\s,\-–]+/).map(Number);
  if (nums.some((n) => n < 1 || n > 26)) return { verdict: "fail", message: `the code "${run}" has numbers outside 1-26` };
  const decoded = nums.map((n) => String.fromCharCode(64 + n)).join("");
  return norm(decoded) === norm(answer)
    ? { verdict: "pass" }
    : { verdict: "fail", message: `the number code "${run}" spells ${decoded}, not ${answer.toUpperCase()}` };
}

/** "Move each letter back one: DBOEZ" → "CANDY" (accepts either direction, since puzzles phrase it both ways) */
function checkShiftCode(text: string, answer: string): CodeResult {
  const m = text.match(/\b(back|forward|ahead|before|after|earlier|later)\s+(?:by\s+)?(one|two|three|four|five|[1-5])\b/i);
  if (!m) return { verdict: "unchecked" };
  const by = NUM_WORDS[m[2].toLowerCase()] ?? Number(m[2]);
  const candidates = (text.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !/^(AND|THE)$/.test(w));
  if (!candidates.length) return { verdict: "unchecked" };
  for (const w of candidates) if (norm(shift(w, by)) === norm(answer) || norm(shift(w, -by)) === norm(answer)) return { verdict: "pass" };
  const w = candidates.at(-1)!;
  return { verdict: "fail", message: `shifting "${w}" by ${by} gives ${shift(w, -by)} or ${shift(w, by)}, not ${answer.toUpperCase()}` };
}

/** "YDNAC" read backwards → "CANDY" */
function checkMirror(text: string, answer: string): CodeResult {
  const words = text.match(/\b[A-Za-z]{3,}\b/g) || [];
  if (words.some((w) => norm(w.split("").reverse().join("")) === norm(answer))) return { verdict: "pass" };
  const caps = (text.match(/\b[A-Z]{3,}\b/g) || []).at(-1);
  return { verdict: "fail", message: caps ? `"${caps}" read backwards is ${caps.split("").reverse().join("")}, not ${answer.toUpperCase()}` : `no word in the clue reads ${answer.toUpperCase()} backwards` };
}

/** "S T O H G" → letters of "ghost" */
function checkUnscramble(text: string, answer: string): CodeResult {
  const runs = [...text.matchAll(/\b[A-Za-z](?:[\s,]+[A-Za-z]\b){2,}/g)].map((m) => m[0]);
  if (!runs.length) {
    // Jumbled letters written as one word, e.g. "STOHG"
    const caps = (text.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => sameLetters(w, answer));
    return caps.length ? { verdict: "pass" } : { verdict: "unchecked" };
  }
  const run = runs.sort((a, b) => b.length - a.length)[0];
  return sameLetters(run, answer)
    ? { verdict: "pass" }
    : { verdict: "fail", message: `the jumbled letters "${run}" don't make ${answer.toUpperCase()}` };
}

/** "☾=C, ★=A, ▲=T ... ☾ ★ ▲" → "CAT" */
function checkPictureCode(text: string, answer: string): CodeResult {
  const pairs = [...text.matchAll(/([^\sA-Za-z0-9=,.:;()'"!?\-])\s*=\s*([A-Za-z])\b/gu)];
  if (pairs.length < 2) return { verdict: "unchecked" };
  const map = new Map(pairs.map((p) => [p[1], p[2].toUpperCase()]));
  const rest = pairs.reduce((t, p) => t.replace(p[0], " "), text);
  const decoded = [...rest].filter((ch) => map.has(ch)).map((ch) => map.get(ch)).join("");
  if (!decoded) return { verdict: "unchecked" };
  return norm(decoded) === norm(answer)
    ? { verdict: "pass" }
    : { verdict: "fail", message: `the symbols decode to ${decoded}, not ${answer.toUpperCase()}` };
}

/** "5, 10, 15, 20, ___" → 25 (only for steady adding or multiplying patterns) */
function checkNumberPattern(text: string, answer: string): CodeResult {
  if (!/^\d+$/.test(norm(answer))) return { verdict: "unchecked" };
  const nums = (text.match(/\b\d+\b/g) || []).map(Number);
  if (nums.length < 3) return { verdict: "unchecked" };
  const diffs = nums.slice(1).map((n, i) => n - nums[i]);
  let expected: number | null = null;
  if (diffs.every((d) => d === diffs[0])) expected = nums.at(-1)! + diffs[0];
  else if (nums.every((n) => n !== 0)) {
    const ratios = nums.slice(1).map((n, i) => n / nums[i]);
    if (ratios.every((r) => r === ratios[0] && Number.isInteger(r))) expected = nums.at(-1)! * ratios[0];
  }
  if (expected === null) return { verdict: "unchecked" };
  return Number(norm(answer)) === expected
    ? { verdict: "pass" }
    : { verdict: "fail", message: `the pattern ${nums.join(", ")} continues with ${expected}, not ${answer}` };
}

export function codeCheckPuzzle(z: Puzzle): CodeResult {
  const text = `${z.clue} ${z.question}`;
  const all = [z.answer, ...(z.alternates || [])];
  const run = (fn: (t: string, a: string) => CodeResult) => {
    // Pass if any accepted answer checks out; otherwise report the main answer's failure.
    const results = all.map((a) => fn(text, a));
    if (results.some((r) => r.verdict === "pass")) return { verdict: "pass" as const };
    return results[0];
  };
  switch (canonType(z.type)) {
    case "Secret code": {
      const n = run(checkNumberCode);
      return n.verdict !== "unchecked" ? n : run(checkShiftCode);
    }
    case "Mirror writing":
      return run(checkMirror);
    case "Unscramble":
      return run(checkUnscramble);
    case "Picture code":
      return run(checkPictureCode);
    case "Pattern":
      return run(checkNumberPattern);
    default:
      return { verdict: "unchecked" };
  }
}

/** Runs the code checks on every puzzle. */
export function codeCheckHouse(house: House) {
  const verdicts: Verdict[][] = [];
  const issues: Issue[] = [];
  house.rooms.forEach((r, ri) => {
    verdicts[ri] = r.puzzles.map((z, pi) => {
      const res = codeCheckPuzzle(z);
      if (res.verdict === "fail") issues.push({ room: ri, puzzle: pi, source: "code", message: `room ${ri + 1} puzzle ${pi + 1} (${z.type}): ${res.message}` });
      return res.verdict;
    });
  });
  return { verdicts, issues };
}

/** Turns validator messages ("room 2 puzzle 3 gives its answer away") into structured issues. */
export function validatorIssues(problems: string[]): Issue[] {
  return problems.map((message) => {
    const m = message.match(/room (\d)(?: puzzle (\d))?/);
    return { room: m ? Number(m[1]) - 1 : -1, puzzle: m?.[2] ? Number(m[2]) - 1 : undefined, source: "validator" as const, message };
  });
}
