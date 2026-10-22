// Self-test for the code checks in lib/checks.ts. Run: npm run test:checks
import { codeCheckHouse, codeCheckPuzzle } from "../lib/checks.ts";
import { SAMPLE_HOUSE, type Puzzle } from "../lib/house.ts";

let pass = 0, fail = 0;
const expect = (name: string, ok: boolean) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
const P = (type: string, clue: string, answer: string, question = "What is it?", alternates: string[] = []): Puzzle =>
  ({ type, title: "t", clue, question, answer, alternates, hint: "h" });
const v = (z: Puzzle) => codeCheckPuzzle(z).verdict;

expect("number code: correct", v(P("Secret code", "A=1, B=2, C=3 and so on. The note says: 3 1 14 4 25", "candy")) === "pass");
expect("number code: wrong answer is caught", v(P("Secret code", "A=1, B=2, C=3 and so on. The note says: 3 1 14 4 25", "candies")) === "fail");
expect("number code: message says what it really spells", (codeCheckPuzzle(P("Secret code", "A=1, B=2. Code: 2 1 20", "cat")).message || "").includes("BAT"));
expect("shift code: correct either direction", v(P("Secret code", "Move each letter back one to read it: DBOEZ", "candy")) === "pass");
expect("shift code: wrong answer is caught", v(P("Secret code", "Move each letter back one: DBOEZ", "sweet")) === "fail");
expect("mirror writing: correct", v(P("Mirror writing", "The mirror shows YDNAC.", "candy")) === "pass");
expect("mirror writing: wrong answer is caught", v(P("Mirror writing", "The mirror shows YDNAC.", "sugar")) === "fail");
expect("unscramble: correct", v(P("Unscramble", "A wobbly sign says: S T O H G", "ghost")) === "pass");
expect("unscramble: wrong letters are caught", v(P("Unscramble", "A wobbly sign says: S T O H G E", "ghost")) === "fail");
expect("picture code: correct", v(P("Picture code", "In the code ☾=C, ★=A, ▲=T. The wall says: ☾ ★ ▲", "cat")) === "pass");
expect("picture code: wrong answer is caught", v(P("Picture code", "In the code ☾=C, ★=A, ▲=T. The wall says: ▲ ★ ☾", "cat")) === "fail");
expect("number pattern: adding", v(P("Pattern", "5, 10, 15, 20, ___", "25")) === "pass");
expect("number pattern: wrong answer is caught", v(P("Pattern", "5, 10, 15, 20, ___", "30")) === "fail");
expect("number pattern: doubling", v(P("Pattern", "2, 4, 8, 16, ___", "32")) === "pass");
expect("word pattern is left to the AI solver", v(P("Pattern", "Boo, Hoo, Boo, Hoo, ___", "boo")) === "unchecked");
expect("riddles are left to the AI solver", v(P("Riddle", "I'm orange and round.", "pumpkin")) === "unchecked");
expect("alternate answers count", v(P("Secret code", "A=1, B=2... It says 3 1 20", "kitty", "?", ["cat"])) === "pass");

const res = codeCheckHouse(SAMPLE_HOUSE);
expect("sample house: no code-check failures", res.issues.length === 0);
expect("sample house: the secret code and unscramble are verified by code", res.verdicts[2][0] === "pass" && res.verdicts[1][1] === "pass");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
