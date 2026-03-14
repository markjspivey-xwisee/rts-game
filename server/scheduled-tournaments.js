// ═══════════════════════════════════════════════════════════════════════════
//  SCHEDULED TOURNAMENTS - Autonomous recurring agent tournaments
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { agentRegistry, recordAgentMatch } from "./erc8004.js";
import { loadData, saveData } from "./persistence.js";

const TOURNAMENT_INTERVAL_MS = parseInt(process.env.TOURNAMENT_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);

// Scheduled tournament history (loaded from persistent storage)
const scheduledHistory = loadData("tournament-history.json", []);
let nextRunTime = null;
let schedulerTimer = null;
let lobbyRef = null;

/**
 * Start the recurring tournament scheduler.
 * @param {import("./lobby.js").Lobby} lobby
 */
export function startScheduler(lobby) {
  lobbyRef = lobby;
  nextRunTime = Date.now() + TOURNAMENT_INTERVAL_MS;

  console.log(`[ScheduledTournament] Scheduler started. Interval: ${TOURNAMENT_INTERVAL_MS}ms`);
  console.log(`[ScheduledTournament] Next tournament at: ${new Date(nextRunTime).toISOString()}`);

  schedulerTimer = setInterval(() => {
    runScheduledTournament().catch(err => {
      console.error("[ScheduledTournament] Error running scheduled tournament:", err);
    });
  }, TOURNAMENT_INTERVAL_MS);
}

/**
 * Collect all registered ERC-8004 agents as participants.
 */
function collectParticipants() {
  const participants = [];
  for (const [, agent] of agentRegistry.entries()) {
    participants.push({
      agentId: agent.agentId,
      name: agent.name,
      wallet: agent.wallet,
      chainAgentId: agent.chainAgentId,
    });
  }
  return participants;
}

/**
 * Run a single scheduled tournament.
 */
async function runScheduledTournament() {
  nextRunTime = Date.now() + TOURNAMENT_INTERVAL_MS;

  const participants = collectParticipants();

  if (participants.length < 2) {
    console.log(`[ScheduledTournament] Skipping: only ${participants.length} agent(s) registered`);
    return null;
  }

  const tournamentId = uuidv4();
  const participantNames = participants.map(p => p.name);

  console.log(`[ScheduledTournament] Starting tournament ${tournamentId} with ${participants.length} agents`);

  const entry = {
    id: tournamentId,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    participants: participants.map(p => ({ agentId: p.agentId, name: p.name, wallet: p.wallet })),
    bracket: [],
    results: [],
    winner: null,
    error: null,
  };
  scheduledHistory.push(entry);

  try {
    // Build bracket
    const bracket = buildBracket(participantNames);
    entry.bracket = bracket;

    // Run rounds
    for (let roundIdx = 0; roundIdx < bracket.length; roundIdx++) {
      const round = bracket[roundIdx];

      for (const match of round) {
        if (match.p2 === "BYE") { match.winner = match.p1; continue; }
        if (match.p1 === "BYE") { match.winner = match.p2; continue; }

        try {
          const { gameId } = lobbyRef.createGame(
            { playerCount: 2, enablePvE: false, mapTheme: "arena" },
            match.p1, "scheduled-tournament"
          );

          const room = lobbyRef.getGame(gameId);
          room.addPlayer(match.p2, "scheduled-tournament");
          match.gameId = gameId;
          room.start();

          const winner = await waitForGame(room, 300000);
          match.winner = winner || match.p1;

          // Find agent IDs for winner and loser
          const winnerAgent = participants.find(p => p.name === match.winner);
          const loserName = match.winner === match.p1 ? match.p2 : match.p1;
          const loserAgent = participants.find(p => p.name === loserName);

          if (winnerAgent && loserAgent) {
            recordAgentMatch(winnerAgent.agentId, loserAgent.agentId, gameId);
          }

          entry.results.push({
            round: roundIdx, p1: match.p1, p2: match.p2,
            winner: match.winner, gameId,
          });
        } catch (err) {
          console.error(`[ScheduledTournament] Match error: ${match.p1} vs ${match.p2}:`, err.message);
          match.winner = match.p1;
          entry.results.push({
            round: roundIdx, p1: match.p1, p2: match.p2,
            winner: match.p1, error: err.message,
          });
        }
      }

      // Fill next round
      if (roundIdx < bracket.length - 1) {
        const nextRound = bracket[roundIdx + 1];
        const winners = round.map(m => m.winner);
        for (let i = 0; i < nextRound.length; i++) {
          nextRound[i].p1 = winners[i * 2] || "BYE";
          nextRound[i].p2 = winners[i * 2 + 1] || "BYE";
        }
      }
    }

    // Determine winner
    const finalRound = bracket[bracket.length - 1];
    entry.winner = finalRound[0]?.winner || null;
    entry.status = "finished";
    entry.finishedAt = Date.now();

    // Award earnings to winner's NFT weight TBA if available
    if (entry.winner) {
      const winnerAgent = participants.find(p => p.name === entry.winner);
      if (winnerAgent) {
        console.log(`[ScheduledTournament] Winner: ${entry.winner} (agent ${winnerAgent.agentId})`);
      }
    }

    console.log(`[ScheduledTournament] Tournament ${tournamentId} finished. Winner: ${entry.winner}`);
    saveData("tournament-history.json", scheduledHistory);
    return entry;
  } catch (err) {
    entry.status = "error";
    entry.error = err.message;
    entry.finishedAt = Date.now();
    saveData("tournament-history.json", scheduledHistory);
    console.error(`[ScheduledTournament] Tournament ${tournamentId} failed:`, err);
    return entry;
  }
}

