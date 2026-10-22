// POST /api/helper — the room's helper character answers one question with a gentle nudge.
// The model is never sent the answers or hints; the server uses them only to redact the reply.

import { anthropic, aiError, json, noKey, visitorId } from "@/lib/ai.ts";
import { CALL_LIMITS, LIMITS, MODELS, noThinking, record, reserve, snapshot } from "@/lib/cost.ts";
import { checkInput, cleanHistory, cleanInput, guardHelperReply, INPUT_LIMITS } from "@/lib/guardrails.ts";
import { cleanRoom, type Room } from "@/lib/house.ts";
import { helperContext, SYSTEM_HELPER } from "@/lib/prompts.ts";
import { sorry } from "@/lib/sorry.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 12_000; // a room is ~3 KB; anything much bigger is not a real game request

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, code: "too_large", message: "That request was too big." }, 413);
  let body: { room?: Room; solved?: number[]; question?: string; askedInRoom?: number; history?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, code: "bad_request", message: "Something went wrong. Try again!" }, 400);
  }
  if (!body.room || !Array.isArray(body.room.puzzles) || body.room.puzzles.length < 1)
    return json({ ok: false, code: "bad_request", message: "Something went wrong. Try again!" }, 400);

  const room = cleanRoom(body.room);
  const solved = (Array.isArray(body.solved) ? body.solved : []).filter((n) => Number.isInteger(n) && n >= 0 && n < 4);
  const question = cleanInput(body.question, INPUT_LIMITS.questionChars);
  const history = cleanHistory(body.history); // untrusted: re-checked so "I'm still stuck" has context
  if (!question) return json({ ok: false, code: "empty", message: "Type a question first!" }, 400);

  // 1. Input guardrail.
  const chk = checkInput(question, "helper");
  if (chk.block) return json({ ok: true, blocked: true, reason: chk.reason, reply: chk.say });

  // Per-room limit (the browser also enforces this; the server double-checks).
  if ((body.askedInRoom ?? 0) >= LIMITS.helperPerRoom)
    return json({ ok: false, code: "capped", message: sorry("alone") }, 429);

  const ai = anthropic();
  if (!ai) return noKey();

  // 2. Cost cap.
  const gate = reserve("helper", visitorId(req));
  if (!gate.ok) return json({ ok: false, code: "capped", reason: gate.reason, message: gate.message, usage: snapshot() }, 429);

  // 3. The AI call — cheap, fast model and a tiny max_tokens.
  try {
    const msg = await ai.messages.create(
      {
        model: MODELS.helper,
        max_tokens: LIMITS.helperMaxTokens,
        system: SYSTEM_HELPER,
        thinking: noThinking(MODELS.helper), // thinking could use up the tiny token limit and cut the reply off
        messages: [{ role: "user", content: helperContext(room, solved, question, history) }],
      },
      CALL_LIMITS.helper, // short timeout: a slow hint gets a spooky "sorry", not a long wait
    );
    const call = record("helper", MODELS.helper, msg.usage);
    let text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    // A reply that hit max_tokens stops mid-word; keep only its complete sentences.
    const cutOff = msg.stop_reason === "max_tokens";
    if (cutOff) text = text.replace(/[^.!?]*$/, "");

    // 4. Output guardrail.
    const guarded = guardHelperReply(text, room);
    const flag = guarded.flag ?? (cutOff ? "reply ran out of room, so the unfinished sentence was removed" : null);
    return json({ ok: true, reply: guarded.text, flag, call, usage: snapshot() });
  } catch (e) {
    return aiError(e);
  }
}
