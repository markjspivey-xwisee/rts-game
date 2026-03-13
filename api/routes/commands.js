// ═══════════════════════════════════════════════════════════════════════════
//  COMMANDS ROUTES - Submit game commands via REST
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { extractPlayerAuth } from "../middleware/auth.js";

/**
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createCommandsRouter(lobby) {
  const router = Router();
  const auth = extractPlayerAuth(lobby);

  // POST /api/games/:id/commands - Submit commands for your units
  router.post("/:id/commands", auth, (req, res) => {
    try {
      // Verify the token matches this specific game
      if (req.gameId !== req.params.id) {
        return res.status(403).json({ error: "Token does not belong to this game" });
      }

      const { commands } = req.body;

      if (!Array.isArray(commands)) {
        return res.status(400).json({ error: "commands must be an array" });
      }

      if (commands.length === 0) {
        return res.json({ accepted: 0 });
      }

      // Validate command structure
      for (const cmd of commands) {
        if (!cmd.type && !cmd.action && !cmd.cmd) {
          return res.status(400).json({ error: "Each command must have a type (or action/cmd)" });
        }
      }

      req.gameRoom.queueCommands(req.playerId, commands);
      res.json({ accepted: commands.length });
    } catch (err) {
      if (err.message === "Game is not in progress") {
        return res.status(409).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
