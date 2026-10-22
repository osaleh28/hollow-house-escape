"use client";

import { useEffect, useRef, useState } from "react";
import { CandyIcon, ThemeIcon } from "./Icons.tsx";
import { checkInput, cleanInput, INPUT_LIMITS } from "@/lib/guardrails.ts";
import { isCorrect, SAMPLE_HOUSE, type House, type Puzzle } from "@/lib/house.ts";
import { THEME_IDS, THEMES, type Theme } from "@/lib/themes.ts";
import type { AgeLevel } from "@/lib/prompts.ts";
import { sorry } from "@/lib/sorry.ts";

const HELPER_WAIT_MS = 20_000; // the browser gives up on a hint after this, even if the server hasn't answered

/** Reads a JSON reply; if the host sent an error page instead (e.g. a 504), turns it into a spooky sorry. */
const readReply = (res: Response) =>
  res.json().catch(() => ({ ok: false, message: sorry(res.status === 504 ? "timeout" : "error") }));

type GameState = {
  room: number;
  candy: number;
  solved: Record<string, boolean>;
  hinted: Record<string, boolean>;
  asked: Record<number, number>;
  won: boolean;
};
type ChatMsg = { room: number; who: "you" | "helper" | "sys"; text: string };
type Report = import("@/lib/pipeline.ts").BuildReport;
type Modal =
  | { kind: "loading" }
  | { kind: "unlock"; theme: Theme; text: string }
  | { kind: "enter"; title: string; text: string }
  | { kind: "win"; text: string };

