// ═══════════════════════════════════════════════════════════════════════════
//  GAME ROOM - Manages a single game session
// ═══════════════════════════════════════════════════════════════════════════

import { v4 as uuidv4 } from "uuid";
import {
  initGame,
  tickGame,
  validateCommand,
  applyCommands,
  TICK_MS,
  PLAYER_COLORS,
  ITEMS,
  NeuralNet,
  extractFeatures,
  decodeAction,
  DEFAULT_LAYERS,
} from "../shared/index.js";
import { getPlayerView } from "./state-filter.js";
import { runBotTick } from "./bot-player.js";

const SLOT_IDS = ["p1", "p2", "p3", "p4"];

export class GameRoom {
  /**
   * @param {string} id - Unique game ID
   * @param {import("../shared/index.js").GameConfig} config
   */
  constructor(id, config) {
    this.id = id;
    this.config = config;
    this.state = null;
    this.playerSlots = []; // [{id, name, type, token, ws}]
    this.status = "waiting";
    this.tickInterval = null;
    this.commandQueues = new Map();
    this.scriptFns = new Map();

    // Replay recording: snapshot every REPLAY_INTERVAL ticks
    this.replayFrames = [];
    this.replayInterval = 5; // record every 5 ticks
    this.replayMeta = null; // { players, config, startedAt }

    // Spectators: WebSocket connections that receive all-player view
    this.spectators = new Set();
  }

  /**
   * Add a human (or api) player to the next available slot.
   * @param {string} name
   * @param {string} [type="human"] - "human" or "api"
   * @returns {{ playerId: string, token: string }}
   */
  addPlayer(name, type = "human") {
    if (this.status !== "waiting") {
      throw new Error("Game already started");
    }
    if (this.playerSlots.length >= this.config.playerCount) {
      throw new Error("Game is full");
    }

    const slotIndex = this.playerSlots.length;
    const playerId = SLOT_IDS[slotIndex];
    const token = uuidv4();

    this.playerSlots.push({
      id: playerId,
      name,
      type: type || "human",
      token,
      ws: null,
    });

    this.commandQueues.set(playerId, []);
    return { playerId, token };
  }

  /**
   * Add a bot player to the next available slot.
   * @returns {{ playerId: string }}
   */
  addBot() {
    if (this.status !== "waiting") {
      throw new Error("Game already started");
    }
    if (this.playerSlots.length >= this.config.playerCount) {
      throw new Error("Game is full");
    }

    const slotIndex = this.playerSlots.length;
    const playerId = SLOT_IDS[slotIndex];

    this.playerSlots.push({
      id: playerId,
      name: `Bot ${slotIndex + 1}`,
      type: "bot",
      token: null,
      ws: null,
    });

    return { playerId };
  }

  /**
   * Remove a player from the game.
   * @param {string} playerId
   */
  removePlayer(playerId) {
    const idx = this.playerSlots.findIndex(s => s.id === playerId);
    if (idx === -1) return;

    const slot = this.playerSlots[idx];
    if (slot.ws) {
      try { slot.ws.close(); } catch (_) { /* ignore */ }
    }

    this.commandQueues.delete(playerId);
    this.scriptFns.delete(playerId);

    // Only allow removal in waiting state; during play, mark as disconnected
    if (this.status === "waiting") {
      this.playerSlots.splice(idx, 1);
    }
  }

