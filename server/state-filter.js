// ═══════════════════════════════════════════════════════════════════════════
//  STATE FILTER - Build per-player fog-of-war views
// ═══════════════════════════════════════════════════════════════════════════

import { FOG_UNK, FOG_SEEN, FOG_VIS } from "../shared/index.js";
import { getTech } from "../shared/index.js";

/**
 * Build a PlayerView for the given player from the full game state.
 * Only reveals information the player should see based on fog of war.
 *
 * @param {import("../shared/index.js").GameState} state
 * @param {string} playerId - e.g. "p1", "p2", etc.
 * @returns {import("../shared/index.js").PlayerView}
 */
export function getPlayerView(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return null;

  const fog = player.fog;

  // --- My own stuff (full detail) ---
  const myUnits = player.units || [];
  const myBuildings = player.buildings || [];
  const myStockpile = player.stockpile || { wood: 0, food: 0, gold: 0, stone: 0 };
  const myTc = player.tc || null;
  const myTechSet = getTech ? getTech(player.buildings) : new Set();
  const myTech = [...myTechSet];
  const myPopCap = player.popCap ?? 10;

  // --- Resources visible through fog ---
  const resources = [];
  if (state.resources) {
    for (const r of state.resources) {
      if (!fog || !fog[r.y] || fog[r.y][r.x] === FOG_UNK) continue;
      if (fog[r.y][r.x] === FOG_VIS) {
        // Full detail when visible
        resources.push({ ...r });
      } else if (fog[r.y][r.x] === FOG_SEEN) {
        // Position + type only when previously seen
        resources.push({ x: r.x, y: r.y, type: r.type, id: r.id });
      }
    }
  }

  // --- Visible enemy units ---
  const visibleEnemyUnits = [];
  const visibleEnemyBuildings = [];
  const visibleTownCenters = [];

  for (const other of state.players) {
    if (other.id === playerId) continue;

    // Enemy units
    if (other.units) {
      for (const u of other.units) {
        if (fog && fog[u.y] && fog[u.y][u.x] === FOG_VIS) {
          visibleEnemyUnits.push({
            id: u.id,
            owner: other.id,
            x: u.x,
            y: u.y,
            hp: u.hp,
            maxHp: u.maxHp,
            type: u.type,
            spec: u.spec,
          });
        }
      }
    }

    // Enemy buildings
    if (other.buildings) {
      for (const b of other.buildings) {
        if (fog && fog[b.y] && fog[b.y][b.x] === FOG_VIS) {
          visibleEnemyBuildings.push({
            id: b.id,
            owner: other.id,
            x: b.x,
            y: b.y,
            hp: b.hp,
            maxHp: b.maxHp,
            type: b.type,
            built: b.built,
          });
        }
      }
    }

    // Enemy town centers
    if (other.tc) {
      const tc = other.tc;
      if (fog && fog[tc.y] && fog[tc.y][tc.x] >= FOG_SEEN) {
        const tcView = {
          id: tc.id,
          owner: other.id,
          x: tc.x,
          y: tc.y,
          type: tc.type,
        };
        if (fog[tc.y][tc.x] === FOG_VIS) {
          tcView.hp = tc.hp;
          tcView.maxHp = tc.maxHp;
        }
        visibleTownCenters.push(tcView);
      }
    }
  }

  // --- Neutral / PvE enemies (stored in state.enemies) ---
  const neutralEnemies = [];
  if (state.enemies) {
    for (const e of state.enemies) {
      if (fog && fog[e.y] && fog[e.y][e.x] === FOG_VIS) {
        neutralEnemies.push({
          id: e.id,
          x: e.x,
          y: e.y,
          hp: e.hp,
          maxHp: e.maxHp,
          type: e.type,
        });
      }
    }
  }

  // --- Log (last 50 entries) ---
  const fullLog = player.log || state.log || [];
  const log = fullLog.slice(-50);

  // --- Public player info ---
  const players = state.players.map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    color: p.color,
    eliminated: p.eliminated ?? false,
  }));

  // Convert Uint8Array rows to regular arrays for JSON serialization
  const terrainArrays = state.terrain ? state.terrain.map(row =>
    row instanceof Uint8Array ? Array.from(row) : row
  ) : [];
  const fogArrays = fog ? fog.map(row =>
    row instanceof Uint8Array ? Array.from(row) : row
  ) : [];

  return {
    tick: state.tick,
    myId: playerId,
    mapWidth: state.mapWidth,
    mapHeight: state.mapHeight,
    terrain: terrainArrays,
    fog: fogArrays,
    particles: state.particles || [],
    myUnits,
    myBuildings,
    myStockpile,
    myTc,
    myTech,
    myPopCap,
    resources,
    visibleEnemyUnits,
    visibleEnemyBuildings,
    visibleTownCenters,
    neutralEnemies,
    log,
    gameOver: state.gameOver ?? false,
    winner: state.winner ?? null,
    stats: player.stats || {},
    players,
    stkDelta: player.stkDelta || { wood: 0, stone: 0, gold: 0, food: 0 },
  };
}
