// ═══════════════════════════════════════════════════════════════════════════
//  LEADERBOARD & ELO ROUTES
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { createPersistentStore } from "../../server/persistence.js";

// Persistent ELO store (survives server restarts)
const playerElo = createPersistentStore("leaderboard.json"); // name -> { elo, wins, losses, games, lastPlayed }

const DEFAULT_ELO = 1000;
const K_FACTOR = 32;

function getOrCreate(name) {
  if (!playerElo.has(name)) {
    playerElo.set(name, { elo: DEFAULT_ELO, wins: 0, losses: 0, games: 0, lastPlayed: null });
  }
  return playerElo.get(name);
}

/**
 * Calculate ELO change for a match result.
 * @param {number} ratingA
 * @param {number} ratingB
 * @param {number} scoreA - 1 for win, 0 for loss, 0.5 for draw
 * @returns {number} change for player A (negate for B)
 */
function eloChange(ratingA, ratingB, scoreA) {
  const expected = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(K_FACTOR * (scoreA - expected));
}

/**
 * Record a match result and update ELO ratings.
 * @param {string} winnerName
 * @param {string} loserName
 */
export function recordMatch(winnerName, loserName) {
  const winner = getOrCreate(winnerName);
  const loser = getOrCreate(loserName);

  const change = eloChange(winner.elo, loser.elo, 1);
  winner.elo += change;
  loser.elo -= change;
  winner.wins++;
  loser.losses++;
  winner.games++;
  loser.games++;
  winner.lastPlayed = Date.now();
  loser.lastPlayed = Date.now();

  // Persist updated records
  playerElo.set(winnerName, winner);
  playerElo.set(loserName, loser);
  playerElo.forceSave();
}

/**
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createLeaderboardRouter(lobby) {
  const router = Router();

  // GET /api/leaderboard - Get sorted leaderboard
  router.get("/", (_req, res) => {
    const entries = playerElo.entries()
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.elo - a.elo);
    res.json({ leaderboard: entries });
  });

  // GET /api/leaderboard/:name - Get a player's ELO
  router.get("/:name", (req, res) => {
    const name = decodeURIComponent(req.params.name);
    if (!playerElo.has(name)) {
      return res.status(404).json({ error: "Player not found" });
    }
    const data = playerElo.get(name);
    res.json({ name, ...data });
  });

  return router;
}

export { playerElo, getOrCreate, eloChange };
