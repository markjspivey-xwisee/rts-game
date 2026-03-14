// ═══════════════════════════════════════════════════════════════════════════
//  RESOURCE GENERATION
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, TERRAIN_WATER, TERRAIN_GRASS, TERRAIN_SAND, D, cl, ri } from "./constants.js";

/**
 * Generate map resources placed symmetrically around TC positions.
 */
export function genResources(terrain, tcPositions, state, mapTheme = "default") {
  const res = [];
  const minTcDist = 4;

  const ok = (x, y) => {
    if (terrain[y]?.[x] === TERRAIN_WATER) return false;
    for (const tc of tcPositions) {
      if (D({ x, y }, tc) <= minTcDist) return false;
    }
    return true;
  };

  const maxAmts = { wood: 250, stone: 350, gold: 500, food: 280 };
  const regrow = { wood: 0.02, stone: 0, gold: 0, food: 0.01 };

  const regions = [];

  // Theme multipliers for forest density
  const forestMult = mapTheme === "forest" ? 3 : mapTheme === "desert" ? 0.3 : 1;

  if (tcPositions.length === 2) {
    const pTcX = tcPositions[0].x, pTcY = tcPositions[0].y;
    const eTcX = tcPositions[1].x, eTcY = tcPositions[1].y;

    regions.push(
      { type: "wood", cx: 8, cy: 10, n: Math.round(18 * forestMult) },
      { type: "wood", cx: MW - 10, cy: MH - 10, n: Math.round(16 * forestMult) },
      { type: "wood", cx: 20, cy: MH - 8, n: Math.round(12 * forestMult) },
      { type: "wood", cx: MW - 20, cy: 8, n: Math.round(12 * forestMult) },
      { type: "stone", cx: 18, cy: Math.floor(MH / 2), n: 10 },
      { type: "stone", cx: MW - 18, cy: Math.floor(MH / 2), n: 8 },
      { type: "gold", cx: Math.floor(MW / 2) - 3, cy: 6, n: 6 },
      { type: "gold", cx: Math.floor(MW / 2) + 3, cy: MH - 7, n: 6 },
      { type: "food", cx: 15, cy: pTcY - 5, n: 5 },
      { type: "food", cx: 10, cy: pTcY + 5, n: 5 },
      { type: "food", cx: MW - 15, cy: eTcY - 5, n: 5 },
      { type: "food", cx: MW - 10, cy: eTcY + 5, n: 5 },
    );
  } else {
    const midX = Math.floor(MW / 2);
    const midY = Math.floor(MH / 2);

    for (const tc of tcPositions) {
      regions.push(
        { type: "wood", cx: tc.x + (tc.x < midX ? -6 : 6), cy: tc.y + (tc.y < midY ? -6 : 6), n: Math.round(14 * forestMult) },
        { type: "wood", cx: tc.x + (tc.x < midX ? 8 : -8), cy: tc.y + (tc.y < midY ? 4 : -4), n: Math.round(10 * forestMult) },
      );
      regions.push(
        { type: "stone", cx: tc.x + (tc.x < midX ? 6 : -6), cy: tc.y, n: 7 },
      );
      regions.push(
        { type: "food", cx: tc.x + ri(-3, 3), cy: tc.y - 5, n: 5 },
        { type: "food", cx: tc.x + ri(-3, 3), cy: tc.y + 5, n: 5 },
      );
    }

    regions.push(
      { type: "gold", cx: midX - 3, cy: midY - 3, n: 6 },
      { type: "gold", cx: midX + 3, cy: midY + 3, n: 6 },
    );
  }

  // Scattered random resources
  const woodScatter = Math.round(15 * forestMult);
  for (let i = 0; i < woodScatter; i++)
    regions.push({ type: "wood", cx: ri(3, MW - 4), cy: ri(3, MH - 4), n: ri(3, 7) });
  for (let i = 0; i < 4; i++)
    regions.push({ type: "stone", cx: ri(5, MW - 6), cy: ri(5, MH - 6), n: ri(2, 4) });

  // Desert: extra gold, food near oases
  if (mapTheme === "desert") {
    for (let i = 0; i < 4; i++)
      regions.push({ type: "gold", cx: ri(8, MW - 9), cy: ri(8, MH - 9), n: ri(3, 6) });
  }

  // Island: fish resources (food near water)
  if (mapTheme === "island") {
    for (const tc of tcPositions) {
      regions.push({ type: "food", cx: tc.x + ri(-8, 8), cy: tc.y + ri(-8, 8), n: 8 });
    }
  }

  // Place resources
  for (const reg of regions) {
    for (let j = 0; j < reg.n; j++) {
      const rx = cl(reg.cx + ri(-3, 3), 1, MW - 2);
      const ry = cl(reg.cy + ri(-2, 2), 1, MH - 2);
      if (ok(rx, ry)) {
        res.push({
          id: state.nextUid++,
          type: reg.type,
          x: rx, y: ry,
          amount: ri(80, maxAmts[reg.type]),
          maxAmt: maxAmts[reg.type],
          rg: regrow[reg.type],
        });
      }
    }
  }

  return res;
}

/**
 * Generate wild horse herds on the map.
 */
export function genHorses(terrain, tcPositions, state) {
  const horses = [];
  const minTcDist = 8;
  const herdCount = ri(3, 5);
  for (let h = 0; h < herdCount; h++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const cx = ri(4, MW - 5);
      const cy = ri(4, MH - 5);
      if (terrain[cy]?.[cx] !== TERRAIN_GRASS && terrain[cy]?.[cx] !== undefined) continue;
      if (terrain[cy]?.[cx] === TERRAIN_WATER) continue;

      let tooClose = false;
      for (const tc of tcPositions) {
        if (D({ x: cx, y: cy }, tc) < minTcDist) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const count = ri(1, 3);
      for (let i = 0; i < count; i++) {
        const hx = cl(cx + ri(-2, 2), 1, MW - 2);
        const hy = cl(cy + ri(-2, 2), 1, MH - 2);
        if (terrain[hy]?.[hx] === TERRAIN_WATER) continue;
        horses.push({
          id: state.nextUid++,
          x: hx, y: hy,
          hp: 20, maxHp: 20,
          alive: true, tamed: false,
          riderId: null, owner: null,
          wanderCd: ri(0, 20),
        });
      }
      break;
    }
  }
  return horses;
}

/**
 * Generate relics on the map.
 * Relics are neutral map objectives that generate gold when housed in a Temple.
 */
export function genRelics(terrain, tcPositions, state) {
  const relics = [];
  const count = Math.min(5, tcPositions.length + 1);
  const midX = Math.floor(MW / 2), midY = Math.floor(MH / 2);

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      // Place relics in contested areas (center-ish)
      const rx = ri(Math.floor(MW * 0.2), Math.floor(MW * 0.8));
      const ry = ri(Math.floor(MH * 0.2), Math.floor(MH * 0.8));
      if (terrain[ry]?.[rx] === TERRAIN_WATER) continue;

      let tooClose = false;
      for (const tc of tcPositions) {
        if (D({ x: rx, y: ry }, tc) < 8) { tooClose = true; break; }
      }
      // Check distance from other relics
      for (const r of relics) {
        if (D({ x: rx, y: ry }, r) < 6) { tooClose = true; break; }
      }
      if (tooClose) continue;

      relics.push({
        id: state.nextUid++,
        x: rx, y: ry,
        carrierId: null,  // unit carrying it
        owner: null,      // player who houses it
        housed: false,     // true when in a temple
        goldRate: 0.15,    // gold per tick when housed
      });
      break;
    }
  }
  return relics;
}
