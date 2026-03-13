// ═══════════════════════════════════════════════════════════════════════════
//  BOT PLAYER - Wraps shared AI logic for server-side bot ticks
// ═══════════════════════════════════════════════════════════════════════════

import { tickBotPlayer } from "../shared/index.js";

/**
 * Run one AI tick for a bot player.
 * Wraps tickBotPlayer from the shared module with error handling.
 *
 * @param {object} player - The player object from game state
 * @param {import("../shared/index.js").GameState} state - Full game state
 */
export function runBotTick(player, state) {
  try {
    tickBotPlayer(player, state);
  } catch (err) {
    console.error(`[Bot] Error running bot tick for ${player.id}:`, err.message);
  }
}
