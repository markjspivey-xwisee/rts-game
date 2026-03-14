// ═══════════════════════════════════════════════════════════════════════════
//  TERRAIN GENERATION (theme-aware)
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_BRIDGE, TERRAIN_HILL, TERRAIN_SAND, MAP_THEMES, ri, cl } from "./constants.js";

/**
 * Generate the terrain grid.
 * @param {{x:number, y:number}[]} tcPositions
 * @param {string} [theme="default"]
 * @returns {Uint8Array[]}
 */
export function genTerrain(tcPositions, theme = "default") {
  const grid = Array.from({ length: MH }, () => new Uint8Array(MW));
  const cfg = MAP_THEMES[theme] || MAP_THEMES.default;

  if (theme === "island") {
    genIslandTerrain(grid, tcPositions, cfg);
  } else if (theme === "desert") {
    genDesertTerrain(grid, tcPositions, cfg);
  } else if (theme === "arena") {
    genArenaTerrain(grid, tcPositions, cfg);
  } else if (theme === "forest") {
    genForestTerrain(grid, tcPositions, cfg);
  } else {
    genDefaultTerrain(grid, tcPositions, cfg);
  }

  // Clear areas around each TC position (always)
  const clearAround = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < MW && y >= 0 && y < MH) grid[y][x] = TERRAIN_GRASS;
      }
  };
  for (const pos of tcPositions) clearAround(pos.x, pos.y, 4);

  return grid;
}

function genDefaultTerrain(grid, tcPositions, cfg) {
  // River
  let rx = ri(Math.floor(MW * 0.3), Math.floor(MW * 0.5));
  for (let y = 0; y < MH; y++) {
    rx += ri(-2, 2);
    rx = cl(rx, 4, MW - 5);
    for (let dx = -1; dx <= 1; dx++) {
      const wx = rx + dx;
      if (wx >= 0 && wx < MW) grid[y][wx] = TERRAIN_WATER;
    }
  }

  // Fords
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

  // Hills
  for (let i = 0; i < cfg.hills; i++) {
    const cx = ri(4, MW - 5), cy = ri(4, MH - 5);
    for (let j = 0; j < ri(3, 8); j++) {
      const hx = cl(cx + ri(-2, 2), 0, MW - 1), hy = cl(cy + ri(-1, 1), 0, MH - 1);
      if (grid[hy][hx] === TERRAIN_GRASS) grid[hy][hx] = TERRAIN_HILL;
    }
  }
}

function genIslandTerrain(grid, tcPositions, cfg) {
  // Fill with water
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      grid[y][x] = TERRAIN_WATER;

  // Create islands around each TC
  for (const tc of tcPositions) {
    const r = ri(8, 12);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r - ri(0, 2)) {
          const x = tc.x + dx, y = tc.y + dy;
          if (x >= 0 && x < MW && y >= 0 && y < MH) grid[y][x] = TERRAIN_GRASS;
        }
      }
  }

  // Central landmass
  const cx = Math.floor(MW / 2), cy = Math.floor(MH / 2);
  const cr = ri(5, 8);
  for (let dy = -cr; dy <= cr; dy++)
    for (let dx = -cr; dx <= cr; dx++) {
      if (Math.sqrt(dx * dx + dy * dy) < cr - ri(0, 2)) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < MW && y >= 0 && y < MH) grid[y][x] = TERRAIN_GRASS;
      }
    }

  // Hills on islands
  for (let i = 0; i < cfg.hills; i++) {
    const tc = tcPositions[ri(0, tcPositions.length - 1)];
    const hx = cl(tc.x + ri(-5, 5), 0, MW - 1);
    const hy = cl(tc.y + ri(-5, 5), 0, MH - 1);
    if (grid[hy][hx] === TERRAIN_GRASS) grid[hy][hx] = TERRAIN_HILL;
  }

  // Shallow strait bridges between islands
  for (let i = 0; i < tcPositions.length; i++) {
    const from = tcPositions[i];
    const to = i === tcPositions.length - 1 ? { x: cx, y: cy } : tcPositions[i + 1];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let t = 0; t <= steps; t++) {
      const px = Math.round(from.x + (to.x - from.x) * t / steps);
      const py = Math.round(from.y + (to.y - from.y) * t / steps);
      if (px >= 0 && px < MW && py >= 0 && py < MH && grid[py][px] === TERRAIN_WATER)
        grid[py][px] = TERRAIN_BRIDGE;
    }
  }
}

