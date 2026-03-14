// ═══════════════════════════════════════════════════════════════════════════
//  BUILDINGS
// ═══════════════════════════════════════════════════════════════════════════

export const BLD = {
  // ── Dark Age ──
  house:    { cost: { wood: 30 }, pop: 4, size: 2, color: "#7B6545", hp: 100, bt: 25, icon: "🏠", age: "dark" },
  farm:     { cost: { wood: 20 }, size: 2, color: "#7B7B2A", hp: 60, bt: 20, gen: "food", rate: 0.18, icon: "🌾", age: "dark" },
  barracks: { cost: { wood: 50, stone: 20 }, size: 2, color: "#5B3216", hp: 150, bt: 35, icon: "⚔", unlocks: ["warrior_training"], age: "dark" },
  wall:     { cost: { stone: 5 }, size: 1, color: "#5a5a6a", hp: 250, bt: 8, icon: "🧱", age: "dark", blocksPath: true },
  gate:     { cost: { stone: 10, wood: 5 }, size: 1, color: "#6a6a7a", hp: 200, bt: 12, icon: "🚪", age: "dark", isGate: true },
  bridge:   { cost: { wood: 15, stone: 10 }, size: 1, color: "#8B7355", hp: 80, bt: 15, icon: "🌉", age: "dark" },
  // ── Feudal Age ──
  workshop: { cost: { wood: 40, stone: 30 }, size: 2, color: "#5a4a3a", hp: 120, bt: 30, icon: "🔧", unlocks: ["tower"], age: "feudal" },
  market:   { cost: { wood: 30, gold: 15 }, size: 2, color: "#6a5a2a", hp: 100, bt: 25, icon: "🏪", unlocks: ["trade"], age: "feudal" },
  stable:   { cost: { wood: 40, food: 20 }, size: 2, color: "#6B5A40", hp: 110, bt: 28, icon: "🐴", unlocks: ["horsemanship"], age: "feudal" },
  tower:    { cost: { stone: 40, gold: 10 }, size: 1, color: "#4a4a5e", hp: 200, bt: 40, range: 6, dmg: 4, icon: "🗼", requires: "tower", age: "feudal" },
  dock:     { cost: { wood: 50 }, size: 2, color: "#4a3a2a", hp: 120, bt: 30, icon: "⚓", unlocks: ["sailing"], age: "feudal", onWater: true },
  // ── Castle Age ──
  temple:   { cost: { stone: 60, gold: 40 }, size: 2, color: "#8a7a6a", hp: 180, bt: 45, icon: "⛪", unlocks: ["faith"], age: "castle" },
  castle_tower: { cost: { stone: 80, gold: 30 }, size: 1, color: "#5a5a7a", hp: 400, bt: 60, range: 8, dmg: 8, icon: "🏰", requires: "tower", age: "castle" },
  monastery:    { cost: { wood: 80, stone: 50, gold: 30 }, size: 2, color: "#b0a0d0", hp: 160, bt: 40, icon: "🙏", unlocks: ["healing"], age: "castle" },
  // ── Imperial Age ──
  university: { cost: { wood: 60, stone: 40, gold: 60 }, size: 2, color: "#4a6a8a", hp: 140, bt: 45, icon: "🎓", unlocks: ["research"], age: "imperial" },
  wonder:   { cost: { wood: 200, stone: 200, gold: 200 }, size: 3, color: "#c4a035", hp: 600, bt: 200, icon: "🏛", age: "imperial" },
};

/**
 * Get the set of techs unlocked by built buildings.
 * @param {import('./types.js').Building[]} blds
 * @returns {Set<string>}
 */
export function getTech(blds) {
  const t = new Set();
  for (const b of blds) {
    if (!b.built) continue;
    const d = BLD[b.type];
    if (d?.unlocks) d.unlocks.forEach(u => t.add(u));
  }
  return t;
}
