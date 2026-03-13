// ═══════════════════════════════════════════════════════════════════════════
//  TRAINING WORKER - Runs neuroevolution in a separate thread
// ═══════════════════════════════════════════════════════════════════════════

import { parentPort, workerData } from "worker_threads";
import { Population } from "../shared/training.js";
import { NeuralNet } from "../shared/neural.js";

const { config, populationJSON } = workerData;

// Restore or create population
let pop;
if (populationJSON) {
  pop = Population.fromJSON(populationJSON);
} else {
  pop = new Population({
    size: config.populationSize,
    layers: config.layers,
    mutationRate: config.mutationRate,
    mutationStrength: config.mutationStrength,
  });
}

// Run one generation
const fitnesses = pop.evaluate(config.gamesPerNet, config.maxTicks);
const result = pop.evolve(fitnesses);
const bestWeights = pop.getBest().toJSON();

// Send results back to main thread
parentPort.postMessage({
  result,
  bestWeights,
  populationJSON: pop.toJSON(),
});