  /**
   * Start the game. Initializes state and begins tick loop.
   */
  start() {
    if (this.status !== "waiting") {
      throw new Error("Game already started or finished");
    }
    if (this.playerSlots.length < 2) {
      throw new Error("Need at least 2 players to start");
    }

    // Build the config the shared module expects
    const gameConfig = {
      playerCount: this.playerSlots.length,
      enablePvE: this.config.enablePvE ?? false,
      players: this.playerSlots.map((s, i) => ({
        id: s.id,
        name: s.name,
        color: PLAYER_COLORS[i],
        type: s.type,
      })),
    };

    this.state = initGame(gameConfig);
    this.status = "playing";

    // Initialize replay metadata
    this.replayMeta = {
      gameId: this.id,
      players: this.playerSlots.map(s => ({ id: s.id, name: s.name, type: s.type })),
      config: this.config,
      startedAt: Date.now(),
    };

    console.log(`[GameRoom ${this.id}] Game started with ${this.playerSlots.length} players`);

    this.tickInterval = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        console.error(`[GameRoom ${this.id}] Tick error:`, err);
      }
    }, TICK_MS);
  }

  /**
   * Execute one game tick: process commands, run bots, advance state, broadcast.
   */
  tick() {
    if (this.status !== "playing" || !this.state) return;

    // Process human/api command queues
    for (const slot of this.playerSlots) {
      if (slot.type === "bot") {
        // Run bot AI
        const player = this.state.players.find(p => p.id === slot.id);
        if (player && !player.eliminated) {
          runBotTick(player, this.state);
        }
        continue;
      }

      // Check for script-based players
      const scriptFn = this.scriptFns.get(slot.id);
      if (scriptFn) {
        try {
          const view = getPlayerView(this.state, slot.id);
          const commands = this._runScript(scriptFn, view, slot.id);
          if (commands.length > 0) {
            this._applyValidCommands(slot.id, commands);
          }
        } catch (err) {
          console.error(`[GameRoom ${this.id}] Script error for ${slot.id}:`, err.message);
        }
      }

      // Drain command queue for human/api players
      const queue = this.commandQueues.get(slot.id);
      if (queue && queue.length > 0) {
        const commands = queue.splice(0, queue.length);
        this._applyValidCommands(slot.id, commands);
      }
    }

    // Advance game state (tickGame returns new state)
    this.state = tickGame(this.state);

    // Record replay frame at interval
    if (this.state.tick % this.replayInterval === 0) {
      this._recordFrame();
    }

    // Broadcast updated views to players and spectators
    this.broadcastState();
    this._broadcastSpectators();

    // Check game over
    if (this.state.gameOver) {
      this.replayMeta.endedAt = Date.now();
      this.replayMeta.winner = this.state.winner;
      this.replayMeta.ticks = this.state.tick;
      this._recordFrame(); // final frame
      console.log(`[GameRoom ${this.id}] Game over. Winner: ${this.state.winner}`);
      this.status = "finished";
      this.stop();
    }
  }

  /**
   * Validate and apply commands for a player.
   * @param {string} playerId
   * @param {import("../shared/index.js").Command[]} commands
   */
  _applyValidCommands(playerId, commands) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.eliminated) return;

    const valid = [];
    for (const cmd of commands) {
      // Expand unitIds array into individual per-unit commands
      const ids = cmd.unitIds || cmd.unit_ids
        || (cmd.unitId != null ? [cmd.unitId] : (cmd.unit_id != null ? [cmd.unit_id] : []));
      for (const uid of ids) {
        const normalized = {
          cmd: cmd.type || cmd.cmd || cmd.action,
          unitId: uid,
          targetId: cmd.targetId ?? cmd.target_id,
          buildType: cmd.buildType ?? cmd.build_type,
          buildX: cmd.x ?? cmd.buildX,
          buildY: cmd.y ?? cmd.buildY,
          moveX: cmd.x ?? cmd.moveX,
          moveY: cmd.y ?? cmd.moveY,
          tag: cmd.tag,
          craftItem: cmd.craftItem ?? cmd.craft_item,
        };
        if (validateCommand(normalized, player, this.state)) {
          valid.push(normalized);
        }
      }
    }
    if (valid.length > 0) {
      applyCommands(valid, player);
    }
  }

  /**
   * Send each connected player their fog-filtered view.
   */
  broadcastState() {
    for (const slot of this.playerSlots) {
      if (slot.ws && slot.ws.readyState === 1) {
        try {
          const view = getPlayerView(this.state, slot.id);
          slot.ws.send(JSON.stringify({ type: "state", data: view }));
        } catch (err) {
          console.error(`[GameRoom ${this.id}] Broadcast error for ${slot.id}:`, err.message);
        }
      }
    }
  }

  /**
   * Get the fog-filtered view for a specific player.
   * @param {string} playerId
   * @returns {import("../shared/index.js").PlayerView}
   */
  getPlayerView(playerId) {
    if (!this.state) return null;
    return getPlayerView(this.state, playerId);
  }

  /**
   * Queue commands from a player for processing on the next tick.
   * @param {string} playerId
   * @param {import("../shared/index.js").Command[]} commands
   */
  queueCommands(playerId, commands) {
    if (this.status !== "playing") {
      throw new Error("Game is not in progress");
    }
    const queue = this.commandQueues.get(playerId);
    if (!queue) {
      throw new Error("Unknown player");
    }
    for (const cmd of commands) {
      queue.push(cmd);
    }
  }

  /**
   * Compile and store a player script.
   * @param {string} playerId
   * @param {string} code - JavaScript function body. Receives (view) as argument.
   * @returns {{ compiled: boolean, error?: string }}
   */
  /**
   * Run a player script, building an API object the script expects.
   * The script mutates unit objects (v.cmd, v.targetId, etc.) which we
   * capture and convert into command objects.
   */
  _runScript(scriptFn, view, playerId) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return [];

    // Build unit copies, saving original cmd state for diff
    const unitCopies = (view.myUnits || []).map(u => ({
      ...u,
      _origCmd: u.cmd || null,
      _origTargetId: u.targetId,
    }));

    // Find visible enemy TCs
    const enemyTc = (view.visibleTownCenters || [])[0] || null;

    const D = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    const api = {
      villagers: unitCopies.filter(u => u.alive !== false),
      enemies: [
        ...(view.visibleEnemyUnits || []),
        ...(view.neutralEnemies || []),
      ],
      resources: view.resources || [],
      horses: view.visibleHorses || [],
      vehicles: view.myVehicles || [],
      stockpile: { ...(view.myStockpile || {}) },
      buildings: view.myBuildings || [],
      tc: view.myTc || { x: 0, y: 0 },
      enemyTc,
      tick: view.tick || 0,
      popCap: view.myPopCap || 4,
      tech: view.myTech || [],
      memory: player.memory || (player.memory = {}),
      items: ITEMS,
      neural: {
        create: (layers) => new NeuralNet(layers || DEFAULT_LAYERS),
        load: (json) => NeuralNet.fromJSON(json),
        extractFeatures: (apiRef) => extractFeatures(apiRef),
        decodeAction: (output) => decodeAction(output),
        DEFAULT_LAYERS,
      },
      nearbyEnemies: (u, r) => api.enemies.filter(e => D(u, e) <= r),
      pathDist: D,
    };

    scriptFn(api);

    // Collect commands only for units where the script changed something
    const commands = [];
    for (const u of unitCopies) {
      if (!u.cmd) continue;
      // Skip if cmd and target haven't changed (unit is already doing this)
      if (u.cmd === u._origCmd && u.targetId === u._origTargetId
          && u.cmd !== "build" && u.cmd !== "moveTo" && u.cmd !== "ability" && u.cmd !== "craft") continue;
      const cmd = { type: u.cmd, unitIds: [u.id] };
      if (u.cmd === "gather" && u.targetId != null) cmd.targetId = u.targetId;
      if (u.cmd === "attack" && u.targetId != null) cmd.targetId = u.targetId;
      if (u.cmd === "moveTo") { cmd.x = u.moveX; cmd.y = u.moveY; }
      if (u.cmd === "build") { cmd.buildType = u.buildType; cmd.x = u.buildX; cmd.y = u.buildY; }
      if (u.cmd === "craft") { cmd.craftItem = u.craftItem; }
      if (u.cmd === "ability") { /* no extra fields */ }
      if (u.cmd === "mount" && u.targetId != null) cmd.targetId = u.targetId;
      if (u.cmd === "dismount") { /* no extra fields */ }
      if (u.cmd === "crew" && u.targetId != null) cmd.targetId = u.targetId;
      if (u.cmd === "uncrew") { /* no extra fields */ }
      commands.push(cmd);
    }
    return commands;
  }

  submitScript(playerId, code) {
    try {
      // Wrap the user's code: define update(), then call it with the api object
      const wrapped = code + "\nif(typeof update==='function')update(api);";
      const fn = new Function("api", wrapped);
      // Quick sanity test
      fn({ villagers: [], enemies: [], resources: [], stockpile: {}, buildings: [],
           tc: { x: 0, y: 0 }, tick: 0, popCap: 4, tech: [], memory: {}, items: ITEMS,
           neural: { create: () => new NeuralNet(DEFAULT_LAYERS), load: NeuralNet.fromJSON, extractFeatures, decodeAction, DEFAULT_LAYERS },
           nearbyEnemies: () => [], pathDist: () => 999 });
      this.scriptFns.set(playerId, fn);
      return { compiled: true };
    } catch (err) {
      return { compiled: false, error: err.message };
    }
  }

  /**
   * Find a player slot by auth token.
   * @param {string} token
   * @returns {object|null} Player slot or null
   */
  getPlayerByToken(token) {
    return this.playerSlots.find(s => s.token === token) || null;
  }

  /**
   * Attach a WebSocket to a player and set up message handling.
   * @param {string} playerId
   * @param {import("ws").WebSocket} ws
   */
  connectWs(playerId, ws) {
    const slot = this.playerSlots.find(s => s.id === playerId);
    if (!slot) return;

    // Close old connection if any
    if (slot.ws && slot.ws !== ws) {
      try { slot.ws.close(); } catch (_) { /* ignore */ }
    }

    slot.ws = ws;
    console.log(`[GameRoom ${this.id}] Player ${playerId} (${slot.name}) connected via WebSocket`);

    // Send initial state if game is running
    if (this.state) {
      try {
        const view = getPlayerView(this.state, playerId);
        ws.send(JSON.stringify({ type: "state", data: view }));
      } catch (_) { /* ignore */ }
    }

    // Send lobby info if waiting
    if (this.status === "waiting") {
      try {
        ws.send(JSON.stringify({
          type: "lobby",
          data: {
            gameId: this.id,
            config: this.config,
            players: this.playerSlots.map(s => ({ id: s.id, name: s.name, type: s.type })),
            status: this.status,
          },
        }));
      } catch (_) { /* ignore */ }
    }

    ws.on("close", () => {
      console.log(`[GameRoom ${this.id}] Player ${playerId} disconnected`);
      if (slot.ws === ws) {
        slot.ws = null;
      }
    });

    ws.on("error", (err) => {
      console.error(`[GameRoom ${this.id}] WebSocket error for ${playerId}:`, err.message);
    });
  }

  /**
   * Record a compact replay frame from current state.
   */
  _recordFrame() {
    if (!this.state) return;
    const frame = {
      tick: this.state.tick,
      players: this.state.players.map(p => ({
        id: p.id,
        eliminated: p.eliminated,
        stockpile: { ...p.stockpile },
        tcHp: p.tc?.hp ?? 0,
        popCap: p.popCap,
        units: p.units.filter(u => u.alive).map(u => ({
          id: u.id, x: u.x, y: u.y, hp: u.hp, spec: u.spec, cmd: u.cmd,
        })),
        buildings: p.buildings.map(b => ({
          id: b.id, type: b.type, x: b.x, y: b.y, hp: b.hp, built: b.built,
        })),
      })),
      resources: this.state.resources.filter(r => r.amount > 0).map(r => ({
        id: r.id, type: r.type, x: r.x, y: r.y,
      })),
      horses: (this.state.horses || []).filter(h => h.alive).map(h => ({
        id: h.id, x: h.x, y: h.y, tamed: h.tamed, riderId: h.riderId,
      })),
      gameOver: this.state.gameOver,
      winner: this.state.winner,
    };
    this.replayFrames.push(frame);
  }

  /**
   * Get the recorded replay data.
   */
  getReplay() {
    return {
      meta: this.replayMeta,
      frames: this.replayFrames,
    };
  }

  /**
   * Broadcast spectator view (full map, all players visible).
   */
  _broadcastSpectators() {
    if (this.spectators.size === 0) return;
    const data = this._buildSpectatorView();
    const msg = JSON.stringify({ type: "state", data });
    for (const ws of this.spectators) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch (_) { /* ignore */ }
      } else {
        this.spectators.delete(ws);
      }
    }
  }

  /**
   * Build a full spectator view (no fog of war).
   */
  _buildSpectatorView() {
    if (!this.state) return null;
    return {
      tick: this.state.tick,
      spectator: true,
      mapWidth: this.state.mapWidth,
      mapHeight: this.state.mapHeight,
      players: this.state.players.map(p => ({
        id: p.id, name: p.name, color: p.color, eliminated: p.eliminated,
        stockpile: { ...p.stockpile },
        tcHp: p.tc?.hp ?? 0,
        tc: p.tc ? { x: p.tc.x, y: p.tc.y, hp: p.tc.hp, maxHp: p.tc.maxHp } : null,
        unitCount: p.units.filter(u => u.alive).length,
        buildingCount: p.buildings.length,
        popCap: p.popCap,
      })),
      allUnits: this.state.players.flatMap(p =>
        p.units.filter(u => u.alive).map(u => ({
          id: u.id, owner: p.id, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp,
          spec: u.spec, cmd: u.cmd,
        }))
      ),
      allBuildings: this.state.players.flatMap(p =>
        p.buildings.map(b => ({
          id: b.id, owner: p.id, type: b.type, x: b.x, y: b.y, hp: b.hp,
          maxHp: b.maxHp, built: b.built,
        }))
      ),
      resources: this.state.resources.filter(r => r.amount > 0).map(r => ({
        id: r.id, type: r.type, x: r.x, y: r.y,
      })),
      horses: (this.state.horses || []).filter(h => h.alive).map(h => ({
        id: h.id, x: h.x, y: h.y, tamed: h.tamed, riderId: h.riderId, owner: h.owner, alive: h.alive,
      })),
      allVehicles: this.state.players.flatMap(p =>
        (p.vehicles || []).filter(v => v.alive).map(v => ({
          id: v.id, owner: p.id, type: v.type, x: v.x, y: v.y,
          hp: v.hp, maxHp: v.maxHp, crewId: v.crewId,
        }))
      ),
      gameOver: this.state.gameOver,
      winner: this.state.winner,
    };
  }

  /**
   * Add a spectator WebSocket.
   * @param {import("ws").WebSocket} ws
   */
  addSpectator(ws) {
    this.spectators.add(ws);
    console.log(`[GameRoom ${this.id}] Spectator connected (${this.spectators.size} total)`);

    // Send current state immediately
    if (this.state) {
      try {
        ws.send(JSON.stringify({ type: "state", data: this._buildSpectatorView() }));
      } catch (_) { /* ignore */ }
    }

    ws.on("close", () => {
      this.spectators.delete(ws);
      console.log(`[GameRoom ${this.id}] Spectator disconnected`);
    });
    ws.on("error", () => this.spectators.delete(ws));
  }

  /**
   * Stop the game loop and notify all players.
   */
  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    for (const slot of this.playerSlots) {
      if (slot.ws && slot.ws.readyState === 1) {
        try {
          slot.ws.send(JSON.stringify({
            type: "gameOver",
            data: {
              winner: this.state?.winner ?? null,
              stats: this.state?.players?.map(p => ({ id: p.id, stats: p.stats })) ?? [],
            },
          }));
        } catch (_) { /* ignore */ }
      }
    }

    // Notify spectators
    for (const ws of this.spectators) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({
            type: "gameOver",
            data: { winner: this.state?.winner ?? null },
          }));
        } catch (_) { /* ignore */ }
      }
    }

    console.log(`[GameRoom ${this.id}] Game stopped`);
  }
}
