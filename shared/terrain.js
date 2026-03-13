// ═══════════════════════════════════════════════════════════════════════════
//  TERRAIN GENERATION
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_HILL, ri, cl } from "./constants.js";

/**
 * Generate the terrain grid.
 * @param {{x:number, y:number}[]} tcPositions - array of TC positions for 2-4 players
 * @returns {Uint8Array[]}
 */
export function genTerrain(tcPositions) {
  const grid = Array.from({ length: MH }, () => new Uint8Array(MW));

  // River snaking across map
  let rx = ri(Math.floor(MW * 0.3), Math.floor(MW * 0.5));
  for (let y = 0; y < MH; y++) {
    rx += ri(-2, 2);
    rx = cl(rx, 4, MW - 5);
    for (let dx = -1; dx <= 1; dx++) {
      const wx = rx + dx;
      if (wx >= 0 && wx < MW) grid[y][wx] = TERRAIN_WATER;
    }
  }

  // Natural ford crossings (2-3)
  const fords = [
    ri(4, Math.floor(MH * 0.3)),
    ri(Math.floor(MH * 0.4), Math.floor(MH * 0.7)),
    ri(Math.floor(MH * 0.75), MH - 4),
  ];
  for (const fy of fords) {
    for (let y = fy - 1; y <= fy + 1; y++)
      for (let x = 0; x < MW; x++)
        if (y >= 0 && y < MH && grid[y][x] === TERRAIN_WATER)
          grid[y][x] = TERRAIN_BRIDGE;
  }

  // Hill clusters
  for (let i = 0; i < 8; i++) {
    const cx = ri(4, MW - 5), cy = ri(4, MH - 5);
    for (let j = 0; j < ri(3, 8); j++) {
      const hx = cl(cx + ri(-2, 2), 0, MW - 1), hy = cl(cy + ri(-1, 1), 0, MH - 1);
      if (grid[hy][hx] === TERRAIN_GRASS) grid[hy][hx] = TERRAIN_HILL;
    }
  }

  // Clear areas around each TC position
  const clearAround = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < MW && y >= 0 && y < MH) grid[y][x] = TERRAIN_GRASS;
      }
  };

  for (const pos of tcPositions) {
    clearAround(pos.x, pos.y, 4);
  }

  return grid;
}
