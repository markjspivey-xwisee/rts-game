// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export const T = 14;
export const MW = 64;
export const MH = 44;
export const TICK_MS = 100;

export const FOG_UNK = 0;
export const FOG_SEEN = 1;
export const FOG_VIS = 2;

export const VIS = 6;
export const TVIS = 8;

export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_HILL = 2;
export const TERRAIN_BRIDGE = 3;

/** Manhattan distance between two points {x,y} */
export const D = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Clamp value between lo and hi */
export const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Random integer in [lo, hi] inclusive */
export const ri = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

/** Random pick from array */
export const pk = (a) => a[ri(0, a.length - 1)];

/** Player colors: green, red, blue, yellow for P1-P4 */
export const PLAYER_COLORS = ["#4a8c3f", "#c44444", "#4444c4", "#c4a035"];

// ── Ages ────────────────────────────────────────────────────────────────
export const AGES = {
  dark:     { id: 0, name: "Dark Age",     icon: "🏚", color: "#7a6a5a" },
  feudal:   { id: 1, name: "Feudal Age",   icon: "🏰", color: "#8a7a4a" },
  castle:   { id: 2, name: "Castle Age",   icon: "🏯", color: "#6a6a9a" },
  imperial: { id: 3, name: "Imperial Age",  icon: "👑", color: "#c4a035" },
};
export const AGE_ORDER = ["dark", "feudal", "castle", "imperial"];
export const AGE_COSTS = {
  feudal:   { food: 200, gold: 50 },
  castle:   { food: 400, gold: 100, stone: 100 },
  imperial: { food: 600, gold: 200, stone: 200 },
};
export const AGE_TIME = { feudal: 80, castle: 120, imperial: 160 };

// ── Unit Promotions ──────────────────────────────────────────────────────
export const PROMOTIONS = {
  recruit:  { minXp: 0,   icon: "", label: "Recruit", dmgMult: 1, hpMult: 1 },
  veteran:  { minXp: 30,  icon: "⭐", label: "Veteran", dmgMult: 1.15, hpMult: 1.1 },
  elite:    { minXp: 80,  icon: "🌟", label: "Elite", dmgMult: 1.3, hpMult: 1.2 },
  champion: { minXp: 160, icon: "💎", label: "Champion", dmgMult: 1.5, hpMult: 1.35 },
};
export const PROMO_ORDER = ["recruit", "veteran", "elite", "champion"];

// ── Diplomacy ────────────────────────────────────────────────────────────
export const DIPLO = { enemy: 0, neutral: 1, ally: 2 };

// ── Formation bonuses ────────────────────────────────────────────────────
export const FORMATIONS = {
  none: { label: "None", dmgMult: 1, dmgReduce: 0 },
  line: { label: "Line", dmgMult: 1.1, dmgReduce: 0.5 },
  wedge: { label: "Wedge", dmgMult: 1.25, dmgReduce: 0, speedMult: 1.15 },
  box: { label: "Box", dmgMult: 0.9, dmgReduce: 1.5 },
};

// ── Map themes ───────────────────────────────────────────────────────────
export const MAP_THEMES = {
  default:  { name: "Standard",  water: 0.08, hills: 8,  forests: 1,   desc: "Classic RTS terrain" },
  desert:   { name: "Desert",    water: 0.03, hills: 12, forests: 0.3, desc: "Arid wastes with oases" },
  island:   { name: "Islands",   water: 0.35, hills: 4,  forests: 0.6, desc: "Archipelago map" },
  forest:   { name: "Black Forest", water: 0.05, hills: 5, forests: 3, desc: "Dense tree coverage" },
  arena:    { name: "Arena",     water: 0,    hills: 3,  forests: 0.5, desc: "Open battlefield" },
};

// ── Terrain types (expanded) ─────────────────────────────────────────────
export const TERRAIN_SAND = 4;
export const TERRAIN_DEEPWATER = 5;