const HELPER_PER_ROOM = 5;
const kicker = (i: number, t: Theme) => `Room ${i + 1} · ${THEMES[t]?.label ?? "Spooky"} room`;
/** Sets the room accent color for a monster. */
const tone = (t: Theme) => ({ "--room": THEMES[t]?.color ?? "#ff9a3c" }) as React.CSSProperties;
const fresh = (): GameState => ({ room: 0, candy: 0, solved: {}, hinted: {}, asked: {}, won: false });
const key = (r: number, p: number) => `${r}:${p}`;
const SAVE_KEY = "hollow-house-save-v1";
const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export default function Game() {
  const [house, setHouse] = useState<House>(SAMPLE_HOUSE);
  const [isSample, setIsSample] = useState(true);
  const [g, setG] = useState<GameState>(fresh);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [age, setAge] = useState<AgeLevel>("8-10");
  const [idea, setIdea] = useState("");
  const [note, setNote] = useState<{ text: string; err?: boolean }>({ text: `Claude can invent a brand-new mystery with a surprise mix of 3 monster rooms (from ${THEME_IDS.length} monsters) and 12 new puzzles. You're playing the sample house until then.` });
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [candyPop, setCandyPop] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const room = house.rooms[g.room];
  const roomSolved = (i: number) => house.rooms[i].puzzles.every((_, p) => g.solved[key(i, p)]);
  const solvedCount = room.puzzles.filter((_, p) => g.solved[key(g.room, p)]).length;
  const askedHere = g.asked[g.room] ?? 0;

  // Restore a saved game, and read today's AI budget.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (s?.house?.rooms?.length === 3 && s.g) {
        setHouse(s.house);
        setIsSample(!!s.isSample);
        setG({ ...fresh(), ...s.g });
      }
    } catch {}
    loaded.current = true;
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false));
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ house, isSample, g }));
    } catch {}
  }, [house, isSample, g]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat, g.room]);

  /** Guardrail events go to the browser console (DevTools → Console), not the page. */
  const addLog = (text: string, kind: "block" | "ok" | "" = "") =>
    (kind === "block" ? console.warn : console.info)(`[guardrails] ${text}`);

  /** Writes the correctness-check results for a new house to the console. */
  function logReport(r: Report | undefined, mix: string, cost: number) {
    if (!r) return;
    const solver = r.checks.solverRan ? `, ${r.checks.bySolver} confirmed by an AI tester` : " (AI tester skipped)";
    addLog(`Surprise mix: ${mix}. Checked all 12 puzzles: ${r.checks.byCode} proven correct by code${solver}. ${r.calls.length} AI calls, ${money(cost)}.`, "ok");
    if (!r.firstDraft.passed) {
      addLog(`Found ${r.firstDraft.issues.length} problem(s) in the first draft and repaired ${r.repair.fixed} puzzle(s). The repaired house passed.`, "ok");
      r.firstDraft.issues.slice(0, 4).forEach((i) => addLog(`First draft problem (${i.source === "code" ? "code check" : i.source === "solver" ? "AI tester" : "validator"}): ${i.message}`, "block"));
    }
    r.warnings.slice(0, 3).forEach((w) => addLog(`Note: ${w}`));
  }

  /* ---------- game actions ---------- */
  function solve(p: number) {
    const k = key(g.room, p);
    setG((s) => ({ ...s, solved: { ...s.solved, [k]: true }, candy: s.candy + (s.hinted[k] ? 1 : 3) }));
    setCandyPop((n) => n + 1);
  }
  const hint = (p: number) => setG((s) => ({ ...s, hinted: { ...s.hinted, [key(s.room, p)]: true } }));
  function openDoor() {
    if (!roomSolved(g.room)) return;
    if (g.room < 2) setModal({ kind: "unlock", theme: room.theme, text: room.unlock });
    else {
      setG((s) => ({ ...s, won: true }));
      setModal({ kind: "win", text: `${room.unlock} ${house.ending}` });
    }
  }
  function nextRoom() {
    setG((s) => ({ ...s, room: Math.min(2, s.room + 1) }));
    setModal(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function restart() {
    setG(fresh());
    setChat([]);
    setModal(null);
  }

  /* ---------- AI: new house ---------- */
  async function conjure() {
    if (busy) return;
    const cleanIdea = cleanInput(idea, INPUT_LIMITS.ideaChars);
    if (cleanIdea) {
      const chk = checkInput(cleanIdea, "idea");
      if (chk.block) {
        addLog(`Blocked a house idea before calling the AI: it ${chk.reason}.`, "block");
        setNote({ text: chk.say!, err: true });
        return;
      }
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setNote({ text: "" });
    setModal({ kind: "loading" });
    try {
      const res = await fetch("/api/house", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ age, idea: cleanIdea }),
        signal: ctl.signal,
      });
      const d = await readReply(res);
      if (d.ok) {
        setHouse(d.house);
        setIsSample(false);
        setG(fresh());
        setChat([]);
        logReport(d.report, d.house.rooms.map((r: { theme: Theme }) => THEMES[r.theme].label).join(", "), d.call.costUsd);
        setModal({ kind: "enter", title: d.house.title, text: d.house.premise });
        setNote({ text: "Your new house is ready!" });
        return;
      }
      setModal(null);
      if (d.code === "rejected") {
        if (d.report?.repair?.attempted) addLog(`Tried to repair ${d.report.repair.fixed} puzzle(s), but the house still failed.`, "block");
        addLog(`Threw out a new house: ${(d.problems || []).slice(0, 4).join("; ")}.`, "block");
      }
      if (d.code === "blocked") {
        addLog(`Server blocked a house idea: it ${d.reason}.`, "block");
      }
      if (d.code === "capped") addLog(`Cost cap stopped a new house (${d.reason}).`, "block");
      setNote({ text: d.message || sorry("error"), err: true });
    } catch (e) {
      setModal(null);
      if ((e as Error).name !== "AbortError") setNote({ text: sorry("offline"), err: true });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  /* ---------- AI: helper ---------- */
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = cleanInput(question, INPUT_LIMITS.questionChars);
    if (!q || asking) return;
    const ri = g.room;
    const push = (who: ChatMsg["who"], text: string) => setChat((c) => [...c, { room: ri, who, text }]);
    setQuestion("");
    push("you", q);

    const chk = checkInput(q, "helper");
    if (chk.block) {
      push("helper", chk.say!);
      addLog(`Blocked a helper question before calling the AI: it ${chk.reason}.`, "block");
      return;
    }
    if (askedHere >= HELPER_PER_ROOM) {
      push("sys", "Your helper is all out of hints for this room. You can do it!");
      return;
    }
    setAsking(true);
    try {
      const res = await fetch("/api/helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room,
          solved: room.puzzles.map((_, p) => (g.solved[key(ri, p)] ? p : -1)).filter((p) => p >= 0),
          question: q,
          askedInRoom: askedHere,
        }),
        signal: AbortSignal.timeout(HELPER_WAIT_MS),
      });
      const d = await readReply(res);
      if (d.ok) {
        push("helper", d.reply);
        if (d.blocked) addLog(`Server blocked a helper question: it ${d.reason}.`, "block");
        if (d.flag) addLog(`Output check: ${d.flag}.`, "block");
        if (!d.blocked) setG((s) => ({ ...s, asked: { ...s.asked, [ri]: (s.asked[ri] ?? 0) + 1 } }));
      } else {
        if (d.code === "capped") addLog(`Cost cap stopped a helper question (${d.reason || "room limit"}).`, "block");
        push("sys", d.message || sorry("error"));
      }
    } catch (e) {
      push("sys", sorry((e as Error).name === "TimeoutError" ? "timeout" : "offline"));
    } finally {
      setAsking(false);
    }
  }

  const aiReady = configured !== false;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="eyebrow">{isSample ? "Sample house · ready to play" : "A new house made by Claude"}</div>
          <h1>{house.title}</h1>
        </div>
        <div className="meters">
          <div className="candy" title="Solve a puzzle for 3 candies, or 1 if you used the hint">
            <CandyIcon />
            <b key={candyPop} className={candyPop ? "pop" : ""}>{g.candy}</b>
            <span>candies found</span>
          </div>
        </div>
      </header>

      <section className="panel mystery" aria-label="The mystery">
        <h3 className="ph">The mystery</h3>
        <p className="premise">{house.premise}</p>
        <p className="small">How to play: solve all 4 puzzles in a room to unlock the door to the next one. Stuck? Ask the helper or peek at a hint.</p>
        <button className="btn soft" onClick={restart}>Start this house over</button>
      </section>

      <section className="conjure" aria-label="Make a new house">
        <div className="field">
          <label htmlFor="age">Puzzle level</label>
          <select id="age" value={age} onChange={(e) => setAge(e.target.value as AgeLevel)}>
            <option value="5-7">Ages 5–7 (easy)</option>
            <option value="8-10">Ages 8–10 (medium)</option>
            <option value="11-12">Ages 11–12 (tricky)</option>
          </select>
        </div>
        <div className="field" style={{ flexBasis: 240 }}>
          <label htmlFor="twist">Add your own idea (optional)</label>
          <input id="twist" type="text" maxLength={INPUT_LIMITS.ideaChars} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. a ghost who loves pancakes" />
        </div>
        <button className="btn" onClick={conjure} disabled={busy || !aiReady}>Make a new house</button>
        <p className={`note${note.err ? " err" : ""}`}>
          {configured === false ? "The AI isn't set up on this server yet (missing API key). The sample house is ready to play!" : note.text}
        </p>
      </section>

      <nav className="doors" aria-label="Rooms">
        {house.rooms.map((r, i) => {
          const done = roomSolved(i), here = i === g.room && !g.won;
          return (
            <div key={i} className={`door${done ? " done" : ""}${here ? " here" : ""}${!done && !here ? " locked" : ""}`} style={tone(r.theme)}>
              <ThemeIcon theme={r.theme} />
              <div>
                <div className="dn">{r.name}</div>
                <div className="ds">{done ? "Unlocked!" : here ? "You are here" : "Locked"}</div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="stage" style={tone(room.theme)}>
        <article className="panel room">
          <div className="room-head">
            <ThemeIcon theme={room.theme} />
            <div>
              <div className="kicker">{kicker(g.room, room.theme)}</div>
              <h2>{room.name}</h2>
            </div>
          </div>
          <p className="desc">{room.description}</p>
          <div className="progress">
            {room.puzzles.map((_, p) => <i key={p} className={g.solved[key(g.room, p)] ? "on" : ""} />)}
            <span>{solvedCount} of 4 puzzles solved</span>
          </div>
          <div className="board">
            {room.puzzles.map((z, p) => (
              <PuzzleCard
                key={`${house.title}-${g.room}-${p}`}
                id={`ans-${g.room}-${p}`}
                n={p + 1}
                puzzle={z}
                solved={!!g.solved[key(g.room, p)]}
                hinted={!!g.hinted[key(g.room, p)]}
                onSolve={() => solve(p)}
                onHint={() => hint(p)}
              />
            ))}
          </div>
          <div className="doorbar">
            <p>{roomSolved(g.room) ? "All four puzzles solved. The door is unlocked!" : "Solve all 4 puzzles to unlock the door."}</p>
            <button className="btn room" onClick={openDoor} disabled={!roomSolved(g.room)}>
              {g.room < 2 ? "Open the door" : "Find the candy!"}
            </button>
          </div>
        </article>

        <div className="side">
          <aside className="panel">
            <h3 className="ph">{room.helper.name}</h3>
            <p className="small">{room.helper.intro}</p>
            <div className="chat" ref={chatRef} aria-live="polite">
              {chat.filter((m) => m.room === g.room).map((m, i) => <div key={i} className={`bubble ${m.who}`}>{m.text}</div>)}
              {asking && <div className="bubble helper">…</div>}
            </div>
            <form className="row" onSubmit={ask}>
              <input id="question" type="text" maxLength={INPUT_LIMITS.questionChars} autoComplete="off" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="I'm stuck on the riddle…" aria-label="Question for the helper" />
              <button className="btn room" type="submit" disabled={asking || askedHere >= HELPER_PER_ROOM || !aiReady}>Ask</button>
            </form>
            <p className="small">{HELPER_PER_ROOM - askedHere} of {HELPER_PER_ROOM} questions left in this room</p>
          </aside>
        </div>
      </div>

      {modal && (
        <div className="veil" role="dialog" aria-modal="true">
          {modal.kind === "loading" && (
            <div className="card" style={tone("witch")}>
              <div className="spinner" aria-hidden="true" />
              <h2>Brewing a new house…</h2>
              <p>Claude is picking 3 surprise monsters and making 12 puzzles. Then every puzzle is checked, and fixed if needed, before you play. This takes about a minute.</p>
              <button className="btn soft" onClick={() => abortRef.current?.abort()}>Stop</button>
            </div>
          )}
          {modal.kind === "unlock" && (
            <div className="card" style={tone(modal.theme)}>
              <ThemeIcon theme={modal.theme} />
              <h2>Door unlocked! A clue!</h2>
              <p>{modal.text}</p>
              <button className="btn room" onClick={nextRoom} autoFocus>Follow the trail</button>
            </div>
          )}
          {modal.kind === "enter" && (
            <div className="card" style={tone(house.rooms[0].theme)}>
              <ThemeIcon theme={house.rooms[0].theme} />
              <h2>{modal.title}</h2>
              <p>{modal.text}</p>
              <button className="btn" onClick={() => setModal(null)} autoFocus>Go inside</button>
            </div>
          )}
          {modal.kind === "win" && (
            <div className="card" style={tone(house.rooms[2].theme)}>
              <ThemeIcon theme={house.rooms[2].theme} />
              <h2>Mystery solved!</h2>
              <p>{modal.text}</p>
              <p className="small">You found {g.candy} of 36 candies.</p>
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn" onClick={() => { setModal(null); conjure(); }} disabled={!aiReady}>Make a new house</button>
                <button className="btn soft" onClick={restart}>Play this one again</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const NICE = ["Not quite! Try again.", "So close! Read the clue one more time.", "Hmm, not that one. You've got this!", "Keep trying! Maybe peek at the hint?"];

function PuzzleCard(props: { id: string; n: number; puzzle: Puzzle; solved: boolean; hinted: boolean; onSolve: () => void; onHint: () => void }) {
  const { id, n, puzzle: z, solved, hinted, onSolve, onHint } = props;
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState("");
  const [wig, setWig] = useState(0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    if (isCorrect(z, value)) onSolve();
    else {
      setMsg(NICE[Math.floor(Math.random() * NICE.length)]);
      setWig((w) => w + 1);
    }
  }

  return (
    <div key={wig} className={`puz${solved ? " solved" : ""}${wig ? " wiggle" : ""}`}>
      <div className="top">
        <span className="tag">{z.type || "Puzzle"}</span>
        <span className="small">Puzzle {n}</span>
      </div>
      <h3>{z.title}</h3>
      <p className="clue">{z.clue}</p>
      <p className="q">{z.question}</p>
      {solved ? (
        <p className="answer">✓ {z.answer} · +{hinted ? 1 : 3} candy</p>
      ) : (
        <>
          <form onSubmit={submit}>
            <input id={id} type="text" autoComplete="off" maxLength={30} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Your answer" aria-label={`Answer for ${z.title}`} />
            <button className="btn room" type="submit">Check</button>
          </form>
          <p className={`msg${msg ? " oops" : ""}`} aria-live="polite">{msg}</p>
          {hinted ? (
            <p className="hinttxt">Hint: {z.hint}</p>
          ) : (
            z.hint && <button type="button" className="linkbtn" onClick={onHint}>Show a hint (you&apos;ll get 1 candy instead of 3)</button>
          )}
        </>
      )}
    </div>
  );
}
