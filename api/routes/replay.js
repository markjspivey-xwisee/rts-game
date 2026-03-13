// ═══════════════════════════════════════════════════════════════════════════
//  REPLAY & SPECTATE ROUTES
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";

/**
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createReplayRouter(lobby) {
  const router = Router();

  // GET /api/games/:id/replay - Get full replay data for a finished game
  router.get("/:id/replay", (req, res) => {
    const room = lobby.getGame(req.params.id);
    if (!room) return res.status(404).json({ error: "Game not found" });

    if (room.status !== "finished" && room.replayFrames.length === 0) {
      return res.status(409).json({ error: "Game has no replay data yet" });
    }

    res.json(room.getReplay());
  });

  // GET /api/games/:id/replay/frames?from=0&to=100 - Get a range of frames
  router.get("/:id/replay/frames", (req, res) => {
    const room = lobby.getGame(req.params.id);
    if (!room) return res.status(404).json({ error: "Game not found" });

    const from = parseInt(req.query.from) || 0;
    const to = parseInt(req.query.to) || room.replayFrames.length;
    const frames = room.replayFrames.slice(from, to);

    res.json({
      total: room.replayFrames.length,
      from,
      to: Math.min(to, room.replayFrames.length),
      frames,
    });
  });

  // GET /api/games/:id/spectate - Get current spectator view (snapshot)
  router.get("/:id/spectate", (req, res) => {
    const room = lobby.getGame(req.params.id);
    if (!room) return res.status(404).json({ error: "Game not found" });

    if (room.status !== "playing") {
      return res.status(409).json({ error: "Game is not in progress" });
    }

    res.json(room._buildSpectatorView());
  });

  return router;
}
