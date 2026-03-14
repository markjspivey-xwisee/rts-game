// ═══════════════════════════════════════════════════════════════════════════
//  LOBBY - Manages all active game rooms
// ═══════════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from "uuid";
import { GameRoom } from "./game-room.js";

export class Lobby {
  constructor() {
    /** @type {Map<string, GameRoom>} */
    this.games = new Map();
  }

  /**
   * Create a new game room.
   * @param {object} config - { playerCount: 2-4, enablePvE: boolean }
   * @param {string} hostName - Display name of the host
   * @param {string} [hostType="human"] - "human" or "api"
   * @returns {{ gameId: string, playerId: string, token: string }}
   */
  createGame(config, hostName, hostType = "human") {
    const playerCount = Math.max(2, Math.min(4, config.playerCount || 2));
    const validThemes = ["default", "desert", "island", "forest", "arena"];
    const mapTheme = validThemes.includes(config.mapTheme) ? config.mapTheme : "default";
    const normalizedConfig = {
      playerCount,
      enablePvE: !!config.enablePvE,
      mapTheme,
    };

    const gameId = uuidv4();
    const room = new GameRoom(gameId, normalizedConfig);
    this.games.set(gameId, room);

    const { playerId, token } = room.addPlayer(hostName, hostType);

    console.log(`[Lobby] Game ${gameId} created by "${hostName}" (${playerCount} players)`);
    return { gameId, playerId, token };
  }

  /**
   * List all games with their public info.
   * @returns {Array<object>}
   */
  listGames() {
    const list = [];
    for (const [id, room] of this.games) {
      list.push({
        id,
        config: room.config,
        players: room.playerSlots.map(s => ({
          id: s.id,
          name: s.name,
          type: s.type,
        })),
        status: room.status,
      });
    }
    return list;
  }

  /**
   * Get a game room by ID.
   * @param {string} gameId
   * @returns {GameRoom|undefined}
   */
  getGame(gameId) {
    return this.games.get(gameId);
  }

  /**
   * Join an existing game.
   * @param {string} gameId
   * @param {string} playerName
   * @param {string} [playerType="human"]
   * @returns {{ playerId: string, token: string }}
   */
  joinGame(gameId, playerName, playerType = "human") {
    const room = this.games.get(gameId);
    if (!room) throw new Error("Game not found");
    return room.addPlayer(playerName, playerType);
  }

  /**
   * Start a game (host only).
   * @param {string} gameId
   * @param {string} hostToken
   */
  startGame(gameId, hostToken) {
    const room = this.games.get(gameId);
    if (!room) throw new Error("Game not found");

    // Verify host (first player slot)
    const host = room.playerSlots[0];
    if (!host || host.token !== hostToken) {
      throw new Error("Only the host can start the game");
    }

    room.start();
  }

  /**
   * Add a bot to the game (host only).
   * @param {string} gameId
   * @param {string} hostToken
   * @returns {{ playerId: string }}
   */
  addBot(gameId, hostToken) {
    const room = this.games.get(gameId);
    if (!room) throw new Error("Game not found");

    const host = room.playerSlots[0];
    if (!host || host.token !== hostToken) {
      throw new Error("Only the host can add bots");
    }

    return room.addBot();
  }

  /**
   * Remove a finished game from the lobby.
   * @param {string} gameId
   */
  removeGame(gameId) {
    const room = this.games.get(gameId);
    if (room) {
      room.stop();
      this.games.delete(gameId);
      console.log(`[Lobby] Game ${gameId} removed`);
    }
  }

  /**
   * Look up which game and player a token belongs to.
   * Used by auth middleware.
   * @param {string} token
   * @returns {{ gameId: string, playerId: string, room: GameRoom }|null}
   */
  findByToken(token) {
    for (const [gameId, room] of this.games) {
      const slot = room.getPlayerByToken(token);
      if (slot) {
        return { gameId, playerId: slot.id, room };
      }
    }
    return null;
  }
}
