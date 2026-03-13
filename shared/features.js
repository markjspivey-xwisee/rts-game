// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE EXTRACTION & ACTION DECODING for Neural Net
// ═══════════════════════════════════════════════════════════════════════════

export const FEATURE_SIZE = 45;
export const ACTION_SIZE = 13;
export const DEFAULT_LAYERS = [45, 32, 16, 13];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const SPEC_KEYS = ["none", "lumberjack", "miner", "farmer", "warrior", "builder"];
const BLD_KEYS = ["house", "farm", "barracks", "tower", "workshop", "market", "bridge"];
const RES_TYPES = ["wood", "stone", "gold", "food"];

/**
 * Extract a fixed-size feature vector from the script API state.
 * Returns Float64Array(45), all values roughly in [0, 1].
 *
 * @param {object} api - The script API object (villagers, enemies, resources, stockpile, etc.)
 * @returns {Float64Array}
 */
export function extractFeatures(api) {
  const f = new Float64Array(FEATURE_SIZE);
  const stk = api.stockpile || {};
  const alive = (api.villagers || []).filter(v => v.alive !== false);
  const enemies = api.enemies || [];
  const buildings = api.buildings || [];
  const resources = api.resources || [];
  const tc = api.tc || { x: 0, y: 0, hp: 500, maxHp: 500 };
  const tech = api.tech || [];
  const tick = api.tick || 0;
  const popCap = api.popCap || 4;
  const D = api.pathDist || ((a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y));

  // [0-3] Resource levels
  f[0] = clamp((stk.wood || 0) / 500, 0, 1);
  f[1] = clamp((stk.stone || 0) / 500, 0, 1);
  f[2] = clamp((stk.gold || 0) / 500, 0, 1);
  f[3] = clamp((stk.food || 0) / 500, 0, 1);

  // [4] Total alive units
  f[4] = clamp(alive.length / 30, 0, 1);

  // [5-10] Spec counts
  const specCount = {};
  for (const s of SPEC_KEYS) specCount[s] = 0;
  for (const v of alive) specCount[v.spec || "none"]++;
  f[5] = clamp(specCount.none / 20, 0, 1);
  f[6] = clamp(specCount.lumberjack / 10, 0, 1);
  f[7] = clamp(specCount.miner / 10, 0, 1);
  f[8] = clamp(specCount.farmer / 10, 0, 1);
  f[9] = clamp(specCount.warrior / 10, 0, 1);
  f[10] = clamp(specCount.builder / 10, 0, 1);

  // [11-17] Building counts (only built ones)
  const bldCount = {};
  for (const k of BLD_KEYS) bldCount[k] = 0;
  for (const b of buildings) if (b.built) bldCount[b.type] = (bldCount[b.type] || 0) + 1;
  f[11] = clamp(bldCount.house / 7, 0, 1);
  f[12] = clamp(bldCount.farm / 5, 0, 1);
  f[13] = clamp(bldCount.barracks / 2, 0, 1);
  f[14] = clamp(bldCount.tower / 4, 0, 1);
  f[15] = clamp(bldCount.workshop / 2, 0, 1);
  f[16] = clamp(bldCount.market / 2, 0, 1);
  f[17] = clamp(bldCount.bridge / 3, 0, 1);

  // [18] TC health ratio
  f[18] = clamp((tc.hp || 500) / (tc.maxHp || 500), 0, 1);

  // [19-21] Enemy threat levels
  f[19] = clamp(enemies.length / 20, 0, 1);
  let threatsNear = 0, threatsClose = 0;
  for (const e of enemies) {
    const d = D(e, tc);
    if (d < 14) threatsNear++;
    if (d < 6) threatsClose++;
  }
  f[20] = clamp(threatsNear / 10, 0, 1);
  f[21] = clamp(threatsClose / 5, 0, 1);

  // [22-23] Enemy TC
  const etc = api.enemyTc;
  f[22] = etc ? clamp((etc.hp || 500) / 500, 0, 1) : 0;
  f[23] = etc ? 1 : 0;

  // [24-26] Tech
  f[24] = tech.includes("warrior_training") ? 1 : 0;
  f[25] = tech.includes("tower") ? 1 : 0;
  f[26] = tech.includes("trade") ? 1 : 0;

  // [27] Population ratio
  f[27] = clamp(alive.length / Math.max(popCap, 1), 0, 1);

  // [28-30] Game phase (early / mid / late)
  f[28] = clamp(tick / 600, 0, 1);
  f[29] = clamp((tick - 600) / 600, 0, 1);
  f[30] = clamp((tick - 1200) / 600, 0, 1);

  // [31-34] Current activity ratios
  let idleN = 0, gatherN = 0, atkN = 0, buildN = 0;
  for (const v of alive) {
    if (!v.cmd || v.cmd === "idle") idleN++;
    else if (v.cmd === "gather") gatherN++;
    else if (v.cmd === "attack") atkN++;
    else if (v.cmd === "build") buildN++;
  }
  const aliveN = Math.max(alive.length, 1);
  f[31] = idleN / aliveN;
  f[32] = gatherN / aliveN;
  f[33] = atkN / aliveN;
  f[34] = buildN / aliveN;

  // [35] Average villager HP ratio
  let hpSum = 0;
  for (const v of alive) hpSum += (v.hp || 0) / (v.maxHp || 30);
  f[35] = alive.length > 0 ? hpSum / alive.length : 0;

  // [36-38] Equipment ratios
  let weapN = 0, toolN = 0, armorN = 0;
  for (const v of alive) {
    if (v.equip?.weapon) weapN++;
    if (v.equip?.tool) toolN++;
    if (v.equip?.armor) armorN++;
  }
  f[36] = weapN / aliveN;
  f[37] = toolN / aliveN;
  f[38] = armorN / aliveN;

  // [39-42] Nearest resource distance by type
  for (let i = 0; i < RES_TYPES.length; i++) {
    let minD = 64;
    for (const r of resources) {
      if (r.type === RES_TYPES[i] && r.amount > 0) {
        const d = D(r, tc);
        if (d < minD) minD = d;
      }
    }
    f[39 + i] = clamp(minD / 64, 0, 1);
  }

  // [43-44] Resource deltas (tracked via memory if available)
  const mem = api.memory || {};
  if (mem._prevStk) {
    f[43] = clamp(((stk.food || 0) - (mem._prevStk.food || 0)) * 10, -1, 1);
    f[44] = clamp(((stk.wood || 0) - (mem._prevStk.wood || 0)) * 10, -1, 1);
  }
  mem._prevStk = { ...stk };

  return f;
}

