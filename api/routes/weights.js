// ═══════════════════════════════════════════════════════════════════════════
//  WEIGHTS ROUTES - Upload, download, and browse neural net weight sets
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";

// In-memory weight store (persists per server instance)
const weightLibrary = new Map();

// Seed with empty - default weights get added on server start if available
let nextId = 1;

/**
 * @returns {import("express").Router}
 */
export function createWeightsRouter() {
  const router = Router();

  // GET /api/weights - List all shared weight sets
  router.get("/", (_req, res) => {
    const list = [];
    for (const [id, entry] of weightLibrary) {
      list.push({
        id,
        name: entry.name,
        author: entry.author,
        description: entry.description,
        fitness: entry.fitness,
        generations: entry.generations,
        downloads: entry.downloads,
        createdAt: entry.createdAt,
      });
    }
    // Sort by fitness descending
    list.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));
    res.json({ weights: list });
  });

  // GET /api/weights/:id - Download a specific weight set
  router.get("/:id", (req, res) => {
    const entry = weightLibrary.get(req.params.id);
    if (!entry) return res.status(404).json({ error: "Weight set not found" });
    entry.downloads++;
    res.json({
      id: req.params.id,
      name: entry.name,
      author: entry.author,
      description: entry.description,
      fitness: entry.fitness,
      generations: entry.generations,
      weights: entry.weights,
    });
  });

  // POST /api/weights - Upload a new weight set
  router.post("/", (req, res) => {
    const { name, author, description, fitness, generations, weights } = req.body;

    if (!name || !weights) {
      return res.status(400).json({ error: "name and weights are required" });
    }

    // Validate weights structure
    if (!weights.layers || !weights.weights || !weights.biases) {
      return res.status(400).json({ error: "Invalid weights format. Expected {layers, weights, biases}" });
    }

    const id = `w${nextId++}`;
    weightLibrary.set(id, {
      name,
      author: author || "Anonymous",
      description: description || "",
      fitness: fitness || 0,
      generations: generations || 0,
      weights,
      downloads: 0,
      createdAt: Date.now(),
    });

    console.log(`[Weights] New weight set "${name}" by ${author || "Anonymous"} (id: ${id})`);
    res.json({ id, name });
  });

  // DELETE /api/weights/:id - Remove a weight set
  router.delete("/:id", (req, res) => {
    if (!weightLibrary.has(req.params.id)) {
      return res.status(404).json({ error: "Weight set not found" });
    }
    weightLibrary.delete(req.params.id);
    res.json({ deleted: true });
  });

  return router;
}

/**
 * Register default weights in the library (called on server start).
 */
export function registerDefaultWeights(weightsJson, meta = {}) {
  const id = "default";
  weightLibrary.set(id, {
    name: meta.name || "Default (Pre-trained)",
    author: meta.author || "System",
    description: meta.description || "Pre-trained weights shipped with the game",
    fitness: meta.fitness || 0,
    generations: meta.generations || 0,
    weights: weightsJson,
    downloads: 0,
    createdAt: Date.now(),
  });
  console.log(`[Weights] Registered default weights`);
}
