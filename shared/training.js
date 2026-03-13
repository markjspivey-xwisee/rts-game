// ═══════════════════════════════════════════════════════════════════════════
//  NEUROEVOLUTION TRAINING HARNESS
// ═══════════════════════════════════════════════════════════════════════════

import { NeuralNet } from "./neural.js";
import { extractFeatures, decodeAction, DEFAULT_LAYERS } from "./features.js";
import { initGame } from "./game-state.js";
import { tickGame } from "./tick.js";
import { validateCommand, applyCommands } from "./commands.js";
import { BLD } from "./buildings.js";
import { ITEMS } from "./items.js";

/**
 * Score a player's performance in a finished game.
 * @param {object} player - Player object from game state
 * @param {object} gameState - Final game state
 * @returns {number} Fitness score
 */
export function scoreFitness(player, gameState) {
  const s = player.stats || {};
  const g = s.gathered || {};
  let score = 0;

  // Resource gathering
  score += (g.wood || 0) * 0.1;
  score += (g.stone || 0) * 0.15;
  score += (g.gold || 0) * 0.3;
  score += (g.food || 0) * 0.1;

  // Economy & military
  score += (s.built || 0) * 5;
  score += (s.kills || 0) * 3;
  score -= (s.deaths || 0) * 2;
  score += (s.maxPop || 0) * 2;

  // TC survival
  if (player.tc) {
    score += (player.tc.hp / (player.tc.maxHp || 500)) * 50;
  }

  // Win/loss
  if (gameState.winner === player.id) score += 200;
  if (player.eliminated) score -= 100;

  // Survival time
  score += Math.min(gameState.tick / 100, 20);

  // ── Building diversity bonus ──
  // Reward having a variety of building types (not just houses)
  const builtTypes = new Set(player.buildings.filter(b => b.built).map(b => b.type));
  score += builtTypes.size * 8; // 8 points per unique building type
  if (builtTypes.has("farm")) score += 10;
  if (builtTypes.has("workshop")) score += 15;
  if (builtTypes.has("market")) score += 10;
  if (builtTypes.has("tower")) score += 10;

  // Penalize house spam (more than 4 houses with fewer than 3 other building types)
  const houseCount = player.buildings.filter(b => b.type === "house" && b.built).length;
  const otherTypes = builtTypes.size - (builtTypes.has("house") ? 1 : 0);
  if (houseCount > 4 && otherTypes < 3) score -= (houseCount - 4) * 5;

  // ── Crafting/tech bonus ──
  const equippedUnits = player.units.filter(u => u.alive && (u.equip?.weapon || u.equip?.tool));
  score += equippedUnits.length * 5;

  return score;
}

/**
 * Apply neural net decisions to a player's units for one tick.
 * Uses smart heuristics to supplement neural net decisions for build order,
 * crafting, and resource priority.
 */
