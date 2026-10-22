// SPOOKY SORRY MESSAGES — what players see when the AI fails or is slow.
// Shared by the server (lib/ai.ts) and the browser (components/Game.tsx), so every failure sounds like the game.

const SORRY = {
  timeout: [
    "The ghosts got lost in the fog and took too long. Try again!",
    "Our bat messenger flew the long way home. Try again!",
  ],
  busy: [
    "The haunted house is packed with monsters right now. Try again in a moment!",
    "Every broomstick is taken! Try again in a moment.",
  ],
  rate_limited: [
    "The witches need a quick broom break. Try again in a minute!",
    "The zombies are taking a snack break. Try again in a minute!",
  ],
  auth: ["The magic key doesn't fit the spooky door! A grown-up needs to check the server settings."],
  offline: [
    "The candles flickered and we lost the spell. Check your internet and try again!",
    "A spooky wind blew the connection away. Check your internet and try again!",
  ],
  // The helper's goodbye when a room's questions run out.
  alone: [
    "Oh no, the candle just blew out and I'm fading into the fog… you're on your own now! I know you can do it. 👻",
    "Oooh, the clock struck midnight and I must vanish! You're on your own in this room, brave one. Trust the clues!",
    "Eek! A gust of wind is carrying me away… you're on your own now! Read each clue slowly. You've got this!",
  ],
  // The helper's goodbye when a player has used all their questions for the day.
  alone_today: [
    "Oh no, the moon is setting and I must sleep until tomorrow night… you're on your own now! I believe in you. 🌙",
  ],
  error: [
    "Oops! A black cat knocked over the cauldron. Try again!",
    "Boo! Something spooky went wrong. Try again!",
  ],
};

export type SorryCode = keyof typeof SORRY;

export function sorry(code: SorryCode) {
  const lines = SORRY[code];
  return lines[Math.floor(Math.random() * lines.length)];
}
