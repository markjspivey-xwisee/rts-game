// ═══════════════════════════════════════════════════════════════════════════
//  TRAINING API - Neuroevolution training endpoints
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { Population, runTrainingGame, scoreFitness } from "../../shared/training.js";
import { NeuralNet } from "../../shared/neural.js";
import { DEFAULT_LAYERS } from "../../shared/features.js";

const router = Router();

// Active training sessions keyed by session ID
const sessions = new Map();

/**
 * POST /api/training/start
 * Start a new training session.
 * Body: { populationSize?, layers?, mutationRate?, mutationStrength?, gamesPerNet?, maxTicks? }
 */
router.post("/start", (req, res) => {
  const {
    populationSize = 30,
    layers,
    mutationRate = 0.1,
    mutationStrength = 0.3,
    gamesPerNet = 3,
    maxTicks = 1000,
  } = req.body || {};

  const id = `train_${Date.now()}`;
  const pop = new Population({
    size: populationSize,
    layers: layers || [...DEFAULT_LAYERS],
    mutationRate,
    mutationStrength,
  });

  const session = {
    id,
    pop,
    gamesPerNet,
    maxTicks,
    running: false,
    generation: 0,
    history: [],
    bestWeights: null,
  };

  sessions.set(id, session);
  res.json({ sessionId: id, populationSize, layers: pop.layers, paramCount: new NeuralNet(pop.layers).paramCount() });
});

/**
 * POST /api/training/:id/run
 * Run N generations synchronously (blocking — use for small pops or from a worker).
 * Body: { generations?: number }
 */
router.post("/:id/run", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const generations = Math.min(req.body?.generations || 1, 50);
  session.running = true;

  const results = [];
  for (let i = 0; i < generations; i++) {
    const result = session.pop.runGeneration(session.gamesPerNet, session.maxTicks);
    session.generation = result.generation;
    session.history.push(result);
    results.push(result);
  }

  session.bestWeights = session.pop.getBest().toJSON();
  session.running = false;

  res.json({ generations: results, bestWeights: session.bestWeights });
});

/**
 * GET /api/training/:id/status
 * Get current training session status.
 */
router.get("/:id/status", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  res.json({
    sessionId: session.id,
    generation: session.generation,
    running: session.running,
    history: session.history.slice(-20),
    hasBestWeights: !!session.bestWeights,
  });
});

/**
 * GET /api/training/:id/best
 * Get the best neural net weights from the current population.
 */
router.get("/:id/best", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const best = session.pop.getBest();
  res.json({ weights: best.toJSON() });
});

/**
 * POST /api/training/:id/stop
 * Stop and delete a training session.
 */
router.post("/:id/stop", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  sessions.delete(req.params.id);
  res.json({ stopped: true, finalGeneration: session.generation, bestWeights: session.bestWeights });
});

/**
 * POST /api/training/evaluate
 * Run a single game between two sets of weights.
 * Body: { weightsA: {...}, weightsB: {...}, maxTicks? }
 */
router.post("/evaluate", (req, res) => {
  const { weightsA, weightsB, maxTicks = 1200 } = req.body || {};
  if (!weightsA || !weightsB) return res.status(400).json({ error: "Need weightsA and weightsB" });

  try {
    const netA = NeuralNet.fromJSON(weightsA);
    const netB = NeuralNet.fromJSON(weightsB);
    const result = runTrainingGame(netA, netB, maxTicks);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/training/sessions
 * List active training sessions.
 */
router.get("/sessions", (_req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    list.push({ id, generation: s.generation, running: s.running, popSize: s.pop.size });
  }
  res.json(list);
});

export default router;
