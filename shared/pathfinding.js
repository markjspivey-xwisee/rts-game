// ═══════════════════════════════════════════════════════════════════════════
//  A* PATHFINDING (terrain-aware, wall/gate support)
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, TERRAIN_WATER, TERRAIN_SAND, cl } from "./constants.js";
import { BLD } from "./buildings.js";

/**
 * Build a collision grid from the current game state.
 * Marks water, walls, and all players' buildings as blocked.
 * Gates are passable to allies, blocked to enemies.
 * @param {import('./types.js').GameState} state
 * @param {string} [forPlayerId] - player id for gate passability
 * @returns {Uint8Array[]}
 */
export function buildGrid(state, forPlayerId) {
  const g = Array.from({ length: MH }, () => new Uint8Array(MW));

  // Water blocks
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      if (state.terrain[y][x] === TERRAIN_WATER) g[y][x] = 1;

  // Mark buildings as blocked (walls block, gates are conditional)
  for (const player of state.players) {
    if (player.eliminated) continue;
    for (const b of player.buildings) {
      if (!b.built) continue;
      const bd = BLD[b.type];
      if (!bd) continue;

      // Gates are passable for allies
      if (bd.isGate) {
        if (forPlayerId && forPlayerId !== player.id) {
          // Check diplomacy
          const diplo = state.diplomacy?.[player.id]?.[forPlayerId];
          if (diplo !== 2) { // not ally
            g[b.y][b.x] = 1;
          }
        }
        continue;
      }

      const sz = bd.size || 1;
      for (let dy = 0; dy < sz; dy++)
        for (let dx = 0; dx < sz; dx++) {
          const bx = b.x + dx, by = b.y + dy;
          if (bx >= 0 && bx < MW && by >= 0 && by < MH) g[by][bx] = 1;
        }
    }
  }

  return g;
}

/**
 * Build a water-only grid for naval pathfinding.
 * Only water and bridge tiles are passable.
 */
export function buildWaterGrid(state) {
  const g = Array.from({ length: MH }, () => new Uint8Array(MW));
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      if (state.terrain[y][x] !== TERRAIN_WATER) g[y][x] = 1;
  return g;
}

/**
 * A* pathfinding. Returns the first step {x,y} toward the target, or null.
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
      // Sand terrain costs extra movement
      const moveCost = 1;
      const ng = c.g + moveCost;
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
