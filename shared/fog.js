// ═══════════════════════════════════════════════════════════════════════════
//  FOG OF WAR
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, FOG_VIS, FOG_SEEN, VIS, TVIS, TERRAIN_HILL } from "./constants.js";

/**
 * Create a new fog grid (MH x MW Uint8Array).
 * @returns {Uint8Array[]}
 */
export function mkFog() {
  return Array.from({ length: MH }, () => new Uint8Array(MW));
}

/**
 * Update fog of war for a single player.
 * @param {Uint8Array[]} fog - the player's fog grid
 * @param {import('./types.js').Unit[]} units - that player's alive units
 * @param {import('./types.js').Building[]} buildings - that player's built buildings
 * @param {import('./types.js').TownCenter} tc - that player's town center
 * @param {Uint8Array[]} terrain - the map terrain (for hill bonus)
 */
export function updFog(fog, units, buildings, tc, terrain) {
  // Reset visible to seen
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      if (fog[y][x] === FOG_VIS) fog[y][x] = FOG_SEEN;

  const reveal = (cx, cy, r) => {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const fx = cx + dx, fy = cy + dy;
        if (fx >= 0 && fx < MW && fy >= 0 && fy < MH) fog[fy][fx] = FOG_VIS;
      }
  };

  // Reveal around alive units (with hill bonus)
  for (const v of units) {
    if (!v.alive) continue;
    const hillBonus = terrain[v.y]?.[v.x] === TERRAIN_HILL ? 2 : 0;
    reveal(v.x, v.y, VIS + hillBonus);
  }

  // Reveal around TC
  if (tc && tc.hp > 0) {
    reveal(tc.x, tc.y, VIS + 1);
  }

  // Reveal around built buildings
  for (const b of buildings) {
    if (b.built) reveal(b.x, b.y, b.type === "tower" ? TVIS : 4);
  }
}
