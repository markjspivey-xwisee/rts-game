// ═══════════════════════════════════════════════════════════════════════════
//  RANKED SEASONS - Seasonal competitive ranking system
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";

const SEASON_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const RANKS = {
  bronze:   { name: "Bronze",   min: 0,    max: 1099, icon: "🥉" },
  silver:   { name: "Silver",   min: 1100, max: 1299, icon: "🥈" },
  gold:     { name: "Gold",     min: 1300, max: 1499, icon: "🥇" },
  platinum: { name: "Platinum", min: 1500, max: 1699, icon: "💠" },
  diamond:  { name: "Diamond",  min: 1700, max: Infinity, icon: "💎" },
};

// Season state
const pastSeasons = [];
let currentSeason = null;

/**
 * Get rank tier from ELO.
 */
function getRank(elo) {
  if (elo >= 1700) return "diamond";
  if (elo >= 1500) return "platinum";
  if (elo >= 1300) return "gold";
  if (elo >= 1100) return "silver";
  return "bronze";
}

/**
 * Ensure a season is active; create or rotate as needed.
 */
function ensureSeason() {
  const now = Date.now();

  if (!currentSeason) {
    currentSeason = createSeason(1, now);
    return currentSeason;
  }

  if (now >= currentSeason.endsAt) {
    // Season ended — archive and create new one
    currentSeason.status = "ended";
    pastSeasons.push({ ...currentSeason, players: { ...currentSeason.players } });

    const nextNumber = currentSeason.seasonNumber + 1;
    const oldPlayers = currentSeason.players;
    currentSeason = createSeason(nextNumber, now);

    // Soft reset ELO: newElo = 1000 + (oldElo - 1000) * 0.5
    for (const [name, stats] of Object.entries(oldPlayers)) {
      const resetElo = Math.round(1000 + (stats.elo - 1000) * 0.5);
      currentSeason.players[name] = {
        elo: resetElo,
        wins: 0,
        losses: 0,
        rank: getRank(resetElo),
        peakElo: resetElo,
      };
    }
  }

  return currentSeason;
}

/**
 * Create a fresh season.
 */
function createSeason(seasonNumber, startTime) {
  return {
    seasonNumber,
    status: "active",
    startedAt: startTime,
    endsAt: startTime + SEASON_DURATION_MS,
    players: {},
  };
}

/**
 * Record a ranked match result.
 */
export function recordRankedMatch(winnerName, loserName) {
  const season = ensureSeason();

  if (!season.players[winnerName]) {
    season.players[winnerName] = { elo: 1000, wins: 0, losses: 0, rank: "bronze", peakElo: 1000 };
  }
  if (!season.players[loserName]) {
    season.players[loserName] = { elo: 1000, wins: 0, losses: 0, rank: "bronze", peakElo: 1000 };
  }

  const w = season.players[winnerName];
  const l = season.players[loserName];

  // ELO calculation
  const expectedWin = 1 / (1 + Math.pow(10, (l.elo - w.elo) / 400));
  const expectedLoss = 1 / (1 + Math.pow(10, (w.elo - l.elo) / 400));

  w.elo += Math.round(32 * (1 - expectedWin));
  l.elo += Math.round(32 * (0 - expectedLoss));
  l.elo = Math.max(0, l.elo);

  w.wins++;
  l.losses++;

  w.rank = getRank(w.elo);
  l.rank = getRank(l.elo);

  if (w.elo > w.peakElo) w.peakElo = w.elo;
}

/**
 * Create the ranked season API router.
 */
export function createRankedRouter() {
  const router = Router();

  // GET /api/ranked/season - Current season info
  router.get("/season", (_req, res) => {
    const season = ensureSeason();
    const now = Date.now();
    const msRemaining = Math.max(0, season.endsAt - now);

    res.json({
      seasonNumber: season.seasonNumber,
      status: season.status,
      startedAt: new Date(season.startedAt).toISOString(),
      endsAt: new Date(season.endsAt).toISOString(),
      msRemaining,
      daysRemaining: Math.ceil(msRemaining / (24 * 60 * 60 * 1000)),
      totalPlayers: Object.keys(season.players).length,
      ranks: RANKS,
    });
  });

  // GET /api/ranked/standings - Current season standings
  router.get("/standings", (_req, res) => {
    const season = ensureSeason();

    const standings = Object.entries(season.players)
      .map(([name, stats]) => ({
        name,
        elo: stats.elo,
        rank: stats.rank,
        rankName: RANKS[stats.rank].name,
        wins: stats.wins,
        losses: stats.losses,
        totalGames: stats.wins + stats.losses,
        winRate: stats.wins + stats.losses > 0
          ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) + "%"
          : "0.0%",
        peakElo: stats.peakElo,
      }))
      .sort((a, b) => b.elo - a.elo);

    res.json({
      seasonNumber: season.seasonNumber,
      standings,
    });
  });

  // GET /api/ranked/history - Past seasons
  router.get("/history", (_req, res) => {
    const history = pastSeasons.map(s => {
      const players = Object.entries(s.players)
        .map(([name, stats]) => ({ name, elo: stats.elo, rank: stats.rank, wins: stats.wins, losses: stats.losses }))
        .sort((a, b) => b.elo - a.elo);

      return {
        seasonNumber: s.seasonNumber,
        startedAt: new Date(s.startedAt).toISOString(),
        endsAt: new Date(s.endsAt).toISOString(),
        totalPlayers: players.length,
        topPlayers: players.slice(0, 10),
        champion: players[0] || null,
      };
    });

    res.json({ seasons: history });
  });

  return router;
}
