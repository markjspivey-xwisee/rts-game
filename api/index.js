// ═══════════════════════════════════════════════════════════════════════════
//  API ROUTER - Creates Express router with all API routes
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { createGamesRouter } from "./routes/games.js";
import { createCommandsRouter } from "./routes/commands.js";
import { createStateRouter } from "./routes/state.js";
import { createReplayRouter } from "./routes/replay.js";
import { createWeightsRouter } from "./routes/weights.js";
import { createLeaderboardRouter } from "./routes/leaderboard.js";
import { createTournamentRouter } from "./routes/tournament.js";
import trainingRouter from "./routes/training.js";

/**
 * Create the API router with all sub-routes.
 * @param {import("../server/lobby.js").Lobby} lobby
 * @returns {import("express").Router}
 */
export function createApiRouter(lobby) {
  const router = Router();

  router.use("/api/games", createGamesRouter(lobby));
  router.use("/api/games", createCommandsRouter(lobby));
  router.use("/api/games", createStateRouter(lobby));
  router.use("/api/games", createReplayRouter(lobby));
  router.use("/api/weights", createWeightsRouter());
  router.use("/api/leaderboard", createLeaderboardRouter(lobby));
  router.use("/api/tournaments", createTournamentRouter(lobby));
  router.use("/api/training", trainingRouter);

  return router;
}