function applyNeuralDecision(api, decision, player, state) {
  const alive = api.villagers.filter(v => v.alive !== false);
  const threats = api.enemies.filter(e => api.pathDist(e, api.tc) < 14);
  const milTarget = Math.max(2, Math.round(decision.militaryRatio * alive.length));
  const D = api.pathDist;
  const stk = api.stockpile;

  let milCount = 0;
  let bldCount = 0;

  for (const v of alive) {
    if (v.tag === "mil") milCount++;
    if (v.tag === "bld") bldCount++;
  }

  // ── Count existing buildings ──
  const builtOf = (type) => api.buildings.filter(b => b.type === type && b.built).length;
  const pendingOf = (type) => api.buildings.filter(b => b.type === type && !b.built).length;
  const hasOrPending = (type) => builtOf(type) > 0 || pendingOf(type) > 0;

  const houseCount = builtOf("house");
  const farmCount = builtOf("farm");
  const barracksCount = builtOf("barracks");
  const workshopCount = builtOf("workshop");
  const marketCount = builtOf("market");
  const towerCount = builtOf("tower");
  const currentPop = alive.length;
  const needMorePop = currentPop >= (api.popCap || 4) - 2;

  // ── SMART BUILD QUEUE ──
  const smartBuildQueue = [];
  if (!hasOrPending("farm") && currentPop >= 3) smartBuildQueue.push("farm");
  if (!hasOrPending("barracks") && currentPop >= 4) smartBuildQueue.push("barracks");
  if (needMorePop && houseCount < 6 && !pendingOf("house")) smartBuildQueue.push("house");
  if (barracksCount > 0 && !hasOrPending("workshop")) smartBuildQueue.push("workshop");
  if (workshopCount > 0 && !hasOrPending("market")) smartBuildQueue.push("market");
  if (workshopCount > 0 && !hasOrPending("stable")) smartBuildQueue.push("stable");
  const farmTarget = Math.ceil(currentPop / 6);
  if (farmCount < farmTarget && farmCount < 4 && !pendingOf("farm")) smartBuildQueue.push("farm");
  if (workshopCount > 0 && towerCount < 2 && !pendingOf("tower")) smartBuildQueue.push("tower");
  if (barracksCount > 0 && barracksCount < 2 && currentPop >= 10 && !pendingOf("barracks")) smartBuildQueue.push("barracks");

  // Filter neural net builds (block excessive houses)
  const netBuilds = (decision.buildOrders || []).filter(b => {
    if (b === "house" && !needMorePop) return false;
    if (b === "house" && houseCount >= 6) return false;
    return true;
  });
  const finalBuildQueue = [...new Set([...smartBuildQueue, ...netBuilds])];

  const canAfford = (type) => {
    const bd = BLD[type];
    if (!bd) return false;
    return Object.entries(bd.cost).every(([r, a]) => (stk[r] || 0) >= a);
  };

  const commands = [];

  for (const v of alive) {
    // Auto-tag: 2-3 builders
    if (!v.tag) {
      const builderTarget = currentPop >= 8 ? 3 : 2;
      if (v.spec === "warrior") v.tag = "mil";
      else if (bldCount < builderTarget) { v.tag = "bld"; bldCount++; }
      else if (milCount < milTarget) { v.tag = "mil"; milCount++; }
      else v.tag = "eco";
    }

    let cmd = null;

    // Defend
    if (threats.length > 0) {
      let best = null, bestD = 999;
      for (const e of threats) {
        const d = D(v, e);
        if (d < bestD) { best = e; bestD = d; }
      }
      if (v.tag === "mil" || bestD < 5) {
        cmd = { cmd: "attack", unitId: v.id, targetId: best.id };
      }
    }

    // Attack signal
    if (!cmd && decision.shouldAttack && v.tag === "mil" && api.enemyTc) {
      cmd = { cmd: "moveTo", unitId: v.id, moveX: api.enemyTc.x, moveY: api.enemyTc.y };
    }

    // Always craft when possible (don't wait for neural net signal)
    if (!cmd && v.spec === "warrior" && !v.equip?.weapon) {
      const hasBks = api.buildings.some(b => b.type === "barracks" && b.built);
      const hasTech = api.tech.includes("warrior_training");
      if (hasBks && hasTech && stk.stone >= 20 && stk.gold >= 10) {
        cmd = { cmd: "craft", unitId: v.id, craftItem: "sword" };
      }
    }
    if (!cmd && ["lumberjack", "miner", "farmer"].includes(v.spec) && !v.equip?.tool) {
      const hasWks = api.buildings.some(b => b.type === "workshop" && b.built);
      if (hasWks) {
        const toolMap = { lumberjack: "iron_axe", miner: "iron_pickaxe", farmer: "sickle" };
        const item = toolMap[v.spec];
        const cost = ITEMS[item]?.cost || {};
        if (Object.entries(cost).every(([r, a]) => (stk[r] || 0) >= a)) {
          cmd = { cmd: "craft", unitId: v.id, craftItem: item };
        }
      }
    }
    if (!cmd && v.spec === "warrior" && v.equip?.weapon && !v.equip?.armor) {
      const hasBks = api.buildings.some(b => b.type === "barracks" && b.built);
      if (hasBks && stk.food >= 20 && stk.gold >= 5) {
        cmd = { cmd: "craft", unitId: v.id, craftItem: "leather_armor" };
      }
    }

    // Build from smart queue
    if (!cmd && v.tag === "bld" && finalBuildQueue.length > 0) {
      for (const bType of finalBuildQueue) {
        if (canAfford(bType)) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 4 + Math.random() * 6;
          cmd = {
            cmd: "build", unitId: v.id, buildType: bType,
            buildX: Math.round(api.tc.x + Math.cos(angle) * dist),
            buildY: Math.round(api.tc.y + Math.sin(angle) * dist),
          };
          break;
        }
      }
    }

    // Gather with heuristic boost
    if (!cmd) {
      const gp = { ...decision.gatherPriority };
      if (stk.food < 30) gp.food = Math.max(gp.food || 0, 0.9);
      if (stk.wood < 20) gp.wood = Math.max(gp.wood || 0, 0.8);
      const types = ["wood", "stone", "gold", "food"];
      types.sort((a, b) => (gp[b] || 0) - (gp[a] || 0));
      for (const gt of types) {
        const tgt = api.resources
          .filter(r => r.type === gt && r.amount > 0)
          .sort((a, b) => D(a, v) - D(b, v))[0];
        if (tgt) {
          cmd = { cmd: "gather", unitId: v.id, targetId: tgt.id };
          break;
        }
      }
    }

    if (!cmd) cmd = { cmd: "idle", unitId: v.id };
    commands.push(cmd);
  }

  const valid = commands.filter(c => validateCommand(c, player, state));
  if (valid.length > 0) applyCommands(valid, player);
}

