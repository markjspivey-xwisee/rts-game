// ═══════════════════════════════════════════════════════════════════════════
//  GAME STATE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, PLAYER_COLORS, ri } from "./constants.js";
import { genTerrain } from "./terrain.js";
import { genResources, genHorses } from "./resources.js";
import { mkVillager } from "./units.js";
import { mkFog } from "./fog.js";

/**
 * TC positions based on player count.
 * @param {number} playerCount
 * @returns {{x:number, y:number}[]}
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
 * Initialize a new game.
 * @param {import('./types.js').GameConfig} config
 * @returns {import('./types.js').GameState}
 */
export function initGame(config) {
  const {
    playerCount = 2,
    playerNames = [],
    playerTypes = [],
    players: playerDefs = null,
    enablePvE = false,
  } = config;

  const count = Math.max(2, Math.min(4, playerCount));
  const tcPositions = getTcPositions(count);

  /** @type {{ nextUid: number }} */
  const uidState = { nextUid: 1 };

  // Generate terrain with all TC positions
  const terrain = genTerrain(tcPositions);

  // Generate resources and horses
  const resources = genResources(terrain, tcPositions, uidState);
  const horses = genHorses(terrain, tcPositions, uidState);

  // Create players
  /** @type {import('./types.js').Player[]} */
  const players = [];

  for (let i = 0; i < count; i++) {
    // Support both { players: [{id, name, type, color}] } and { playerNames, playerTypes } formats
    const def = playerDefs?.[i];
    const id = def?.id || `p${i + 1}`;
    const name = def?.name || playerNames[i] || `Player ${i + 1}`;
    const type = def?.type || playerTypes[i] || (i === 0 ? "human" : "bot");
    const color = def?.color || PLAYER_COLORS[i] || PLAYER_COLORS[0];
    const tcPos = tcPositions[i];

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
      stockpile: { wood: 120, stone: 30, gold: 0, food: 100 },
      fog: mkFog(),
      popCap: 4,
      memory: {},
      stats: {
        kills: 0,
        deaths: 0,
        gathered: { wood: 0, stone: 0, gold: 0, food: 0 },
        built: 0,
        maxPop: 4,
        wavesEndured: 0,
        specLevels: {},
      },
      eliminated: false,
      spawnPos: { x: tcPos.x, y: tcPos.y },
      buildQueue: [],
    });
  }

  return {
    tick: 0,
    mapWidth: MW,
    mapHeight: MH,
    terrain,
    resources,
    horses,
    players,
    enemies: [],
    log: ["☀ Dawn breaks. Destroy all enemy Town Centers to win!"],
    particles: [],
    gameOver: false,
    winner: null,
    paused: false,
    nextUid: uidState.nextUid,
    enablePvE,
  };
}