/**
 * Decode a neural net output vector into a structured decision object.
 *
 * @param {number[]} output - 13-element array from net.forward(), all in [0,1]
 * @returns {object} Decision object for script use
 */
export function decodeAction(output) {
  const v = output;
  const BUILD_MAP = ["house", "farm", "barracks", "workshop", "market", "tower"];

  const buildOrders = [];
  for (let i = 0; i < BUILD_MAP.length; i++) {
    if (v[4 + i] > 0.5) buildOrders.push(BUILD_MAP[i]);
  }

  return {
    gatherPriority: { wood: v[0], stone: v[1], gold: v[2], food: v[3] },
    buildOrders,
    militaryRatio: v[10],
    shouldAttack: v[11] > 0.5,
    shouldCraft: v[12] > 0.5,
  };
}

/**
 * Feature index documentation for reference.
 */
export const FEATURE_LABELS = [
  "stk_wood", "stk_stone", "stk_gold", "stk_food",
  "unit_count", "spec_none", "spec_lumberjack", "spec_miner", "spec_farmer", "spec_warrior", "spec_builder",
  "bld_house", "bld_farm", "bld_barracks", "bld_tower", "bld_workshop", "bld_market", "bld_bridge",
  "tc_hp", "enemy_count", "threats_near", "threats_close",
  "enemy_tc_hp", "enemy_tc_visible", "tech_warrior", "tech_tower", "tech_trade",
  "pop_ratio", "phase_early", "phase_mid", "phase_late",
  "act_idle", "act_gather", "act_attack", "act_build",
  "avg_hp", "equip_weapon", "equip_tool", "equip_armor",
  "dist_wood", "dist_stone", "dist_gold", "dist_food",
  "delta_food", "delta_wood",
];

export const ACTION_LABELS = [
  "gather_wood", "gather_stone", "gather_gold", "gather_food",
  "build_house", "build_farm", "build_barracks", "build_workshop", "build_market", "build_tower",
  "military_ratio", "attack_signal", "craft_signal",
];