/**
 * Build a script-like API object for a player (used in headless training).
 */
function buildApi(player, state, memory) {
  const D = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const enemies = [];
  for (const op of state.players) {
    if (op.id === player.id) continue;
    for (const u of op.units) {
      if (u.alive) enemies.push(u);
    }
  }
  for (const e of (state.enemies || [])) {
    if (e.alive) enemies.push(e);
  }

  // Find visible enemy TCs (simplified: just use first opponent's TC)
  const enemyTc = state.players.find(p => p.id !== player.id && !p.eliminated)?.tc || null;

  const tech = [];
  for (const b of player.buildings) {
    if (!b.built) continue;
    if (b.type === "barracks") tech.push("warrior_training");
    if (b.type === "workshop") tech.push("tower");
    if (b.type === "market") tech.push("trade");
    if (b.type === "stable") tech.push("horsemanship");
  }

  return {
    villagers: player.units.filter(u => u.alive).map(u => ({ ...u, equip: { ...(u.equip || {}) } })),
    enemies,
    resources: state.resources.filter(r => r.amount > 0),
    horses: (state.horses || []).filter(h => h.alive),
    vehicles: player.vehicles || [],
    stockpile: { ...player.stockpile },
    buildings: player.buildings,
    tc: player.tc,
    enemyTc,
    tick: state.tick,
    popCap: player.popCap || 4,
    tech,
    items: ITEMS,
    memory,
    nearbyEnemies: (u, r) => enemies.filter(e => D(u, e) <= r),
    pathDist: D,
  };
}

/**
 * Run a headless game between two neural nets.
 * @param {NeuralNet} netA
 * @param {NeuralNet} netB
 * @param {number} [maxTicks=1200]
 * @returns {{ fitnessA: number, fitnessB: number, winner: string|null, ticks: number }}
 */
export function runTrainingGame(netA, netB, maxTicks = 1200) {
  const config = {
    playerCount: 2,
    enablePvE: false,
    players: [
      { id: "p1", name: "Net-A", color: "#4488ff", type: "human" },
      { id: "p2", name: "Net-B", color: "#ff4444", type: "human" },
    ],
  };

  let state = initGame(config);
  const memA = {};
  const memB = {};

  for (let t = 0; t < maxTicks; t++) {
    const pA = state.players.find(p => p.id === "p1");
    const pB = state.players.find(p => p.id === "p2");

    // Run net A
    if (pA && !pA.eliminated) {
      const apiA = buildApi(pA, state, memA);
      const featA = extractFeatures(apiA);
      const outA = netA.forward(featA);
      const decA = decodeAction(outA);
      applyNeuralDecision(apiA, decA, pA, state);
    }

    // Run net B
    if (pB && !pB.eliminated) {
      const apiB = buildApi(pB, state, memB);
      const featB = extractFeatures(apiB);
      const outB = netB.forward(featB);
      const decB = decodeAction(outB);
      applyNeuralDecision(apiB, decB, pB, state);
    }

    state = tickGame(state);

    if (state.gameOver) break;
  }

  const pA = state.players.find(p => p.id === "p1");
  const pB = state.players.find(p => p.id === "p2");

  return {
    fitnessA: scoreFitness(pA, state),
    fitnessB: scoreFitness(pB, state),
    winner: state.winner || null,
    ticks: state.tick,
  };
}

/**
 * Neuroevolution population manager.
 */
export class Population {
  /**
   * @param {object} opts
   * @param {number} [opts.size=50] - Population size
   * @param {number[]} [opts.layers=[45,32,16,13]] - Network architecture
   * @param {number} [opts.mutationRate=0.1]
   * @param {number} [opts.mutationStrength=0.3]
   */
  constructor(opts = {}) {
    this.size = opts.size || 50;
    this.layers = opts.layers || [...DEFAULT_LAYERS];
    this.mutationRate = opts.mutationRate || 0.1;
    this.mutationStrength = opts.mutationStrength || 0.3;
    this.generation = 0;
    this.history = [];

    this.nets = [];
    for (let i = 0; i < this.size; i++) {
      this.nets.push(new NeuralNet(this.layers));
    }
  }

