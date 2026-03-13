// ═══════════════════════════════════════════════════════════════════════════
//  A* PATHFINDING (terrain-aware)
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, TERRAIN_WATER, cl } from "./constants.js";
import { BLD } from "./buildings.js";

/**
 * Build a collision grid from the current game state.
 * Marks water and all players' TCs + built buildings as blocked.
 * @param {import('./types.js').GameState} state
 * @returns {Uint8Array[]}
 */
export function buildGrid(state) {
  const g = Array.from({ length: MH }, () => new Uint8Array(MW));

  // Water blocks
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      if (state.terrain[y][x] === TERRAIN_WATER) g[y][x] = 1;

  // Mark a TC as blocked (3x3)
  const markTC = (tc) => {
    if (!tc) return;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const bx = tc.x + dx, by = tc.y + dy;
        if (bx >= 0 && bx < MW && by >= 0 && by < MH) g[by][bx] = 1;
      }
  };

  // Mark buildings as blocked
  const markBuildings = (blds) => {
    for (const b of blds) {
      if (!b.built) continue;
      const sz = BLD[b.type]?.size || 1;
      for (let dy = 0; dy < sz; dy++)
        for (let dx = 0; dx < sz; dx++) {
          const bx = b.x + dx, by = b.y + dy;
          if (bx >= 0 && bx < MW && by >= 0 && by < MH) g[by][bx] = 1;
        }
    }
  };

  // Iterate all players' buildings (TCs are walkable so units can move near them)
  for (const player of state.players) {
    if (player.eliminated) continue;
    markBuildings(player.buildings);
  }

  return g;
}

/**
 * A* pathfinding. Returns the first step {x,y} toward the target, or null.
 * @param {number} sx - start x
 * @param {number} sy - start y
 * @param {number} ex - end x
 * @param {number} ey - end y
 * @param {Uint8Array[]} grid - collision grid
 * @param {number} [maxS=180] - max steps
 * @returns {{x:number, y:number}|null}
 */
export function astar(sx, sy, ex, ey, grid, maxS = 180) {
  if (sx === ex && sy === ey) return null;
  ex = cl(ex, 0, MW - 1); ey = cl(ey, 0, MH - 1);
  sx = cl(sx, 0, MW - 1); sy = cl(sy, 0, MH - 1);
  const K = (x, y) => y * MW + x;
  const open = [{ x: sx, y: sy, g: 0, f: Math.abs(ex - sx) + Math.abs(ey - sy) }];
  const closed = new Set(), from = new Map(), gs = new Map();
  gs.set(K(sx, sy), 0);
  let steps = 0;
  while (open.length > 0 && steps++ < maxS) {
    open.sort((a, b) => a.f - b.f);
    const c = open.shift(), ck = K(c.x, c.y);
    if (c.x === ex && c.y === ey) {
      let px = ex, py = ey;
      while (from.has(K(px, py))) {
        const p = from.get(K(px, py));
        if (p.x === sx && p.y === sy) return { x: px, y: py };
        px = p.x; py = p.y;
      }
      return { x: px, y: py };
    }
    closed.add(ck);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || nx >= MW || ny < 0 || ny >= MH) continue;
      const nk = K(nx, ny);
      if (closed.has(nk)) continue;
      if (grid[ny][nx] && !(nx === ex && ny === ey)) continue;
      const ng = c.g + 1;
      if (!gs.has(nk) || ng < gs.get(nk)) {
        gs.set(nk, ng); from.set(nk, { x: c.x, y: c.y });
        open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(ex - nx) + Math.abs(ey - ny) });
      }
    }
  }
  const dx = Math.sign(ex - sx), dy = Math.sign(ey - sy);
  if (dx !== 0 && !grid[sy]?.[sx + dx]) return { x: sx + dx, y: sy };
  if (dy !== 0 && !grid[sy + dy]?.[sx]) return { x: sx, y: sy + dy };
  return null;
}
