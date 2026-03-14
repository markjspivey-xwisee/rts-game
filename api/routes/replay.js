// ═══════════════════════════════════════════════════════════════════════════
//  REPLAY & SPECTATE ROUTES - with shareable replay URLs
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { randomBytes } from "crypto";

// Persistent replay store keyed by short share codes
const sharedReplays = new Map(); // shareCode -> { replay, createdAt }

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

  // POST /api/games/:id/replay/share - Generate a shareable replay URL
  router.post("/:id/replay/share", (req, res) => {
    const room = lobby.getGame(req.params.id);
    if (!room) return res.status(404).json({ error: "Game not found" });

    if (room.status !== "finished" && room.replayFrames.length === 0) {
      return res.status(409).json({ error: "Game has no replay data yet" });
    }

    const shareCode = randomBytes(6).toString("base64url");
    sharedReplays.set(shareCode, {
      replay: room.getReplay(),
      createdAt: Date.now(),
    });

    const host = req.get("host") || "localhost:3000";
    const protocol = req.protocol || "http";
    const shareUrl = `${protocol}://${host}/?replay=${shareCode}`;

    res.json({ shareCode, shareUrl });
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

// Expose shared replays for use by server/index.js
export { sharedReplays };
