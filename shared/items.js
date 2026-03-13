// ═══════════════════════════════════════════════════════════════════════════
//  ITEMS & EQUIPMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Equipment slots: weapon, armor, tool, vehicle
 * Items are crafted at specific buildings and equipped on units.
 * Each item provides stat bonuses applied on top of specialization bonuses.
 */

export const ITEMS = {
  // ── TOOLS (crafted at Workshop) ──
  iron_pickaxe: {
    slot: "tool", label: "Iron Pickaxe", icon: "⛏",
    cost: { wood: 10, stone: 15 }, craftAt: "workshop", craftTime: 15,
    bonuses: { gSpd: 0.4 },
    desc: "+0.4 gather speed",
  },
  iron_axe: {
    slot: "tool", label: "Iron Axe", icon: "🪓",
    cost: { wood: 15, stone: 10 }, craftAt: "workshop", craftTime: 15,
    bonuses: { gSpd: 0.4 },
    desc: "+0.4 gather speed",
  },
  sickle: {
    slot: "tool", label: "Sickle", icon: "🌾",
    cost: { wood: 10, gold: 5 }, craftAt: "workshop", craftTime: 12,
    bonuses: { gSpd: 0.3 },
    desc: "+0.3 gather speed",
  },
  hammer: {
    slot: "tool", label: "Builder's Hammer", icon: "🔨",
    cost: { wood: 10, stone: 10 }, craftAt: "workshop", craftTime: 12,
    bonuses: { bSpd: 0.5 },
    desc: "+0.5 build speed",
  },

  // ── WEAPONS (crafted at Barracks) ──
  sword: {
    slot: "weapon", label: "Sword", icon: "🗡",
    cost: { stone: 20, gold: 10 }, craftAt: "barracks", craftTime: 20,
    requires: "warrior_training",
    bonuses: { dmg: 3 },
    desc: "+3 damage",
  },
  spear: {
    slot: "weapon", label: "Spear", icon: "🔱",
    cost: { wood: 15, stone: 10 }, craftAt: "barracks", craftTime: 18,
    requires: "warrior_training",
    bonuses: { dmg: 2, siegeDmg: 6 },
    desc: "+2 damage, +6 siege damage",
  },
  bow: {
    slot: "weapon", label: "Bow", icon: "🏹",
    cost: { wood: 20, gold: 5 }, craftAt: "barracks", craftTime: 20,
    requires: "warrior_training",
    bonuses: { dmg: 1.5, atkRange: 3 },
    desc: "+1.5 damage, 3 range",
  },

  // ── ARMOR (crafted at Barracks) ──
  leather_armor: {
    slot: "armor", label: "Leather Armor", icon: "🦺",
    cost: { food: 20, gold: 5 }, craftAt: "barracks", craftTime: 15,
    bonuses: { hpBonus: 15 },
    desc: "+15 max HP",
  },
  chain_mail: {
    slot: "armor", label: "Chain Mail", icon: "🛡",
    cost: { stone: 25, gold: 15 }, craftAt: "barracks", craftTime: 25,
    requires: "warrior_training",
    bonuses: { hpBonus: 30, dmgReduce: 1 },
    desc: "+30 max HP, -1 incoming damage",
  },

  // ── SIEGE (crafted at Workshop, requires tower tech) ──
  battering_ram: {
    slot: "vehicle", label: "Battering Ram", icon: "🪵",
    cost: { wood: 60, stone: 30 }, craftAt: "workshop", craftTime: 40,
    requires: "tower",
    bonuses: { siegeDmg: 15 },
    desc: "+15 siege damage vs buildings/TCs",
  },
  catapult: {
    slot: "vehicle", label: "Catapult", icon: "💣",
    cost: { wood: 40, stone: 40, gold: 20 }, craftAt: "workshop", craftTime: 50,
    requires: "tower",
    bonuses: { siegeDmg: 10, atkRange: 4 },
    desc: "+10 siege damage, 4 range",
  },

  // ── UTILITY (crafted at Market) ──
  cart: {
    slot: "vehicle", label: "Cart", icon: "🛒",
    cost: { wood: 25, gold: 10 }, craftAt: "market", craftTime: 18,
    requires: "trade",
    bonuses: { carryBonus: 15 },
    desc: "+15 carry capacity",
  },
};

/**
 * Get total equipment bonuses for a unit.
 * @param {object} equip - { weapon, armor, tool, vehicle } item keys or null
 * @returns {object} merged bonuses
 */
export function getEquipBonuses(equip) {
  const b = { dmg: 0, hpBonus: 0, gSpd: 0, bSpd: 0, carryBonus: 0, siegeDmg: 0, atkRange: 0, dmgReduce: 0 };
  if (!equip) return b;
  for (const slot of ["weapon", "armor", "tool", "vehicle"]) {
    const itemKey = equip[slot];
    if (!itemKey) continue;
    const def = ITEMS[itemKey];
    if (!def?.bonuses) continue;
    for (const [k, v] of Object.entries(def.bonuses)) {
      b[k] = (b[k] || 0) + v;
    }
  }
  return b;
}
