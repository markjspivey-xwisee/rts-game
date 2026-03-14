// ═══════════════════════════════════════════════════════════════════════════
//  SPECIALIZATIONS & UNIT FACTORIES
// ═══════════════════════════════════════════════════════════════════════════

import { getEquipBonuses } from "./items.js";
import { PROMOTIONS, PROMO_ORDER } from "./constants.js";

export const SP = {
  none:       { c: "#b8a080", l: "Villager",   i: "♟" },
  lumberjack: { c: "#4a8c3f", l: "Lumberjack", i: "🪓" },
  miner:      { c: "#7a7a8e", l: "Miner",      i: "⛏" },
  farmer:     { c: "#c4a035", l: "Farmer",      i: "🌾" },
  warrior:    { c: "#a83232", l: "Warrior",     i: "⚔" },
  builder:    { c: "#6a5a3a", l: "Builder",     i: "🔨" },
};

/** Enemy (NPC raid) types */
export const ET = {
  scout:  { hp: 18, dmg: 2, spd: 2, c: "#c87040", ranged: false },
  brute:  { hp: 55, dmg: 6, spd: 0.5, c: "#8a3030", ranged: false },
  archer: { hp: 22, dmg: 3, spd: 1, c: "#a06050", ranged: true, range: 4 },
  raider: { hp: 30, dmg: 4, spd: 1, c: "#a04040", ranged: false },
};

/** Naval unit types */
export const NAVAL = {
  fishing_boat: { hp: 30, maxHp: 30, speed: 1, icon: "🎣", label: "Fishing Boat", gathers: "food", gSpd: 0.6, cost: { wood: 40 } },
  transport:    { hp: 60, maxHp: 60, speed: 1, icon: "⛵", label: "Transport", capacity: 5, cost: { wood: 60, gold: 20 } },
  warship:      { hp: 100, maxHp: 100, speed: 0.7, icon: "🚢", label: "Warship", dmg: 8, range: 5, siegeDmg: 6, cost: { wood: 80, gold: 40 } },
};

/**
 * Get combat promotion rank from total combat XP.
 */
export function getPromotion(v) {
  const totalXp = (v.xp?.combat || 0);
  let rank = "recruit";
  for (const r of PROMO_ORDER) {
    if (totalXp >= PROMOTIONS[r].minXp) rank = r;
  }
  return rank;
}

/**
 * Calculate specialization from XP.
 * @param {import('./types.js').Unit} v
 * @returns {{ s: string, lv: number }}
 */
export function calcSpec(v) {
  const { wood, stone, gold, food, combat, build } = v.xp;
  const e = [
    ["lumberjack", wood],
    ["miner", stone + gold],
    ["farmer", food],
    ["warrior", combat],
    ["builder", build],
  ];
  e.sort((a, b) => b[1] - a[1]);
  return e[0][1] >= 12 ? { s: e[0][0], lv: Math.min(5, Math.floor(e[0][1] / 18) + 1) } : { s: "none", lv: 0 };
}

/**
 * Apply spec bonuses to a villager based on their XP.
 * @param {import('./types.js').Unit} v
 */
export function applySpec(v) {
  const { s, lv } = calcSpec(v);
  v.spec = s;
  v.specLv = lv;
  const eq = getEquipBonuses(v.equip);
  const promo = PROMOTIONS[getPromotion(v)] || PROMOTIONS.recruit;
  const baseDmg = 2 + (s === "warrior" ? lv * 2.5 : 0) + eq.dmg;
  const baseHp = 30 + (s === "warrior" ? lv * 10 : 0) + eq.hpBonus;
  v.maxHp = Math.floor(baseHp * promo.hpMult);
  v.dmg = baseDmg * promo.dmgMult;
  v.maxCarry = 10 + (["lumberjack", "miner", "farmer"].includes(s) ? lv * 4 : 0) + eq.carryBonus;
  v.gSpd = 1 + (["lumberjack", "miner", "farmer"].includes(s) ? lv * 0.35 : 0) + eq.gSpd;
  v.bSpd = 1 + (s === "builder" ? lv * 0.6 : 0) + eq.bSpd;
  v.siegeDmg = eq.siegeDmg;
  v.atkRange = 1 + eq.atkRange;
  v.dmgReduce = eq.dmgReduce;
  v.promotion = getPromotion(v);
  if (v.hp > v.maxHp) v.hp = v.maxHp;
}

