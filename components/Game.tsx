"use client";

import { useEffect, useRef, useState } from "react";
import { CandyIcon, ThemeIcon } from "./Icons.tsx";
import { checkInput, cleanInput, HISTORY_MAX, INPUT_LIMITS } from "@/lib/guardrails.ts";
import { isCorrect, SAMPLE_HOUSE, type House, type Puzzle } from "@/lib/house.ts";
import { HOUSES } from "@/lib/library.ts";
import { THEMES, type Theme } from "@/lib/themes.ts";
import { sorry } from "@/lib/sorry.ts";

const HELPER_WAIT_MS = 20_000; // the browser gives up on a hint after this, even if the server hasn't answered

/** Reads a JSON reply; if the host sent an error page instead (e.g. a 504), turns it into a spooky sorry. */
const readReply = (res: Response) =>
  res.json().catch(() => ({ ok: false, message: sorry(res.status === 504 ? "timeout" : "error") }));

type GameState = {
  room: number;
  candy: number;
  solved: Record<string, boolean>;
  asked: Record<number, number>;
  backups: Record<number, number>; // written hints shown per room when the AI was unavailable
  won: boolean;
};
type ChatMsg = { room: number; who: "you" | "helper" | "sys"; text: string };
type Modal =
  | { kind: "unlock"; theme: Theme; text: string }
  | { kind: "win"; text: string };

const HELPER_PER_ROOM = 5;
const kicker = (i: number, t: Theme) => `Room ${i + 1} · ${THEMES[t]?.label ?? "Spooky"} room`;
/** Sets the room accent color for a monster. */
const tone = (t: Theme) => ({ "--room": THEMES[t]?.color ?? "#ff9a3c" }) as React.CSSProperties;
const fresh = (): GameState => ({ room: 0, candy: 0, solved: {}, asked: {}, backups: {}, won: false });
const key = (r: number, p: number) => `${r}:${p}`;
const PLAYED_KEY = "hollow-house-played-v1";

/**
 * Picks a house this browser hasn't played yet, never the one just played.
 * Once every house has been played, the list starts over.
 */
function pickHouse(current?: string): House {
  let played: string[] = [];
  try {
    played = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]");
  } catch {}
  const last = current ?? played.at(-1);
  let options = HOUSES.filter((h) => h.title !== last && !played.includes(h.title));
  if (!options.length) {
    played = [];
    options = HOUSES.filter((h) => h.title !== last);
  }
  const house = options[Math.floor(Math.random() * options.length)] ?? HOUSES[0];
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...played, house.title]));
  } catch {}
  return house;
}

