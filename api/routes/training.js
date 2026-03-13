// ═══════════════════════════════════════════════════════════════════════════
//  TRAINING API - Neuroevolution training endpoints (Worker thread based)
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { NeuralNet } from "../../shared/neural.js";
import { DEFAULT_LAYERS } from "../../shared/features.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../../server/training-worker.js");

const router = Router();

// Active training sessions keyed by session ID
const sessions = new Map();

/**
 * POST /api/training/start
 * Start a new training session and immediately begin first generation.
 * Body: { populationSize?, layers?, mutationRate?, mutationStrength?, gamesPerNet?, maxTicks? }
 */
router.post("/start", (req, res) => {
  const {
    populationSize = 20,
    layers,
    mutationRate = 0.1,
    mutationStrength = 0.3,
    gamesPerNet = 2,
    maxTicks = 600,
  } = req.body || {};

  const id = `train_${Date.now()}`;

  const session = {
    id,
    config: {
      populationSize,
      layers: layers || [...DEFAULT_LAYERS],
      mutationRate,
      mutationStrength,
      gamesPerNet,
      maxTicks,
    },
    populationJSON: null,
    running: false,
    generation: 0,
    history: [],
    bestWeights: null,
    worker: null,
  };

  sessions.set(id, session);
  res.json({
    sessionId: id,
    populationSize,
    layers: session.config.layers,
    paramCount: new NeuralNet(session.config.layers).paramCount(),
  });
});

/**
 * Spawn a worker to run one generation.
 */
function runGenerationWorker(session) {
  if (session.worker) return;
  session.running = true;

  const worker = new Worker(WORKER_PATH, {
    workerData: {
      config: session.config,
      populationJSON: session.populationJSON,
    },
  });

  session.worker = worker;

  worker.on("message", (msg) => {
    session.generation = msg.result.generation;
    session.history.push(msg.result);
    session.bestWeights = msg.bestWeights;
    session.populationJSON = msg.populationJSON;
    session.worker = null;

    // Auto-continue if still flagged as running
    if (session.running) {
      setImmediate(() => runGenerationWorker(session));
    }
  });

  worker.on("error", (err) => {
    console.error(`[Training ${session.id}] Worker error:`, err.message);
    session.worker = null;
    session.running = false;
  });

  worker.on("exit", (code) => {
    if (code !== 0 && session.worker) {
      console.error(`[Training ${session.id}] Worker exited with code ${code}`);
      session.worker = null;
      session.running = false;
    }
  });
}

/**
 * POST /api/training/:id/run
 * Start running generations in background worker thread.
 */
router.post("/:id/run", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!session.running) {
    session.running = true;
    runGenerationWorker(session);
  }

  res.json({ started: true, generation: session.generation });
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
    bestWeights: session.bestWeights,
  });
});

/**
 * GET /api/training/:id/best
 * Get the best neural net weights from the current population.
 */
router.get("/:id/best", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!session.bestWeights) return res.status(404).json({ error: "No weights yet" });
  res.json({ weights: session.bestWeights });
});

/**
 * POST /api/training/:id/stop
 * Stop training.
 */
router.post("/:id/stop", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  session.running = false;
  if (session.worker) {
    try { session.worker.terminate(); } catch (_) { /* ignore */ }
    session.worker = null;
  }

  res.json({ stopped: true, finalGeneration: session.generation, bestWeights: session.bestWeights });
});

/**
 * DELETE /api/training/:id
 * Delete a training session.
 */
router.delete("/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  session.running = false;
  if (session.worker) {
    try { session.worker.terminate(); } catch (_) { /* ignore */ }
  }
  sessions.delete(req.params.id);
  res.json({ deleted: true });
});

/**
 * GET /api/training/sessions
 * List active training sessions.
 */
router.get("/sessions", (_req, res) => {
  const list = [];
  for (const [id, s] of sessions) {
    list.push({ id, generation: s.generation, running: s.running, popSize: s.config.populationSize });
  }
  res.json(list);
});

export default router;
