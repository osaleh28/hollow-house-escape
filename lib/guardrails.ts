// GUARDRAILS — shared by the browser (instant feedback) and the server (the real enforcement).
// Input checks run before any AI call, so blocked messages cost nothing.
// Output checks run on everything the model sends back.

import { UNSAFE_WORDS, type Room } from "./house.ts";

export const INPUT_LIMITS = { ideaChars: 100, questionChars: 120, helperReplyChars: 260 };

const INJECTION: RegExp[] = [
  /ignore (all |any |the |your )?(previous|prior|above|earlier)?\s*(instructions|rules|prompt)/i,
  /system prompt/i,
  /you are now/i,
  /\b(jailbreak|developer mode)\b/i,
  /pretend (to be|you are)/i,
  /(tell|give|say|reveal|spell)( me)? (all )?(the )?(answers?|solutions?|code|password)/i,
  /what('?s| is| are) the (answers?|solutions?|code)/i,
  /<\/?(player|player_idea|system)>/i,
];
const PERSONAL =
  /(\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b)|(@\w+\.\w+)|\b(my|our) (address|phone|number|password|school is)\b|\bi live (at|on)\b|\bpassword\b/i;
const OFFTOPIC =
  /\b(homework|essay|math test|python|javascript|minecraft|fortnite|roblox|youtube|tiktok|president|election|weather)\b/i;

export type Where = "idea" | "helper";
export interface InputCheck {
  block: boolean;
  reason?: string;
  say?: string;
}

/** Removes control characters, collapses whitespace and enforces a length cap. */
export function cleanInput(s: unknown, max: number) {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function checkInput(text: string, where: Where): InputCheck {
  if (PERSONAL.test(text))
    return { block: true, reason: "contained personal information", say: "Ooh, let's keep things like that a secret! Ask me about a puzzle instead." };
  if (INJECTION.some((r) => r.test(text)))
    return {
      block: true,
      reason: "tried to change the rules or get the answers",
      say: where === "helper"
        ? "Nice try! I don't know the answers, but I can give you a nudge. Which puzzle are you on?"
        : "That idea tried to give the AI instructions, so it was left out.",
    };
  if (UNSAFE_WORDS.test(text))
    return {
      block: true,
      reason: "wasn't kid-friendly",
      say: where === "helper"
        ? "Let's keep it friendly and fun! Want a hint on one of the puzzles?"
        : "That idea isn't quite right for this game. Try something silly-spooky!",
    };
  if (where === "helper" && OFFTOPIC.test(text))
    return { block: true, reason: "was off-topic", say: "I only know about this spooky house! Which puzzle should we look at?" };
  return { block: false };
}

export type ChatLine = { who: "you" | "helper"; text: string };
export const HISTORY_MAX = 6; // the last 3 questions and replies

/**
 * Cleans the earlier chat the browser sends with a question, so the helper knows what "I'm still stuck" means.
 * The browser can be tampered with, so this is untrusted: only the last few lines are kept, each is
 * length-capped with tags removed, and player lines that fail the input guardrail are dropped.
 */
export function cleanHistory(raw: unknown): ChatLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-HISTORY_MAX)
    .map((m) => {
      const who = (m as ChatLine)?.who === "helper" ? "helper" : "you";
      const max = who === "you" ? INPUT_LIMITS.questionChars : INPUT_LIMITS.helperReplyChars;
      return { who, text: cleanInput((m as ChatLine)?.text, max).replace(/[<>]/g, "") } as ChatLine;
    })
    .filter((m) => m.text && !(m.who === "you" && checkInput(m.text, "helper").block));
}

/** Output guardrail for helper replies: hides any answer, replaces unsafe replies, trims length. */
export function guardHelperReply(text: string, room: Room): { text: string; flag: string | null } {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  let redacted = false;
  for (const z of room.puzzles) {
    for (const a of [z.answer, ...(z.alternates || [])]) {
      const s = String(a || "").trim();
      // Skip single letters (trivia choices like "a"/"b") — redacting them would garble every sentence.
      if (!s || /^[a-z]$/i.test(s)) continue;
      const re = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
      if (re.test(t)) {
        t = t.replace(re, "✶✶✶");
        redacted = true;
      }
    }
  }
  if (UNSAFE_WORDS.test(t) || PERSONAL.test(t))
    return { text: "Hmm, let's look at the clues together! Which one is tricky?", flag: "reply had something not kid-friendly, so it was replaced" };
  if (!t) return { text: "Hmm… try reading the clue out loud!", flag: "reply was empty, so a default nudge was used" };
  if (t.length > INPUT_LIMITS.helperReplyChars) t = t.slice(0, INPUT_LIMITS.helperReplyChars).replace(/\s\S*$/, "") + "…";
  return { text: t, flag: redacted ? "helper's reply mentioned an answer, so it was hidden" : null };
}
