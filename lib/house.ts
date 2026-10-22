// Shared game data, types and validation. Used by both the browser and the server.

import { ALL_PUZZLE_TYPES, ANSWER_MAY_APPEAR_TYPES, isTheme, isTrivia, LISTED_ANSWER_TYPES, THEMES, type RoomPlan, type Theme } from "./themes.ts";
export type { Theme } from "./themes.ts";

export interface Puzzle {
  type: string;
  title: string;
  clue: string;
  question: string;
  answer: string;
  alternates: string[];
  hint: string;
}
export interface Room {
  theme: Theme;
  name: string;
  description: string;
  helper: { name: string; intro: string };
  puzzles: Puzzle[];
  unlock: string;
}
export interface House {
  title: string;
  premise: string;
  rooms: Room[];
  ending: string;
}

export const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Maps "count-it", "COUNT IT" etc. to the official puzzle type label, or "" if it isn't a known type. */
export function canonType(type: unknown) {
  return ALL_PUZZLE_TYPES.find((t) => norm(t) === norm(type)) ?? "";
}

export function isCorrect(p: Puzzle, guess: string) {
  const g = norm(guess);
  return !!g && [p.answer, ...(p.alternates || [])].some((a) => norm(a) === g);
}

const UNSAFE_WORDS =
  /\b(blood\w*|gore|gory|kill\w*|murder\w*|knife|knives|gun\w*|weapon\w*|stab\w*|corpse\w*|dead bod\w*|dismember\w*|torture\w*|sex\w*|nude|naked|porn\w*|suicid\w*|self[- ]?harm|drugs?|beer|alcohol|cigarette\w*|hate\w*|stupid|idiot|shut up)\b/i;
export { UNSAFE_WORDS };

/** The plan a house actually follows (for the sample house, or any house without one). */
export function planOf(house: House): RoomPlan[] {
  return house.rooms.map((r) => ({ theme: r.theme, types: r.puzzles.map((z) => canonType(z.type)) }));
}

/**
 * Output guardrail: checks a generated house is complete, fair, kid-safe and follows the room plan
 * (the right monsters in the right order, each room with exactly its assigned puzzle types).
 * With no plan, checks the house's own types are valid for each monster and never repeat.
 * Returns a list of problems (empty = OK).
 */
export function validateHouse(h: unknown, plan?: RoomPlan[]): string[] {
  const p: string[] = [];
  const house = h as Partial<House> | null;
  if (!house || typeof house !== "object" || !Array.isArray(house.rooms)) return ["reply wasn't a house"];
  if (!house.title || !house.premise || !house.ending) p.push("missing title, premise or ending");
  if (house.rooms.length !== 3) p.push(`had ${house.rooms.length} rooms instead of 3`);
  const seenTypes = new Set<string>();
  house.rooms.slice(0, 3).forEach((r, i) => {
    const n = `room ${i + 1}`;
    if (!r || !r.name || !Array.isArray(r.puzzles)) {
      p.push(`${n} is missing parts`);
      return;
    }
    const theme = String(r.theme || "").toLowerCase();
    if (plan && theme !== plan[i].theme) p.push(`${n} should be the ${plan[i].theme} room`);
    if (!isTheme(theme)) {
      p.push(`${n} has an unknown monster "${theme}"`);
      return;
    }
    if (r.puzzles.length !== 4) p.push(`${n} has ${r.puzzles.length} puzzles instead of 4`);

    const types = r.puzzles.map((z) => canonType(z?.type));
    const allowed = plan ? plan[i].types : [...THEMES[theme].types, THEMES[theme].trivia];
    if (types.some((t) => !t || !allowed.includes(t)) || new Set(types).size !== types.length)
      p.push(`${n} should use ${plan ? "exactly" : "only"}: ${allowed.join(", ")}`);
    if (!types.includes(THEMES[theme].trivia)) p.push(`${n} is missing its ${THEMES[theme].trivia} puzzle`);
    types.forEach((t) => {
      if (t && seenTypes.has(t)) p.push(`puzzle type "${t}" is used in more than one room`);
      if (t) seenTypes.add(t);
    });

    r.puzzles.forEach((z, j) => {
      const a = norm(z?.answer);
      const type = canonType(z?.type);
      const where = `${n} puzzle ${j + 1}`;
      const text = `${z?.clue} ${z?.question}`;
      if (!z?.clue || !z?.question) p.push(`${where} is missing its clue or question`);
      if (!/^[a-z0-9]{1,12}$/.test(a)) p.push(`${where} answer isn't a short word or number`);
      if (isTrivia(type)) {
        // Trivia is multiple choice, so the answer must be one of the listed choices.
        if (!/\bA\)/.test(text) || !/\bB\)/.test(text) || !/\bC\)/.test(text)) p.push(`${where} trivia needs choices A), B) and C)`);
        if (!norm(text).includes(a)) p.push(`${where} trivia answer isn't one of the choices`);
      } else if (LISTED_ANSWER_TYPES.has(type)) {
        if (!norm(text).includes(a)) p.push(`${where} answer isn't one of the listed items`);
      } else if (!ANSWER_MAY_APPEAR_TYPES.has(type) && a.length >= 4 && /[a-z]/.test(a) && new RegExp(`\\b${a}\\b`, "i").test(text)) {
        p.push(`${where} gives its answer away`);
      }
    });
  });
  if (UNSAFE_WORDS.test(JSON.stringify(house))) p.push("contained words that aren't kid-friendly");
  return p;
}