/**
 * Build a single-elimination bracket.
 */
function buildBracket(participants) {
  const size = Math.pow(2, Math.ceil(Math.log2(participants.length)));
  const padded = [...participants];
  while (padded.length < size) padded.push("BYE");

  const rounds = [];
  let current = padded;

  while (current.length > 1) {
    const matches = [];
    for (let i = 0; i < current.length; i += 2) {
      matches.push({ p1: current[i], p2: current[i + 1], winner: null, gameId: null });
    }
    rounds.push(matches);
    current = matches.map(() => null);
  }

  return rounds;
}

/**
 * Wait for a game room to finish.
 */
function waitForGame(room, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (room.status === "finished") {
        const winnerId = room.state?.winner;
        const winnerSlot = room.playerSlots.find(s => s.id === winnerId);
        resolve(winnerSlot?.name || null);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        room.stop();
        resolve(null);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

/**
 * Create the scheduled tournament API router.
 */
export function createScheduledTournamentRouter() {
  const router = Router();

  // GET /api/tournaments/scheduled - List scheduled tournament results
  router.get("/", (_req, res) => {
    res.json({
      tournaments: scheduledHistory.map(t => ({
        id: t.id,
        status: t.status,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        participantCount: t.participants.length,
        winner: t.winner,
        error: t.error,
      })),
      total: scheduledHistory.length,
      intervalMs: TOURNAMENT_INTERVAL_MS,
    });
  });

  // GET /api/tournaments/scheduled/next - Time until next tournament
  router.get("/next", (_req, res) => {
    const now = Date.now();
    const msUntilNext = nextRunTime ? Math.max(0, nextRunTime - now) : 0;
    res.json({
      nextRunTime: nextRunTime ? new Date(nextRunTime).toISOString() : null,
      msUntilNext,
      secondsUntilNext: Math.ceil(msUntilNext / 1000),
      intervalMs: TOURNAMENT_INTERVAL_MS,
      registeredAgents: agentRegistry.size,
    });
  });

  // POST /api/tournaments/scheduled/trigger - Manually trigger a tournament
  router.post("/trigger", async (_req, res) => {
    const participants = collectParticipants();
    if (participants.length < 2) {
      return res.status(400).json({
        error: "Need at least 2 registered agents",
        registeredAgents: participants.length,
      });
    }

    res.json({ message: "Tournament triggered", status: "starting" });

    runScheduledTournament().catch(err => {
      console.error("[ScheduledTournament] Triggered tournament error:", err);
    });
  });

  return router;
}