export default function Game() {
  const [house, setHouse] = useState<House>(SAMPLE_HOUSE);
  const [ready, setReady] = useState(false); // false until a house is picked, so the sample never flashes first
  const [g, setG] = useState<GameState>(fresh);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [candyPop, setCandyPop] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);

  const room = house.rooms[g.room];
  const roomSolved = (i: number) => house.rooms[i].puzzles.every((_, p) => g.solved[key(i, p)]);
  const solvedCount = room.puzzles.filter((_, p) => g.solved[key(g.room, p)]).length;
  const askedHere = g.asked[g.room] ?? 0;

  // Every page load gets a different house, and we check whether the AI helper is set up.
  useEffect(() => {
    setHouse(pickHouse());
    setReady(true);
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => setConfigured(!!d.configured))
      .catch(() => setConfigured(false));
  }, []);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat, g.room]);

  /** Guardrail events go to the browser console (DevTools → Console), not the page. */
  const addLog = (text: string, kind: "block" | "ok" | "" = "") =>
    (kind === "block" ? console.warn : console.info)(`[guardrails] ${text}`);

  /* ---------- game actions ---------- */
  function solve(p: number) {
    const k = key(g.room, p);
    setG((s) => ({ ...s, solved: { ...s.solved, [k]: true }, candy: s.candy + 3 }));
    setCandyPop((n) => n + 1);
  }
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
  function newHouse() {
    setHouse(pickHouse(house.title));
    restart();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- AI: helper ---------- */
  /** The written hint for the next unsolved puzzle in a room, taking turns through them. */
  function backupHint(ri: number) {
    const open = house.rooms[ri].puzzles.map((z, p) => ({ z, p })).filter(({ z, p }) => z.hint && !g.solved[key(ri, p)]);
    if (!open.length) return null;
    const { z, p } = open[(g.backups[ri] ?? 0) % open.length];
    setG((s) => ({ ...s, backups: { ...s.backups, [ri]: (s.backups[ri] ?? 0) + 1 } }));
    return `Here's a clue for Puzzle ${p + 1}, "${z.title}": ${z.hint}`;
  }

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
      push("helper", sorry("alone"));
      return;
    }

    /** Failsafe: when the AI can't answer, share the written hint for an unsolved puzzle instead. */
    const fallback = (why: string, reason: string) => {
      push("sys", why);
      const hint = backupHint(ri);
      if (hint) push("helper", hint);
      addLog(`The helper AI couldn't answer (${reason}), so a written hint was shown instead.`, "ok");
    };
    if (!aiReady) return fallback("The helper's magic isn't switched on, so here's a written clue instead.", "not set up");

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
          // This room's recent chat, so "I'm still stuck" is understood (the server re-checks it).
          history: chat
            .filter((m) => m.room === ri && m.who !== "sys")
            .slice(-HISTORY_MAX)
            .map(({ who, text }) => ({ who, text })),
        }),
        signal: AbortSignal.timeout(HELPER_WAIT_MS),
      });
      const d = await readReply(res);
      if (d.ok) {
        push("helper", d.reply);
        if (d.blocked) addLog(`Server blocked a helper question: it ${d.reason}.`, "block");
        if (d.flag) addLog(`Output check: ${d.flag}.`, "block");
        if (!d.blocked) {
          setG((s) => ({ ...s, asked: { ...s.asked, [ri]: (s.asked[ri] ?? 0) + 1 } }));
          if (askedHere + 1 >= HELPER_PER_ROOM) push("helper", sorry("alone")); // that was the last question
        }
      } else {
        if (d.code === "capped") addLog(`Cost cap stopped a helper question (${d.reason || "room limit"}).`, "block");
        fallback(d.message || sorry("error"), d.code || "error");
      }
    } catch (e) {
      const timedOut = (e as Error).name === "TimeoutError";
      fallback(sorry(timedOut ? "timeout" : "offline"), timedOut ? "timeout" : "offline");
    } finally {
      setAsking(false);
    }
  }

  const aiReady = configured !== false;
  if (!ready) return <div className="wrap" aria-busy="true" />;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="eyebrow">A Hollow House mystery</div>
          <h1>{house.title}</h1>
        </div>
        <div className="meters">
          <div className="candy" title="Solve a puzzle for 3 candies">
            <CandyIcon />
            <b key={candyPop} className={candyPop ? "pop" : ""}>{g.candy}</b>
            <span>candies found</span>
          </div>
        </div>
      </header>

      <section className="panel mystery" aria-label="The mystery">
        <h3 className="ph">The mystery</h3>
        <p className="premise">{house.premise}</p>
        <p className="small">How to play: solve all 4 puzzles in a room to unlock the door to the next one. Stuck? Ask the helper for a nudge.</p>
        <div className="row">
          <button className="btn" onClick={newHouse}>New house</button>
          <button className="btn soft" onClick={restart}>Start this house over</button>
        </div>
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
                onSolve={() => solve(p)}
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
              <button className="btn room" type="submit" disabled={asking || askedHere >= HELPER_PER_ROOM}>Ask</button>
            </form>
            <p className="small">
              {!aiReady
                ? "The helper's AI isn't set up on this server (missing API key), so it will share written clues instead."
                : askedHere >= HELPER_PER_ROOM
                  ? "👻 No questions left. You're on your own in this room!"
                  : `${HELPER_PER_ROOM - askedHere} of ${HELPER_PER_ROOM} questions left in this room`}
            </p>
          </aside>
        </div>
      </div>

      {modal && (
        <div className="veil" role="dialog" aria-modal="true">
          {modal.kind === "unlock" && (
            <div className="card" style={tone(modal.theme)}>
              <ThemeIcon theme={modal.theme} />
              <h2>Door unlocked! A clue!</h2>
              <p>{modal.text}</p>
              <button className="btn room" onClick={nextRoom} autoFocus>Follow the trail</button>
            </div>
          )}
          {modal.kind === "win" && (
            <div className="card" style={tone(house.rooms[2].theme)}>
              <ThemeIcon theme={house.rooms[2].theme} />
              <h2>Mystery solved!</h2>
              <p>{modal.text}</p>
              <p className="small">You found {g.candy} of 36 candies.</p>
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn" onClick={newHouse} autoFocus>Play a new house</button>
                <button className="btn soft" onClick={restart}>Play this one again</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const NICE = ["Not quite! Try again.", "So close! Read the clue one more time.", "Hmm, not that one. You've got this!", "Keep trying! Your helper can give you a nudge."];

function PuzzleCard(props: { id: string; n: number; puzzle: Puzzle; solved: boolean; onSolve: () => void }) {
  const { id, n, puzzle: z, solved, onSolve } = props;
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
        <p className="answer">✓ {z.answer} · +3 candy</p>
      ) : (
        <>
          <form onSubmit={submit}>
            <input id={id} type="text" autoComplete="off" maxLength={30} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Your answer" aria-label={`Answer for ${z.title}`} />
            <button className="btn room" type="submit">Check</button>
          </form>
          <p className={`msg${msg ? " oops" : ""}`} aria-live="polite">{msg}</p>
        </>
      )}
    </div>
  );
}
