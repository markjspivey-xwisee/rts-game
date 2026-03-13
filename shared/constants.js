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