  /**
   * Evaluate all nets by running round-robin matches.
   * Each net plays against a random subset of opponents.
   * @param {number} [gamesPerNet=4] - Number of games each net plays
   * @param {number} [maxTicks=1200]
   * @returns {number[]} Fitness scores indexed by net
   */
  evaluate(gamesPerNet = 4, maxTicks = 1200) {
    const fitnesses = new Float64Array(this.size);

    for (let i = 0; i < this.size; i++) {
      for (let g = 0; g < gamesPerNet; g++) {
        // Pick a random opponent (not self)
        let j = i;
        while (j === i) j = Math.floor(Math.random() * this.size);

        const result = runTrainingGame(this.nets[i], this.nets[j], maxTicks);
        fitnesses[i] += result.fitnessA;
        fitnesses[j] += result.fitnessB;
      }
    }

    // Average over games played
    for (let i = 0; i < this.size; i++) {
      fitnesses[i] /= gamesPerNet;
    }

    return Array.from(fitnesses);
  }

  /**
   * Tournament selection.
   * @param {number[]} fitnesses
   * @param {number} [tournSize=3]
   * @returns {number} Index of selected net
   */
  _tournamentSelect(fitnesses, tournSize = 3) {
    let bestIdx = Math.floor(Math.random() * this.size);
    let bestFit = fitnesses[bestIdx];
    for (let t = 1; t < tournSize; t++) {
      const idx = Math.floor(Math.random() * this.size);
      if (fitnesses[idx] > bestFit) {
        bestIdx = idx;
        bestFit = fitnesses[idx];
      }
    }
    return bestIdx;
  }

  /**
   * Evolve to the next generation using tournament selection + crossover + mutation.
   * @param {number[]} fitnesses
   * @returns {{ bestFitness: number, avgFitness: number, generation: number }}
   */
  evolve(fitnesses) {
    // Sort indices by fitness
    const indices = fitnesses.map((f, i) => i);
    indices.sort((a, b) => fitnesses[b] - fitnesses[a]);

    const eliteCount = Math.max(2, Math.floor(this.size * 0.1));
    const newNets = [];

    // Elitism: carry top performers
    for (let i = 0; i < eliteCount; i++) {
      newNets.push(this.nets[indices[i]].clone());
    }

    // Fill rest with offspring
    while (newNets.length < this.size) {
      const parentA = this._tournamentSelect(fitnesses);
      const parentB = this._tournamentSelect(fitnesses);
      const child = this.nets[parentA].crossover(this.nets[parentB]);
      child.mutate(this.mutationRate, this.mutationStrength);
      newNets.push(child);
    }

    this.nets = newNets;
    this.generation++;

    const best = fitnesses[indices[0]];
    const avg = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;

    this.history.push({ generation: this.generation, bestFitness: best, avgFitness: avg });

    return { bestFitness: best, avgFitness: avg, generation: this.generation };
  }

  /**
   * Run one full generation: evaluate + evolve.
   * @param {number} [gamesPerNet=4]
   * @param {number} [maxTicks=1200]
   * @returns {{ bestFitness: number, avgFitness: number, generation: number }}
   */
  runGeneration(gamesPerNet = 4, maxTicks = 1200) {
    const fitnesses = this.evaluate(gamesPerNet, maxTicks);
    return this.evolve(fitnesses);
  }

  /**
   * Get the best net from the current population (by last evaluation).
   * @returns {NeuralNet}
   */
  getBest() {
    // Clone the first net (after evolve, index 0 is the best from elitism)
    return this.nets[0].clone();
  }

  /**
   * Serialize population for saving.
   * @returns {object}
   */
  toJSON() {
    return {
      size: this.size,
      layers: this.layers,
      mutationRate: this.mutationRate,
      mutationStrength: this.mutationStrength,
      generation: this.generation,
      history: this.history,
      nets: this.nets.map(n => n.toJSON()),
    };
  }

  /**
   * Restore population from saved data.
   * @param {object} json
   * @returns {Population}
   */
  static fromJSON(json) {
    const pop = Object.create(Population.prototype);
    pop.size = json.size;
    pop.layers = json.layers;
    pop.mutationRate = json.mutationRate;
    pop.mutationStrength = json.mutationStrength;
    pop.generation = json.generation;
    pop.history = json.history || [];
    pop.nets = json.nets.map(n => NeuralNet.fromJSON(n));
    return pop;
  }
}
