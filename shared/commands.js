// ═══════════════════════════════════════════════════════════════════════════
//  COMMAND PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

import { BLD, getTech } from "./buildings.js";
import { ITEMS } from "./items.js";
import { AGE_ORDER, AGE_COSTS, FORMATIONS, DIPLO } from "./constants.js";
import { NAVAL } from "./units.js";

const VALID_CMDS = new Set([
  "gather", "build", "attack", "moveTo", "ability", "idle", "craft",
  "mount", "dismount", "crew", "uncrew",
  "advance_age", "formation", "pickup_relic", "tribute",
  "train_naval", "board_transport", "disembark",
  "set_diplomacy",
]);
const VALID_BUILD_TYPES = new Set(Object.keys(BLD));

/**
 * Validate a single command for a player.
 */
export function validateCommand(command, player, state) {
  if (!command || !command.cmd) return false;
  if (!VALID_CMDS.has(command.cmd)) return false;

  // Commands that don't require a unit
  if (command.cmd === "advance_age") {
    if (player.ageProgress) return false; // already advancing
    const idx = AGE_ORDER.indexOf(player.age);
    if (idx >= AGE_ORDER.length - 1) return false; // already imperial
    const nextAge = AGE_ORDER[idx + 1];
    const cost = AGE_COSTS[nextAge];
    for (const [r, a] of Object.entries(cost)) {
      if ((player.stockpile[r] || 0) < a) return false;
    }
    return true;
  }

  if (command.cmd === "set_diplomacy") {
    return command.targetPlayerId != null && command.status != null;
  }

  if (command.cmd === "tribute") {
    const { targetPlayerId, resource, amount } = command;
    if (!targetPlayerId || !resource || !amount || amount <= 0) return false;
    if ((player.stockpile[resource] || 0) < amount) return false;
    return true;
  }

  if (command.cmd === "formation") {
    return command.formation != null && FORMATIONS[command.formation] != null;
  }

  if (command.cmd === "train_naval") {
    if (!command.navalType || !NAVAL[command.navalType]) return false;
    const def = NAVAL[command.navalType];
    if (!player.buildings.some(b => b.type === "dock" && b.built)) return false;
    for (const [r, a] of Object.entries(def.cost)) {
      if ((player.stockpile[r] || 0) < a) return false;
    }
    return true;
  }

  // Unit-based commands
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
    // Check age requirement
    if (bd.age) {
      const playerAgeIdx = AGE_ORDER.indexOf(player.age);
      const bldAgeIdx = AGE_ORDER.indexOf(bd.age);
      if (bldAgeIdx > playerAgeIdx) return false;
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

  if (command.cmd === "mount") {
    if (command.targetId == null) return false;
    if (unit.mounted || unit.crewing) return false;
  }

  if (command.cmd === "dismount") {
    if (!unit.mounted) return false;
  }

  if (command.cmd === "crew") {
    if (command.targetId == null) return false;
    if (unit.mounted || unit.crewing) return false;
    const veh = (player.vehicles || []).find(v => v.id === command.targetId && v.alive);
    if (!veh || veh.crewId) return false;
  }

  if (command.cmd === "uncrew") {
    if (!unit.crewing) return false;
  }

  if (command.cmd === "pickup_relic") {
    if (command.targetId == null) return false;
  }

  return true;
}

/**
 * Apply an array of commands to a player's units.
 */
export function applyCommands(commands, player) {
  for (const cmd of commands) {
    // Non-unit commands
    if (cmd.cmd === "advance_age" || cmd.cmd === "set_diplomacy" || cmd.cmd === "tribute" || cmd.cmd === "train_naval") {
      // Handled directly in tick.js when the command is processed
      player._pendingCmds = player._pendingCmds || [];
      player._pendingCmds.push(cmd);
      continue;
    }

    if (cmd.cmd === "formation") {
      // Apply formation to all specified units
      const ids = cmd.unitIds || (cmd.unitId != null ? [cmd.unitId] : []);
      for (const uid of ids) {
        const u = player.units.find(u => u.id === uid && u.alive);
        if (u) u.formation = cmd.formation;
      }
      continue;
    }

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