/**
 * Decay non-dominant XP over time.
 * @param {import('./types.js').Unit} v
 */
export function decayXP(v) {
  const { s } = calcSpec(v);
  const dom = { lumberjack: "wood", miner: "stone", farmer: "food", warrior: "combat", builder: "build" };
  for (const k of Object.keys(v.xp))
    if (k !== dom[s] && !(s === "miner" && k === "gold") && v.xp[k] > 0)
      v.xp[k] = Math.max(0, v.xp[k] - 0.05);
}

/**
 * Create a new villager unit.
 */
export function mkVillager(x, y, owner, state) {
  return {
    id: state.nextUid++, x, y, hp: 30, maxHp: 30, carry: 0, carryType: null, maxCarry: 10,
    cmd: null, targetId: null, buildType: null, buildX: 0, buildY: 0, moveX: 0, moveY: 0, tag: null,
    xp: { wood: 0, stone: 0, gold: 0, food: 0, combat: 0, build: 0 },
    spec: "none", specLv: 0, gSpd: 1, bSpd: 1, dmg: 2, alive: true, atkCd: 0, abCd: 0,
    equip: { weapon: null, armor: null, tool: null, vehicle: null },
    siegeDmg: 0, atkRange: 1, dmgReduce: 0,
    mounted: null, crewing: null,
    promotion: "recruit",
    formation: "none",
    owner,
  };
}

/**
 * Vehicle types and their stats.
 */
export const VEHICLE_TYPES = {
  battering_ram: {
    hp: 80, maxHp: 80, speed: 0.5, siegeDmg: 18, dmg: 3, atkRange: 1,
    icon: "🪵", label: "Battering Ram", color: "#6a4a2a",
  },
  catapult: {
    hp: 60, maxHp: 60, speed: 0.3, siegeDmg: 14, dmg: 5, atkRange: 5,
    icon: "💣", label: "Catapult", color: "#5a5a3a",
  },
  cart: {
    hp: 50, maxHp: 50, speed: 1, siegeDmg: 0, dmg: 0, atkRange: 0,
    icon: "🛒", label: "Cart", carryBonus: 25, color: "#6a5a2a",
  },
};

/**
 * Create a vehicle entity.
 */
export function mkVehicle(type, x, y, owner, state) {
  const def = VEHICLE_TYPES[type];
  return {
    id: state.nextUid++, type, x, y,
    hp: def.hp, maxHp: def.maxHp,
    crewId: null,
    alive: true,
    owner,
  };
}

/**
 * Create a naval unit.
 */
export function mkNavalUnit(type, x, y, owner, state) {
  const def = NAVAL[type];
  return {
    id: state.nextUid++, type, x, y,
    hp: def.hp, maxHp: def.maxHp,
    dmg: def.dmg || 0, range: def.range || 1, siegeDmg: def.siegeDmg || 0,
    speed: def.speed, alive: true, atkCd: 0,
    carry: 0, carryType: null, gSpd: def.gSpd || 0,
    passengers: [], capacity: def.capacity || 0,
    owner,
  };
}

/**
 * Create a new enemy (NPC raid) unit.
 */
export function mkEnemy(type, x, y, state) {
  const d = ET[type];
  return {
    id: state.nextUid++, x, y, type, hp: d.hp, maxHp: d.hp, dmg: d.dmg,
    spd: d.spd, ranged: d.ranged || false, range: d.range || 1,
    alive: true, atkCd: 0, moveCd: 0,
  };
}
