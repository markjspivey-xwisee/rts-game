// ═══════════════════════════════════════════════════════════════════════════
//  STATE ROUTES - Retrieve game state and submit scripts via REST
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { extractPlayerAuth } from "../middleware/auth.js";

/**
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createStateRouter(lobby) {
  const router = Router();
  const auth = extractPlayerAuth(lobby);

  // GET /api/games/:id/state - Get your player view
  router.get("/:id/state", auth, (req, res) => {
    try {
      if (req.gameId !== req.params.id) {
        return res.status(403).json({ error: "Token does not belong to this game" });
      }

      const room = req.gameRoom;
      if (!room.state) {
        return res.status(409).json({ error: "Game has not started yet" });
      }

      // Optional: only return if state is newer than given tick
      const sinceTick = req.query.since ? parseInt(req.query.since, 10) : null;
      if (sinceTick !== null && !isNaN(sinceTick) && room.state.tick <= sinceTick) {
        return res.status(304).end();
      }

      const view = room.getPlayerView(req.playerId);
      if (!view) {
        return res.status(404).json({ error: "Player not found in game state" });
      }

      res.json(view);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/games/:id/log - Get game log entries for your player
  router.get("/:id/log", auth, (req, res) => {
    try {
      if (req.gameId !== req.params.id) {
        return res.status(403).json({ error: "Token does not belong to this game" });
      }

      const room = req.gameRoom;
      if (!room.state) {
        return res.status(409).json({ error: "Game has not started yet" });
      }

      const view = room.getPlayerView(req.playerId);
      if (!view) {
        return res.status(404).json({ error: "Player not found" });
      }

      res.json({ log: view.log });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/games/:id/script - Submit a player script
  router.post("/:id/script", auth, (req, res) => {
    try {
      if (req.gameId !== req.params.id) {
        return res.status(403).json({ error: "Token does not belong to this game" });
      }

      const { code } = req.body;

      if (typeof code !== "string") {
        return res.status(400).json({ error: "code must be a string" });
      }

      if (code.length > 50000) {
        return res.status(400).json({ error: "Script too large (max 50KB)" });
      }

      const result = req.gameRoom.submitScript(req.playerId, code);

      if (result.compiled) {
        res.json({ compiled: true });
      } else {
        res.status(400).json({ compiled: false, error: result.error });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