/** Trims every field to a safe length. Call only after validateHouse passes. */
export function cleanHouse(h: House): House {
  const S = (v: unknown, m = 400) => String(v ?? "").slice(0, m);
  return {
    title: S(h.title, 70) || "The Mystery House",
    premise: S(h.premise, 600),
    ending: S(h.ending, 900) || "You found the candy!",
    rooms: h.rooms.slice(0, 3).map((r) => cleanRoom(r)),
  };
}

export function cleanRoom(r: Room): Room {
  const S = (v: unknown, m = 400) => String(v ?? "").slice(0, m);
  const theme = String(r.theme || "").toLowerCase();
  return {
    theme: isTheme(theme) ? theme : "ghost",
    name: S(r.name, 50),
    description: S(r.description, 500),
    unlock: S(r.unlock, 400) || "The door opens!",
    helper: { name: S(r.helper?.name, 40) || "Your helper", intro: S(r.helper?.intro, 160) },
    puzzles: (r.puzzles || []).slice(0, 4).map((z) => ({
      type: canonType(z.type) || S(z.type, 24),
      title: S(z.title, 50),
      clue: S(z.clue, 300),
      question: S(z.question, 200),
      answer: S(z.answer, 24),
      alternates: (z.alternates || []).slice(0, 5).map((a) => S(a, 20)),
      hint: S(z.hint, 200),
    })),
  };
}

