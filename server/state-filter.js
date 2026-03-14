// ═══════════════════════════════════════════════════════════════════════════
//  STATE FILTER - Build per-player fog-of-war views
// ═══════════════════════════════════════════════════════════════════════════

import { FOG_UNK, FOG_SEEN, FOG_VIS, DIPLO } from "../shared/index.js";
import { getTech } from "../shared/index.js";

/**
 * Build a PlayerView for the given player from the full game state.
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
        resources.push({ ...r });
      } else if (fog[r.y][r.x] === FOG_SEEN) {
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

    if (other.units) {
      for (const u of other.units) {
        if (fog && fog[u.y] && fog[u.y][u.x] === FOG_VIS) {
          visibleEnemyUnits.push({
            id: u.id, owner: other.id,
            x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp,
            type: u.type, spec: u.spec, promotion: u.promotion,
          });
        }
      }
    }

    if (other.buildings) {
      for (const b of other.buildings) {
        if (fog && fog[b.y] && fog[b.y][b.x] === FOG_VIS) {
          visibleEnemyBuildings.push({
            id: b.id, owner: other.id,
            x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp,
            type: b.type, built: b.built,
          });
        }
      }
    }

    if (other.tc) {
      const tc = other.tc;
      if (fog && fog[tc.y] && fog[tc.y][tc.x] >= FOG_SEEN) {
        const tcView = {
          id: tc.id, owner: other.id,
          x: tc.x, y: tc.y, type: tc.type,
        };
        if (fog[tc.y][tc.x] === FOG_VIS) {
          tcView.hp = tc.hp;
          tcView.maxHp = tc.maxHp;
        }
        visibleTownCenters.push(tcView);
      }
    }
  }

  // --- My vehicles ---
  const myVehicles = (player.vehicles || []).map(v => ({ ...v }));

  // --- My naval units ---
  const myNavalUnits = (player.navalUnits || []).map(n => ({ ...n }));

  // --- Visible horses ---
  const visibleHorses = [];
  for (const h of (state.horses || [])) {
    if (!h.alive) continue;
    if (fog && fog[h.y] && fog[h.y][h.x] >= FOG_SEEN) {
      visibleHorses.push({ ...h });
    }
  }

  // --- Visible relics ---
  const visibleRelics = [];
  for (const r of (state.relics || [])) {
    if (fog && fog[r.y] && fog[r.y][r.x] >= FOG_SEEN) {
      visibleRelics.push({ ...r });
    }
  }

  // --- Visible enemy vehicles ---
  const visibleEnemyVehicles = [];
  for (const other of state.players) {
    if (other.id === playerId || other.eliminated) continue;
    for (const v of (other.vehicles || [])) {
      if (v.alive && fog && fog[v.y] && fog[v.y][v.x] === FOG_VIS) {
        visibleEnemyVehicles.push({
          id: v.id, type: v.type, x: v.x, y: v.y,
          hp: v.hp, maxHp: v.maxHp, crewId: v.crewId,
          owner: other.id,
        });
      }
    }
  }

  // --- Visible enemy naval units ---
  const visibleEnemyNaval = [];
  for (const other of state.players) {
    if (other.id === playerId || other.eliminated) continue;
    for (const n of (other.navalUnits || [])) {
      if (n.alive && fog && fog[n.y] && fog[n.y][n.x] === FOG_VIS) {
        visibleEnemyNaval.push({
          id: n.id, type: n.type, x: n.x, y: n.y,
          hp: n.hp, maxHp: n.maxHp, owner: other.id,
        });
      }
    }
  }

  // --- Neutral enemies ---
  const neutralEnemies = [];
  if (state.enemies) {
    for (const e of state.enemies) {
      if (fog && fog[e.y] && fog[e.y][e.x] === FOG_VIS) {
        neutralEnemies.push({
          id: e.id, x: e.x, y: e.y,
          hp: e.hp, maxHp: e.maxHp, type: e.type,
        });
      }
    }
  }

  // --- Log ---
  const fullLog = player.log || state.log || [];
  const log = fullLog.slice(-50);

  // --- Public player info ---
  const players = state.players.map(p => ({
    id: p.id, name: p.name, type: p.type, color: p.color,
    eliminated: p.eliminated ?? false,
    age: p.age || "dark",
    relicCount: p.relicCount || 0,
  }));

  // --- Diplomacy (from my perspective) ---
  const diplomacy = {};
  if (state.diplomacy?.[playerId]) {
    for (const [pid, status] of Object.entries(state.diplomacy[playerId])) {
      diplomacy[pid] = status;
    }
  }

  // Convert arrays for JSON serialization
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
    mapTheme: state.mapTheme || "default",
    terrain: terrainArrays,
    fog: fogArrays,
    particles: state.particles || [],
    myUnits,
    myBuildings,
    myVehicles,
    myNavalUnits,
    myStockpile,
    myTc,
    myTech,
    myPopCap,
    myAge: player.age || "dark",
    myAgeProgress: player.ageProgress || null,
    myRelicCount: player.relicCount || 0,
    resources,
    visibleHorses,
    visibleRelics,
    visibleEnemyUnits,
    visibleEnemyBuildings,
    visibleEnemyVehicles,
    visibleEnemyNaval,
    visibleTownCenters,
    neutralEnemies,
    log,
    gameOver: state.gameOver ?? false,
    winner: state.winner ?? null,
    stats: player.stats || {},
    players,
    diplomacy,
    stkDelta: player.stkDelta || { wood: 0, stone: 0, gold: 0, food: 0 },
  };
}
