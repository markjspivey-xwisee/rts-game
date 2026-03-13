// ═══════════════════════════════════════════════════════════════════════════
//  BUILDINGS
// ═══════════════════════════════════════════════════════════════════════════

export const BLD = {
  house:    { cost: { wood: 30 }, pop: 4, size: 2, color: "#7B6545", hp: 100, bt: 25, icon: "🏠" },
  farm:     { cost: { wood: 20 }, size: 2, color: "#7B7B2A", hp: 60, bt: 20, gen: "food", rate: 0.18, icon: "🌾" },
  barracks: { cost: { wood: 50, stone: 20 }, size: 2, color: "#5B3216", hp: 150, bt: 35, icon: "⚔", unlocks: ["warrior_training"] },
  tower:    { cost: { stone: 40, gold: 10 }, size: 1, color: "#4a4a5e", hp: 200, bt: 40, range: 6, dmg: 4, icon: "🗼", requires: "tower" },
  workshop: { cost: { wood: 40, stone: 30 }, size: 2, color: "#5a4a3a", hp: 120, bt: 30, icon: "🔧", unlocks: ["tower"] },
  market:   { cost: { wood: 30, gold: 15 }, size: 2, color: "#6a5a2a", hp: 100, bt: 25, icon: "🏪", unlocks: ["trade"] },
  bridge:   { cost: { wood: 15, stone: 10 }, size: 1, color: "#8B7355", hp: 80, bt: 15, icon: "🌉" },
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
