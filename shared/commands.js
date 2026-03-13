// ═══════════════════════════════════════════════════════════════════════════
//  COMMAND PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

import { BLD, getTech } from "./buildings.js";
import { ITEMS } from "./items.js";

const VALID_CMDS = new Set(["gather", "build", "attack", "moveTo", "ability", "idle", "craft"]);
const VALID_BUILD_TYPES = new Set(Object.keys(BLD));

/**
 * Validate a single command for a player.
 * @param {import('./types.js').Command} command
 * @param {import('./types.js').Player} player
 * @param {import('./types.js').GameState} state
 * @returns {boolean}
 */
export function validateCommand(command, player, state) {
  if (!command || !command.cmd) return false;
  if (!VALID_CMDS.has(command.cmd)) return false;

  // Must reference a valid alive unit owned by this player
  const unit = player.units.find(u => u.id === command.unitId && u.alive);
  if (!unit) return false;

  if (command.cmd === "gather") {
    if (command.targetId == null) return false;
    const res = state.resources.find(r => r.id === command.targetId && r.amount > 0);
    if (!res) return false;
  }

  if (command.cmd === "build") {
    if (!command.buildType || !VALID_BUILD_TYPES.has(command.buildType)) return false;
    const bd = BLD[command.buildType];
    if (bd.requires) {
      const tech = getTech(player.buildings);
      if (!tech.has(bd.requires)) return false;
    }
  }

  if (command.cmd === "attack") {
    if (command.targetId == null) return false;
  }

  if (command.cmd === "moveTo") {
    if (command.moveX == null || command.moveY == null) return false;
  }

  if (command.cmd === "ability") {
    if (unit.specLv < 3) return false;
    if (unit.abCd > 0) return false;
  }

  if (command.cmd === "craft") {
    if (!command.craftItem || !ITEMS[command.craftItem]) return false;
    const itemDef = ITEMS[command.craftItem];
    if (itemDef.requires) {
      const tech = getTech(player.buildings);
      if (!tech.has(itemDef.requires)) return false;
    }
    if (!player.buildings.some(b => b.type === itemDef.craftAt && b.built)) return false;
  }

  return true;
}

/**
 * Apply an array of commands to a player's units.
 * Sets unit cmd/targetId/buildType/etc. based on commands.
 * @param {import('./types.js').Command[]} commands
 * @param {import('./types.js').Player} player
 */
export function applyCommands(commands, player) {
  for (const cmd of commands) {
    const unit = player.units.find(u => u.id === cmd.unitId && u.alive);
    if (!unit) continue;

    unit.cmd = cmd.cmd;

    if (cmd.targetId != null) unit.targetId = cmd.targetId;
    if (cmd.buildType != null) unit.buildType = cmd.buildType;
    if (cmd.buildX != null) unit.buildX = cmd.buildX;
    if (cmd.buildY != null) unit.buildY = cmd.buildY;
    if (cmd.moveX != null) unit.moveX = cmd.moveX;
    if (cmd.moveY != null) unit.moveY = cmd.moveY;
    if (cmd.tag !== undefined) unit.tag = cmd.tag;
    if (cmd.craftItem != null) { unit.craftItem = cmd.craftItem; unit.craftProg = 0; }
  }
}
