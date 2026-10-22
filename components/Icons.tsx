import type { ReactNode } from "react";
import type { Theme } from "@/lib/themes.ts";

const INK = "#221a3b";
const MOON = "#fbf4e4";

const ICONS: Record<Theme, ReactNode> = {
  ghost: (
    <>
      <path d="M14 58V28a18 18 0 0 1 36 0v30l-6-5-6 5-6-5-6 5-6-5z" fill="#9fe3e0" />
      <circle cx="25" cy="28" r="4" fill={INK} /><circle cx="39" cy="28" r="4" fill={INK} />
      <ellipse cx="32" cy="39" rx="4" ry="5" fill={INK} />
    </>
  ),
  witch: (
    <>
      <ellipse cx="32" cy="50" rx="28" ry="7" fill="#c79bff" />
      <path d="M18 49 30 6c1-3 4-3 5 0l11 43z" fill="#c79bff" />
      <path d="M30 6c6 2 12 6 16 12" stroke="#c79bff" strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="19" y="38" width="26" height="6" rx="2" fill="#ff9a3c" />
      <rect x="29" y="37" width="7" height="8" rx="1" fill={MOON} />
    </>
  ),
  zombie: (
    <>
      <rect x="12" y="10" width="40" height="44" rx="16" fill="#a6e35b" />
      <circle cx="24" cy="28" r="6" fill={MOON} /><circle cx="24" cy="28" r="2.5" fill={INK} />
      <circle cx="41" cy="30" r="4" fill={MOON} /><circle cx="41" cy="30" r="2" fill={INK} />
      <path d="M22 43h20M26 39v8M32 39v8M38 39v8" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 18c6-6 12-2 18-6" stroke="#5c8a2a" strokeWidth="3" fill="none" strokeLinecap="round" />
    </>
  ),
  scarecrow: (
    <>
      <circle cx="32" cy="36" r="16" fill="#f0d9a8" />
      <path d="M8 26h48l-8-6H16z" fill="#f4d35e" />
      <path d="M20 20 32 4l12 16z" fill="#f4d35e" />
      <circle cx="26" cy="34" r="3" fill={INK} /><circle cx="38" cy="34" r="3" fill={INK} />
      <path d="M24 43c5 4 11 4 16 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M26 44v3M32 46v3M38 44v3" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M17 50l-5 8M47 50l5 8M32 52v8" stroke="#f4d35e" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  ghoul: (
    <>
      <path d="M10 60c0-22 6-48 22-48s22 26 22 48z" fill="#8fb3ff" />
      <path d="M18 60c0-16 4-34 14-34s14 18 14 34z" fill={INK} />
      <ellipse cx="27" cy="38" rx="3" ry="4" fill="#d9fff3" /><ellipse cx="37" cy="38" rx="3" ry="4" fill="#d9fff3" />
      <circle cx="12" cy="10" r="3" fill="#d9fff3" /><circle cx="54" cy="16" r="2" fill="#d9fff3" />
    </>
  ),
  mummy: (
    <>
      <rect x="14" y="8" width="36" height="50" rx="14" fill="#f0d9a8" />
      <path d="M14 20l36 6M14 30l36-4M14 42l36 4M16 52l32-4" stroke="#c9b083" strokeWidth="3" />
      <rect x="20" y="30" width="24" height="9" rx="4" fill={INK} />
      <circle cx="27" cy="34.5" r="3" fill={MOON} /><circle cx="38" cy="34.5" r="2" fill={MOON} />
      <path d="M48 46c6 2 8 6 6 10" stroke="#f0d9a8" strokeWidth="3" fill="none" strokeLinecap="round" />
    </>
  ),
  vampire: (
    <>
      <path d="M6 58 16 30h32l10 28z" fill="#ff8fab" />
      <circle cx="32" cy="30" r="16" fill="#efe7ff" />
      <path d="M16 26c2-10 10-14 16-8 6-6 14-2 16 8-4-6-10-6-16 0-6-6-12-6-16 0z" fill={INK} />
      <circle cx="26" cy="31" r="2.5" fill={INK} /><circle cx="38" cy="31" r="2.5" fill={INK} />
      <path d="M25 38c4 3 10 3 14 0" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M28 39l1 4 1-3.5M34 39.5l1 3.5 1-4" fill={MOON} stroke={MOON} strokeWidth="1" />
    </>
  ),
  werewolf: (
    <>
      <path d="M12 26 16 6l10 12h12l10-12 4 20c4 18-6 30-20 30S8 44 12 26z" fill="#b8c4d6" />
      <ellipse cx="32" cy="42" rx="10" ry="8" fill="#e6ecf5" />
      <circle cx="24" cy="30" r="3" fill={INK} /><circle cx="40" cy="30" r="3" fill={INK} />
      <ellipse cx="32" cy="38" rx="4" ry="3" fill={INK} />
      <path d="M28 45c2 2 6 2 8 0" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  skeleton: (
    <>
      <path d="M32 6c14 0 22 9 22 21 0 8-4 13-8 15v8H18v-8c-4-2-8-7-8-15C10 15 18 6 32 6z" fill="#ece6ff" />
      <ellipse cx="24" cy="28" rx="6" ry="7" fill={INK} /><ellipse cx="40" cy="28" rx="6" ry="7" fill={INK} />
      <path d="M32 34l-3 6h6z" fill={INK} />
      <path d="M22 46v6M27 46v6M32 46v6M37 46v6M42 46v6" stroke={INK} strokeWidth="2" />
    </>
  ),
  pumpkin: (
    <>
      <ellipse cx="32" cy="38" rx="24" ry="19" fill="#ff9a3c" />
      <path d="M32 19c-6 6-6 32 0 38M32 19c6 6 6 32 0 38" stroke="#d9762a" strokeWidth="2" fill="none" />
      <path d="M31 20c0-6 2-10 6-12" stroke="#5c8a2a" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M20 32l5-5 5 5zM34 32l5-5 5 5z" fill="#ffe08a" />
      <path d="M20 42c6 6 18 6 24 0l-4 1-3 3-3-3-4 3-3-3z" fill="#ffe08a" />
    </>
  ),
  monster: (
    <>
      <path d="M32 14l-3-8 6 3-2-7" stroke="#ffe08a" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="32" cy="36" rx="22" ry="21" fill="#63d2ff" />
      <path d="M12 30c6-2 12 0 14 6l-12 8c-3-4-4-9-2-14z" fill="#ff8fab" />
      <path d="M40 52c4-6 10-8 14-6-2 5-6 9-12 10z" fill="#f4d35e" />
      <path d="M13 37l13-5M17 33l2 4M22 31l2 4" stroke={INK} strokeWidth="1.5" />
      <circle cx="26" cy="33" r="6" fill={MOON} /><circle cx="27" cy="34" r="3" fill={INK} />
      <circle cx="41" cy="33" r="3.5" fill={MOON} /><circle cx="41" cy="34" r="1.8" fill={INK} />
      <path d="M24 45c5 4 11 4 16 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M30 47v3M35 47v3" stroke={MOON} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  goblin: (
    <>
      <path d="M4 24l16 6M60 24l-16 6" stroke="#e0a96d" strokeWidth="8" strokeLinecap="round" />
      <circle cx="32" cy="34" r="18" fill="#e0a96d" />
      <circle cx="25" cy="31" r="4" fill={MOON} /><circle cx="25" cy="31" r="2" fill={INK} />
      <circle cx="39" cy="31" r="4" fill={MOON} /><circle cx="39" cy="31" r="2" fill={INK} />
      <path d="M22 41c6 6 14 6 20 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M29 44l2 3 2-3" fill={MOON} />
      <circle cx="50" cy="54" r="5" fill="#ffd166" /><circle cx="50" cy="54" r="1.5" fill={INK} />
    </>
  ),
  gargoyle: (
    <>
      <path d="M2 30c6-12 14-14 18-8M62 30c-6-12-14-14-18-8" fill="#5e9e84" stroke="#5e9e84" strokeWidth="4" strokeLinejoin="round" />
      <path d="M20 16l-4-10 10 6M44 16l4-10-10 6" fill="#7fc8a9" />
      <rect x="16" y="14" width="32" height="34" rx="12" fill="#7fc8a9" />
      <circle cx="26" cy="28" r="3.5" fill="#ffe08a" /><circle cx="38" cy="28" r="3.5" fill="#ffe08a" />
      <path d="M26 39c4 2 8 2 12 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="12" y="48" width="40" height="8" rx="2" fill="#5e9e84" />
    </>
  ),
};

export function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {ICONS[theme] ?? ICONS.ghost}
    </svg>
  );
}

export function CandyIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 32 3 22v20z M50 32l11-10v20z" fill="#ff9a3c" />
      <circle cx="32" cy="32" r="17" fill="#ff9a3c" />
      <path d="M22 22c6 4 14 4 20-1M22 42c6-4 14-4 20 1" stroke="#fbf4e4" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
