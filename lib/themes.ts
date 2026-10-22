// The monster catalog and the "surprise mix" planner.
// Every new house gets 3 different monsters, chosen at random by the server (not the model, so the mix really varies).
// Each monster has its own trivia topic plus a short list of puzzle types that suit it; the planner picks 3 of those
// per room so that no puzzle type appears twice in the same house.

export const THEME_IDS = [
  "ghost", "witch", "zombie", "scarecrow", "ghoul", "mummy", "vampire",
  "werewolf", "skeleton", "pumpkin", "monster", "goblin", "gargoyle",
] as const;
export type Theme = (typeof THEME_IDS)[number];

export interface ThemeInfo {
  label: string; // "Ghost"
  color: string; // room accent on the dark sky
  setting: string; // where the room is
  helperIdea: string; // the friendly character
  trivia: string; // this monster's own trivia type label
  triviaTopic: string;
  types: string[]; // non-trivia puzzle types that suit this monster (the planner picks 3)
}

export const THEMES: Record<Theme, ThemeInfo> = {
  ghost: { label: "Ghost", color: "#9fe3e0", setting: "a dusty attic with floating sheets", helperIdea: "a small, giggly ghost who is a little shy", trivia: "Halloween trivia", triviaTopic: "Halloween customs and history (costumes, jack-o'-lanterns, trick-or-treating)", types: ["Riddle", "Count it", "Pattern", "Missing word", "Odd one out"] },
  witch: { label: "Witch", color: "#c79bff", setting: "a kitchen with a bubbling cauldron", helperIdea: "the witch's chatty black cat", trivia: "Animal trivia", triviaTopic: "real animals linked to witches (cats, toads, owls, spiders)", types: ["Potion math", "Unscramble", "Rhyme time", "Secret code", "Pattern"] },
  zombie: { label: "Zombie", color: "#a6e35b", setting: "a sleepy garden full of giant vegetables", helperIdea: "a slow, sleepy, goofy zombie who loves snacks and naps", trivia: "Science trivia", triviaTopic: "simple science (plants, seeds, the five senses, sleep)", types: ["Secret code", "Odd one out", "Missing word", "Count it", "Riddle"] },
  scarecrow: { label: "Scarecrow", color: "#f4d35e", setting: "a moonlit cornfield maze", helperIdea: "a shy scarecrow who is scared of crows", trivia: "Harvest trivia", triviaTopic: "farms and the autumn harvest (corn, apples, hay, leaves changing color)", types: ["Maze directions", "Sort it", "Count it", "Riddle", "Pattern"] },
  ghoul: { label: "Ghoul", color: "#8fb3ff", setting: "a cozy underground crypt lit by glowing mushrooms", helperIdea: "a tidy ghoul who collects lost socks and buttons", trivia: "Mushroom trivia", triviaTopic: "mushrooms, caves and things that glow in the dark", types: ["Matching pairs", "What's missing", "Odd one out", "Riddle", "Secret code"] },
  mummy: { label: "Mummy", color: "#f0d9a8", setting: "a dusty pyramid storeroom", helperIdea: "a polite mummy whose bandages keep unraveling", trivia: "Egypt trivia", triviaTopic: "ancient Egypt at a kid level (pyramids, the Nile, pharaohs, hieroglyphs)", types: ["Picture code", "Put in order", "Unscramble", "Count it", "Riddle"] },
  vampire: { label: "Vampire", color: "#ff8fab", setting: "a candlelit castle hall with a big clock", helperIdea: "a friendly vampire who only drinks tomato juice and is afraid of the dark", trivia: "Night animal trivia", triviaTopic: "animals that are awake at night (bats, owls, raccoons, fireflies)", types: ["Clock puzzle", "Mirror writing", "Riddle", "Pattern", "Potion math"] },
  werewolf: { label: "Werewolf", color: "#b8c4d6", setting: "a cabin in a moonlit forest", helperIdea: "a fluffy werewolf who howls off-key", trivia: "Moon trivia", triviaTopic: "the moon (phases, craters, astronauts, why it glows)", types: ["Sound pattern", "Track it", "Count it", "Rhyme time", "Missing word"] },
  skeleton: { label: "Skeleton", color: "#ece6ff", setting: "a music room with a bony band", helperIdea: "a cheerful skeleton who plays xylophone on its own ribs", trivia: "Body trivia", triviaTopic: "the human body at a kid level (bones, heart, teeth, muscles)", types: ["Count it", "Put in order", "Rhyme time", "Pattern", "Odd one out"] },
  pumpkin: { label: "Jack-o'-lantern", color: "#ff9a3c", setting: "a glowing pumpkin patch", helperIdea: "a talking jack-o'-lantern who wants the perfect carved face", trivia: "Plant trivia", triviaTopic: "how plants grow (seeds, roots, sunlight, vines, pumpkins)", types: ["Shape puzzle", "Count it", "Unscramble", "Riddle", "Missing word"] },
  monster: { label: "Patchwork monster", color: "#63d2ff", setting: "a lab full of bubbling jars and sparks", helperIdea: "a big, gentle monster stitched together from mismatched parts", trivia: "Weather trivia", triviaTopic: "weather (lightning, thunder, rain, rainbows, snow)", types: ["Put in order", "Logic puzzle", "Secret code", "Shape puzzle", "Count it"] },
  goblin: { label: "Goblin", color: "#e0a96d", setting: "a messy treasure cave", helperIdea: "a giggly goblin who hoards shiny buttons", trivia: "Rock trivia", triviaTopic: "rocks, gems and caves (crystals, volcanoes, fossils)", types: ["Money math", "Logic puzzle", "Odd one out", "Unscramble", "Pattern"] },
  gargoyle: { label: "Gargoyle", color: "#7fc8a9", setting: "a castle rooftop at midnight", helperIdea: "a stone gargoyle who only wakes up after dark", trivia: "Space trivia", triviaTopic: "space (stars, planets, the sun, constellations)", types: ["Mirror writing", "Logic puzzle", "Riddle", "Shape puzzle", "Count it"] },
};

