// ═══════════════════════════════════════════════════════════════════════════
//  GAMES ROUTES - Create, list, join games and manage lobby
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";

/**
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createGamesRouter(lobby) {
  const router = Router();

  // GET /api/games - List all games
  router.get("/", (_req, res) => {
    try {
      const games = lobby.listGames();
      res.json({ games });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/games - Create a new game
  router.post("/", (req, res) => {
    try {
      const { config, playerName, playerType } = req.body;

      if (!config || !playerName) {
        return res.status(400).json({ error: "config and playerName are required" });
      }

      if (typeof playerName !== "string" || playerName.trim().length === 0) {
        return res.status(400).json({ error: "playerName must be a non-empty string" });
      }

      const result = lobby.createGame(config, playerName.trim(), playerType || "human");
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/games/:id/join - Join an existing game
  router.post("/:id/join", (req, res) => {
    try {
      const { playerName, playerType } = req.body;

      if (!playerName) {
        return res.status(400).json({ error: "playerName is required" });
      }

      if (typeof playerName !== "string" || playerName.trim().length === 0) {
        return res.status(400).json({ error: "playerName must be a non-empty string" });
      }

      const result = lobby.joinGame(req.params.id, playerName.trim(), playerType || "human");
      res.json(result);
    } catch (err) {
      if (err.message === "Game not found") {
        return res.status(404).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/games/:id/start - Start the game (host only)
  router.post("/:id/start", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing authorization" });
      }

      const token = authHeader.slice(7).trim();
      lobby.startGame(req.params.id, token);
      res.json({ started: true });
    } catch (err) {
      if (err.message === "Game not found") {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes("host")) {
        return res.status(403).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/games/:id/add-bot - Add a bot player (host only)
  router.post("/:id/add-bot", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing authorization" });
      }

      const token = authHeader.slice(7).trim();
      const result = lobby.addBot(req.params.id, token);
      res.json(result);
    } catch (err) {
      if (err.message === "Game not found") {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes("host")) {
        return res.status(403).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