function genDesertTerrain(grid, tcPositions, cfg) {
  // Fill with sand
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      grid[y][x] = TERRAIN_SAND;

  // Oases
  for (let i = 0; i < 4; i++) {
    const ox = ri(8, MW - 9), oy = ri(8, MH - 9);
    const or2 = ri(2, 4);
    for (let dy = -or2; dy <= or2; dy++)
      for (let dx = -or2; dx <= or2; dx++) {
        if (Math.sqrt(dx * dx + dy * dy) <= or2) {
          const x = ox + dx, y = oy + dy;
          if (x >= 0 && x < MW && y >= 0 && y < MH) grid[y][x] = TERRAIN_WATER;
        }
      }
    // Grass ring
    for (let dy = -or2 - 1; dy <= or2 + 1; dy++)
      for (let dx = -or2 - 1; dx <= or2 + 1; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > or2 && dist <= or2 + 1.5) {
          const x = ox + dx, y = oy + dy;
          if (x >= 0 && x < MW && y >= 0 && y < MH && grid[y][x] === TERRAIN_SAND) grid[y][x] = TERRAIN_GRASS;
        }
      }
  }

  // Hill dunes
  for (let i = 0; i < cfg.hills; i++) {
    const cx = ri(4, MW - 5), cy = ri(4, MH - 5);
    for (let j = 0; j < ri(4, 10); j++) {
      const hx = cl(cx + ri(-3, 3), 0, MW - 1), hy = cl(cy + ri(-1, 1), 0, MH - 1);
      if (grid[hy][hx] === TERRAIN_SAND) grid[hy][hx] = TERRAIN_HILL;
    }
  }
}

function genArenaTerrain(grid, tcPositions, cfg) {
  // All grass with a few hills
  for (let i = 0; i < cfg.hills; i++) {
    const cx = ri(6, MW - 7), cy = ri(6, MH - 7);
    for (let j = 0; j < ri(2, 5); j++) {
      const hx = cl(cx + ri(-2, 2), 0, MW - 1), hy = cl(cy + ri(-1, 1), 0, MH - 1);
      grid[hy][hx] = TERRAIN_HILL;
    }
  }
}

function genForestTerrain(grid, tcPositions, cfg) {
  // Narrow river
  let rx = ri(Math.floor(MW * 0.3), Math.floor(MW * 0.5));
  for (let y = 0; y < MH; y++) {
    rx += ri(-2, 2);
    rx = cl(rx, 4, MW - 5);
    if (rx >= 0 && rx < MW) grid[y][rx] = TERRAIN_WATER;
  }
  // Ford
  const fy = ri(Math.floor(MH * 0.3), Math.floor(MH * 0.7));
  for (let x = 0; x < MW; x++)
    if (grid[fy]?.[x] === TERRAIN_WATER) grid[fy][x] = TERRAIN_BRIDGE;

  // Hills
  for (let i = 0; i < cfg.hills; i++) {
    const cx = ri(4, MW - 5), cy = ri(4, MH - 5);
    for (let j = 0; j < ri(3, 6); j++) {
      const hx = cl(cx + ri(-2, 2), 0, MW - 1), hy = cl(cy + ri(-1, 1), 0, MH - 1);
      if (grid[hy][hx] === TERRAIN_GRASS) grid[hy][hx] = TERRAIN_HILL;
    }
  }
}