export const SAMPLE_HOUSE: House = {
  title: "The Great Candy Vanishing",
  premise:
    "Last night, every piece of Halloween candy in Pumpkin Hollow floated right out of the bowls and drifted up the hill, glowing like fireflies. The trail of sparkly wrappers stops at the creaky old house at the top. Solve the puzzles in all three rooms to get the candy back, and find out who took it and why.",
  rooms: [
    {
      theme: "ghost",
      name: "The Giggling Attic",
      description:
        "White sheets float near the ceiling, whispering to each other. Lollipop sticks are scattered across the dusty floor. A little ghost named Puff peeks out from behind a trunk, looking a bit guilty.",
      helper: { name: "Puff the Ghost", intro: "Boo! Um… I might know a teeny bit about the missing candy. Ask me for a nudge." },
      puzzles: [
        { type: "Count it", title: "Ghosts on the Walls", clue: "There are 3 ghosts on the left wall and 4 ghosts on the right wall.", question: "How many ghosts are there in all?", answer: "7", alternates: ["seven"], hint: "Add the left wall and the right wall together." },
        { type: "Halloween trivia", title: "The First Jack-o'-Lanterns", clue: "Puff's old book says that long ago in Ireland, people carved jack-o'-lanterns out of a different vegetable before pumpkins. A) turnips  B) bananas  C) cucumbers", question: "Which vegetable did they carve?", answer: "turnips", alternates: ["turnip", "a"], hint: "It's a round root vegetable that grows underground. It starts with T." },
        { type: "Pattern", title: "The Ghost Song", clue: "The ghosts sing: Boo, Hoo, Boo, Hoo, Boo, ___", question: "What word comes next?", answer: "hoo", alternates: [], hint: "The two words take turns." },
        { type: "Riddle", title: "Puff's Riddle", clue: "Ghosts love me. When the lights go out, I'm everywhere.", question: "The more of me there is, the less you can see. What am I?", answer: "dark", alternates: ["darkness", "the dark"], hint: "Think about what happens at night when you turn off the lamp." },
      ],
      unlock: "Behind the door you find a sack of lollipops and a note in wobbly ghost writing: \"Part 1 of the plan: float ALL the candy up the hill. Don't be mad! —Puff\"",
    },
    {
      theme: "witch",
      name: "The Bubbling Kitchen",
      description:
        "A big purple cauldron bubbles and burps, and it smells like chocolate. Jars of glitter line the shelves. A black cat named Midnight sits on the broom, licking caramel off one paw.",
      helper: { name: "Midnight the Cat", intro: "Mrrow! I'm not saying the witch took the candy… but I can help with puzzles." },
      puzzles: [
        { type: "Potion math", title: "The Slime Recipe", clue: "The recipe says: 2 frog-shaped gummies for every cup of slime. The witch is making 3 cups.", question: "How many gummies does she need?", answer: "6", alternates: ["six"], hint: "Count by twos, three times: 2, 4, ..." },
        { type: "Unscramble", title: "The Flying Word", clue: "Letters on the spell book: R O M O B", question: "Unscramble the letters. What does a witch ride?", answer: "broom", alternates: [], hint: "Midnight is sitting on it right now." },
        { type: "Rhyme time", title: "The Pet Riddle", clue: "I purr and I nap, and I sleep on your lap. My name rhymes with HAT.", question: "What am I?", answer: "cat", alternates: ["kitty", "kitten"], hint: "Look at who is helping you in this room." },
        { type: "Animal trivia", title: "Bats in the Rafters", clue: "Bats are the only mammals that can really fly. When they sleep in the kitchen rafters, how do they hang? A) sideways  B) upside down  C) standing up", question: "How do bats sleep?", answer: "upside down", alternates: ["upsidedown", "b"], hint: "Their feet hold on to the ceiling, so their heads point at the floor." },
      ],
      unlock: "POOF! The glitter clears, and the cauldron is full of chocolate bars. Taped to the side is a recipe card: \"Part 2: shrink the candy so it all fits in the garden. Shh!\"",
    },
    {
      theme: "zombie",
      name: "The Snoring Garden",
      description:
        "Sleepy zombies shuffle between giant pumpkins, yawning and hanging paper streamers. They're not scary at all. Someone is blowing up orange balloons behind the biggest pumpkin.",
      helper: { name: "Gus the Zombie", intro: "Uhhh, hi! I'm Gus. Candy? What candy? I'm good at helping with puzzles though." },
      puzzles: [
        { type: "Secret code", title: "Gus's Secret Note", clue: "Gus wrote a note in number code, where A=1, B=2, C=3, and so on. The note says: 3 1 14 4 25", question: "What word did Gus write?", answer: "candy", alternates: [], hint: "Count through the alphabet: 3 is C, 1 is A. What letter is 14?" },
        { type: "Odd one out", title: "The Snack Pile", clue: "Gus's snack pile has a pumpkin, a carrot, an apple and a sock.", question: "Which one doesn't belong because you can't eat it?", answer: "sock", alternates: ["asock", "socks"], hint: "Three of these are food. One goes on your foot." },
        { type: "Missing word", title: "The Party Banner", clue: "A paper banner is missing its last word. It says: TRICK OR ___!", question: "What's the missing word?", answer: "treat", alternates: ["treats"], hint: "It's what kids say at the door on Halloween. It's something yummy." },
        { type: "Science trivia", title: "Inside a Pumpkin", clue: "Gus cuts open a pumpkin from the garden. What is it full of inside? A) rocks  B) seeds  C) marbles", question: "What's inside a pumpkin?", answer: "seeds", alternates: ["seed", "b"], hint: "New pumpkins grow from these when you plant them." },
      ],
      unlock: "Gus opens the gate to the back garden. Inside the biggest pumpkin of all is every last piece of Pumpkin Hollow's candy, under a banner made of bedsheets.",
    },
  ],
  ending:
    "The banner says: WE NEVER GET TRICK-OR-TREATS. Every year, people shut their doors when a ghost, a witch or a zombie knocks, so Puff, Midnight and Gus have never had a single piece of Halloween candy. They only wanted to throw one Halloween party. You help carry the candy back to town, and you bring the whole town back up the hill. Now Pumpkin Hollow's best trick-or-treat stop is the old house on the hill.",
};
