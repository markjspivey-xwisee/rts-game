// ═══════════════════════════════════════════════════════════════════════════
//  GAME STATE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, PLAYER_COLORS, ri, DIPLO, AGE_ORDER } from "./constants.js";
import { genTerrain } from "./terrain.js";
import { genResources, genHorses, genRelics } from "./resources.js";
import { mkVillager } from "./units.js";
import { mkFog } from "./fog.js";

/**
 * TC positions based on player count.
 */
export function getTcPositions(playerCount) {
  switch (playerCount) {
    case 2:
      return [{ x: 12, y: 22 }, { x: 51, y: 22 }];
    case 3:
      return [{ x: 12, y: 12 }, { x: 51, y: 12 }, { x: 32, y: 36 }];
    case 4:
      return [{ x: 10, y: 10 }, { x: 53, y: 10 }, { x: 10, y: 33 }, { x: 53, y: 33 }];
    default:
      return [{ x: 12, y: 22 }, { x: 51, y: 22 }];
  }
}

/**
 * Initialize diplomacy matrix. Default: all enemies.
 */
function initDiplomacy(playerIds) {
  const d = {};
  for (const a of playerIds) {
    d[a] = {};
    for (const b of playerIds) {
      d[a][b] = a === b ? DIPLO.ally : DIPLO.enemy;
    }
  }
  return d;
}

/**
 * Initialize a new game.
 */
export function initGame(config) {
  const {
    playerCount = 2,
    playerNames = [],
    playerTypes = [],
    players: playerDefs = null,
    enablePvE = false,
    mapTheme = "default",
  } = config;

  const count = Math.max(2, Math.min(4, playerCount));
  const tcPositions = getTcPositions(count);

  const uidState = { nextUid: 1 };

  // Generate terrain with theme
  const terrain = genTerrain(tcPositions, mapTheme);

  // Generate resources, horses, and relics
  const resources = genResources(terrain, tcPositions, uidState, mapTheme);
  const horses = genHorses(terrain, tcPositions, uidState);
  const relics = genRelics(terrain, tcPositions, uidState);

  // Create players
  const players = [];
  const playerIds = [];

  for (let i = 0; i < count; i++) {
    const def = playerDefs?.[i];
    const id = def?.id || `p${i + 1}`;
    const name = def?.name || playerNames[i] || `Player ${i + 1}`;
    const type = def?.type || playerTypes[i] || (i === 0 ? "human" : "bot");
    const color = def?.color || PLAYER_COLORS[i] || PLAYER_COLORS[0];
    const tcPos = tcPositions[i];
    playerIds.push(id);

    // Create 4 starting villagers
    const units = [];
    for (let j = 0; j < 4; j++) {
      const v = mkVillager(tcPos.x + ri(-2, 2), tcPos.y + ri(-2, 2), id, uidState);
      if (type === "bot") v.enemy = true;
      units.push(v);
    }

    players.push({
      id,
      name,
      type,
      color,
      tc: { x: tcPos.x, y: tcPos.y, hp: 500, maxHp: 500 },
      units,
      buildings: [],
      vehicles: [],
      navalUnits: [],
      stockpile: { wood: 120, stone: 30, gold: 0, food: 100 },
      fog: mkFog(),
      popCap: 4,
      memory: {},
      age: "dark",
      ageProgress: null, // { targetAge, progress, needed } when advancing
      stats: {
        kills: 0,
        deaths: 0,
        gathered: { wood: 0, stone: 0, gold: 0, food: 0 },
        built: 0,
        maxPop: 4,
        wavesEndured: 0,
        specLevels: {},
        promotions: {},
      },
      eliminated: false,
      spawnPos: { x: tcPos.x, y: tcPos.y },
      buildQueue: [],
      relicCount: 0,
    });
  }

  return {
    tick: 0,
    mapWidth: MW,
    mapHeight: MH,
    terrain,
    resources,
    horses,
    relics,
    players,
    enemies: [],
    log: ["☀ Dawn breaks. Destroy all enemy Town Centers to win!"],
    particles: [],
    gameOver: false,
    winner: null,
    paused: false,
    nextUid: uidState.nextUid,
    enablePvE,
    mapTheme,
    diplomacy: initDiplomacy(playerIds),
  };
}