/** How each puzzle type works — sent to the model so every type is built the same way. */
export const TYPE_RULES: Record<string, string> = {
  "Riddle": "a classic kid riddle; the answer is not in the text",
  "Count it": "a small word problem; the answer is a whole number",
  "Pattern": "a sequence of words or numbers with the next one missing",
  "Missing word": "a familiar phrase with one ___ blank",
  "Odd one out": "lists 4 items; the answer is the one that doesn't belong",
  "Potion math": "a recipe with adding or multiplying; the answer is a number",
  "Unscramble": "shows jumbled letters spaced out like S T O H G; the answer is the word",
  "Rhyme time": "describes something and says what word it rhymes with",
  "Secret code": "a code explained in the clue (e.g. A=1, B=2, ...) and an encoded word",
  "Maze directions": "short step-by-step directions through a named grid or maze; the answer is the place you end up, from a named list",
  "Sort it": "lists 4 items; asks which is the biggest/smallest/first etc.",
  "Matching pairs": "lists every item in ONE jumbled list (items that go together in pairs, plus one item with no partner), so the player has to do the matching; never group the pairs or say which item is left over; the answer is the item with no partner",
  "What's missing": "a list in a familiar order (days, letters, numbers) with one item missing",
  "Picture code": "a symbol code shown in the clue (e.g. ☾=C, ★=A, ▲=T) and a row of symbols to decode",
  "Put in order": "lists numbered steps out of order; asks which step comes first or last; the answer is the step number, and alternates must also include the step's own words (e.g. \"put the bread on the plate\")",
  "Clock puzzle": "a time puzzle (what time it will be after X hours, or how many hours between times); the answer is a number",
  "Mirror writing": "a word written backwards in capitals (e.g. YDNAC); the answer is the word read forwards",
  "Sound pattern": "a pattern of sounds like howl, howl, yip, howl, howl, ___",
  "Track it": "describes animal footprints and lists 3 animals; the answer is the animal that made them",
  "Shape puzzle": "counting sides, corners or shapes; the answer is a number or a shape name",
  "Logic puzzle": "2-3 simple facts about named characters (taller than, more than); asks who is the most/least",
  "Money math": "adding or subtracting coins or buttons; the answer is a number",
};

/** Types whose answer is (and must be) one of the items listed in the clue. */
export const LISTED_ANSWER_TYPES = new Set(["Odd one out", "Sort it", "Matching pairs", "Maze directions", "Logic puzzle", "Track it"]);
/** Types where the answer may appear in the clue but doesn't have to. */
export const ANSWER_MAY_APPEAR_TYPES = new Set(["Pattern", "Sound pattern", "Put in order", "Shape puzzle"]);

export const ALL_PUZZLE_TYPES = [...Object.keys(TYPE_RULES), ...THEME_IDS.map((t) => THEMES[t].trivia)];
export const isTrivia = (type: string) => /trivia/i.test(type);

export interface RoomPlan {
  theme: Theme;
  types: string[]; // exactly 4: three puzzle types + this monster's trivia
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Picks 3 different monsters and gives each room 3 puzzle types + its trivia, with no type used twice in the house. */
export function planHouse(rand: () => number = Math.random): RoomPlan[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const themes = shuffle([...THEME_IDS], rand).slice(0, 3);
    const used = new Set<string>();
    const plan: RoomPlan[] = [];
    for (const theme of themes) {
      const pick = shuffle(THEMES[theme].types, rand).filter((t) => !used.has(t)).slice(0, 3);
      if (pick.length < 3) break;
      pick.forEach((t) => used.add(t));
      plan.push({ theme, types: shuffle([...pick, THEMES[theme].trivia], rand) });
    }
    if (plan.length === 3) return plan;
  }
  // Practically unreachable; fall back to the classic trio.
  return [
    { theme: "ghost", types: ["Riddle", "Count it", "Pattern", "Halloween trivia"] },
    { theme: "witch", types: ["Potion math", "Unscramble", "Rhyme time", "Animal trivia"] },
    { theme: "zombie", types: ["Secret code", "Odd one out", "Missing word", "Science trivia"] },
  ];
}

export const isTheme = (t: unknown): t is Theme => THEME_IDS.includes(t as Theme);
