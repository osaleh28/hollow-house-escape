// THE HOUSE LIBRARY — every house the game can pick from: the built-in sample plus the checked houses
// in data/houses.json (built ahead of time by `npm run library`, so players never wait for the AI).

import LIBRARY from "../data/houses.json";
import { SAMPLE_HOUSE, type House } from "./house.ts";

export const HOUSES: House[] = [SAMPLE_HOUSE, ...(LIBRARY as House[])];
