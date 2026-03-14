// ═══════════════════════════════════════════════════════════════════════════
//  TOURNAMENT ROUTES - Multi-agent bracket tournament system
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { recordMatch } from "./leaderboard.js";

// In-memory tournament store
const tournaments = new Map();

/**
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createTournamentRouter(lobby) {
  const router = Router();

  // POST /api/tournaments - Create a tournament
  router.post("/", (req, res) => {
    const { name, participants, config } = req.body;
    if (!participants || participants.length < 2) {
      return res.status(400).json({ error: "Need at least 2 participants" });
    }

    const id = uuidv4();
    const bracket = buildBracket(participants);

    tournaments.set(id, {
      id,
      name: name || `Tournament ${id.substring(0, 8)}`,
      status: "pending",
      config: {
        playerCount: 2,
        enablePvE: false,
        mapTheme: config?.mapTheme || "default",
        ...config,
      },
      participants,
      bracket,
      currentRound: 0,
      results: [],
      createdAt: Date.now(),
    });

    res.status(201).json({ id, bracket });
  });

  // GET /api/tournaments - List tournaments
  router.get("/", (_req, res) => {
    const list = [...tournaments.values()].map(t => ({
      id: t.id, name: t.name, status: t.status,
      participants: t.participants.length,
      currentRound: t.currentRound,
      createdAt: t.createdAt,
    }));
    res.json({ tournaments: list });
  });

  // GET /api/tournaments/:id - Get tournament details
  router.get("/:id", (req, res) => {
    const t = tournaments.get(req.params.id);
    if (!t) return res.status(404).json({ error: "Tournament not found" });
    res.json(t);
  });

  // POST /api/tournaments/:id/start - Start the tournament
  router.post("/:id/start", async (req, res) => {
    const t = tournaments.get(req.params.id);
    if (!t) return res.status(404).json({ error: "Tournament not found" });
    if (t.status === "running") return res.status(409).json({ error: "Already running" });

    t.status = "running";
    res.json({ status: "running", message: "Tournament started. Games will be created for each match." });

    // Run the tournament asynchronously
    runTournament(t, lobby).catch(err => {
      console.error(`[Tournament ${t.id}] Error:`, err);
      t.status = "error";
    });
  });

  return router;
}

/**
 * Build a single-elimination bracket from participant list.
 */
function buildBracket(participants) {
  // Pad to next power of 2
  const size = Math.pow(2, Math.ceil(Math.log2(participants.length)));
  const padded = [...participants];
  while (padded.length < size) padded.push("BYE");

  const rounds = [];
  let current = padded;

  while (current.length > 1) {
    const matches = [];
    for (let i = 0; i < current.length; i += 2) {
      matches.push({
        p1: current[i],
        p2: current[i + 1],
        winner: null,
        gameId: null,
      });
    }
    rounds.push(matches);
    current = matches.map(() => null); // placeholders for next round
  }

  return rounds;
}

/**
 * Run tournament matches sequentially round by round.
 */
async function runTournament(tournament, lobby) {
  for (let roundIdx = 0; roundIdx < tournament.bracket.length; roundIdx++) {
    tournament.currentRound = roundIdx;
    const round = tournament.bracket[roundIdx];

    for (const match of round) {
      // Handle BYE
      if (match.p2 === "BYE") {
        match.winner = match.p1;
        continue;
      }
      if (match.p1 === "BYE") {
        match.winner = match.p2;
        continue;
      }

      // Create a game for this match
      try {
        const { gameId, token: hostToken } = lobby.createGame(
          { playerCount: 2, enablePvE: false, mapTheme: tournament.config.mapTheme },
          match.p1, "api"
        );

        const room = lobby.getGame(gameId);
        room.addPlayer(match.p2, "api");
        match.gameId = gameId;

        // Start the game (both are bots controlled via script/API)
        // For tournaments, both players are bots
        room.start();

        // Wait for game to finish (poll every 500ms, max 5 min)
        const winner = await waitForGame(room, 300000);
        match.winner = winner;

        // Record ELO
        if (winner) {
          const loser = winner === match.p1 ? match.p2 : match.p1;
          recordMatch(winner, loser);
        }

        tournament.results.push({
          round: roundIdx, p1: match.p1, p2: match.p2,
          winner, gameId,
        });
      } catch (err) {
        console.error(`[Tournament] Match error: ${match.p1} vs ${match.p2}:`, err.message);
        match.winner = match.p1; // default to p1 on error
      }
    }

    // Fill next round with winners
    if (roundIdx < tournament.bracket.length - 1) {
      const nextRound = tournament.bracket[roundIdx + 1];
      const winners = round.map(m => m.winner);
      for (let i = 0; i < nextRound.length; i++) {
        nextRound[i].p1 = winners[i * 2] || "BYE";
        nextRound[i].p2 = winners[i * 2 + 1] || "BYE";
      }
    }
  }

  tournament.status = "finished";
  const finalRound = tournament.bracket[tournament.bracket.length - 1];
  tournament.winner = finalRound[0]?.winner || null;
}

/**
 * Wait for a game room to finish.
 */
function waitForGame(room, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (room.status === "finished") {
        // Find winner name
        const winnerId = room.state?.winner;
        const winnerSlot = room.playerSlots.find(s => s.id === winnerId);
        resolve(winnerSlot?.name || null);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        // Timeout — pick the player with more TC hp
        room.stop();
        resolve(null);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}
