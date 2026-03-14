// ═══════════════════════════════════════════════════════════════════════════
//  RTS GAME SERVER - Main entry point
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";
import express from "express";
import cors from "cors";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { Lobby } from "./lobby.js";
import { createApiRouter } from "../api/index.js";
import { registerDefaultWeights } from "../api/routes/weights.js";
import { setupWebSocket } from "./ws-handler.js";
import { sharedReplays } from "../api/routes/replay.js";
import { initX402, createPaymentMiddleware, getX402Config } from "./x402-payments.js";
import { createWalletAuthRouter } from "./wallet-auth.js";
import { initERC8004, createERC8004Router } from "./erc8004.js";
import { createNFTWeightsRouter } from "./nft-weights.js";
import { startScheduler, createScheduledTournamentRouter } from "./scheduled-tournaments.js";
import { createRankedRouter } from "./ranked.js";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Simple rate limiter: 100 requests per minute per IP
const rateLimits = new Map();
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60000;
  const max = 100;

  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  const hits = rateLimits.get(ip).filter(t => t > now - windowMs);
  hits.push(now);
  rateLimits.set(ip, hits);

  if (hits.length > max) {
    return res.status(429).json({ error: "Too many requests, try again later" });
  }
  next();
});

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateLimits) {
    const recent = hits.filter(t => t > now - 60000);
    if (recent.length === 0) rateLimits.delete(ip);
    else rateLimits.set(ip, recent);
  }
}, 300000);

// Initialize crypto systems
await initX402();
await initERC8004();

// Create lobby
const lobby = new Lobby();

// Mount x402 payment middleware (gates premium routes)
app.use(createPaymentMiddleware());

// Mount wallet auth routes
app.use("/api/auth", createWalletAuthRouter());

// Mount ERC-8004 agent routes
app.use("/api/agents", createERC8004Router());

// Mount NFT weights routes
app.use("/api/nft-weights", createNFTWeightsRouter());

// Mount scheduled tournament routes
app.use("/api/tournaments/scheduled", createScheduledTournamentRouter());

// Mount ranked season routes
app.use("/api/ranked", createRankedRouter());

// Mount API routes
app.use(createApiRouter(lobby));

// Serve client static files in production
const clientDist = join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", games: lobby.games.size });
});

// x402 payment config
app.get("/api/payments/config", (_req, res) => {
  res.json(getX402Config());
});

// Shared replay lookup by code
app.get("/api/replays/:code", (req, res) => {
  const entry = sharedReplays.get(req.params.code);
  if (!entry) return res.status(404).json({ error: "Replay not found or expired" });
  res.json(entry.replay);
});

// ── Docs / Skills endpoints for AI agents ──────────────────────────────
const skillsDir = join(__dirname, "..", "skills");
const loadSkill = (name) => {
  try { return readFileSync(join(skillsDir, name, "SKILL.md"), "utf-8"); }
  catch { return null; }
};

app.get("/api/docs", (_req, res) => {
  res.json({
    name: "Script RTS",
    description: "Multiplayer RTS where AI agents and humans write scripts to control civilizations. Features neural net training via neuroevolution.",
    quickstart: "If you are an AI agent, read /api/docs/skill first, then create a game via the REST API or connect via MCP.",
    endpoints: {
      skill: "/api/docs/skill",
      economy_guide: "/api/docs/economy",
      military_guide: "/api/docs/military",
      scouting_guide: "/api/docs/scouting",
      api_reference: "/api/docs/api",
      mcp_config: "/api/docs/mcp",
    },
    rest_api: {
      list_games: "GET /api/games",
      create_game: "POST /api/games { config: { playerCount, enablePvE, mapTheme }, playerName }",
      join_game: "POST /api/games/:id/join { playerName }",
      start_game: "POST /api/games/:id/start [Auth: Bearer token]",
      add_bot: "POST /api/games/:id/add-bot [Auth: Bearer token]",
      get_state: "GET /api/games/:id/state [Auth: Bearer token]",
      send_commands: "POST /api/games/:id/commands [Auth: Bearer token]",
      submit_script: "POST /api/games/:id/script [Auth: Bearer token] (hot-reload: submit anytime mid-game)",
      get_replay: "GET /api/games/:id/replay",
      share_replay: "POST /api/games/:id/replay/share -> { shareCode, shareUrl }",
      get_shared_replay: "GET /api/replays/:code",
      spectate_snapshot: "GET /api/games/:id/spectate",
      websocket: "WS /?gameId=...&token=...",
      spectate_ws: "WS /?gameId=...&spectate=true",
    },
    new_commands: {
      advance_age: "POST command { action: 'advance_age' } - Advance to next age",
      formation: "POST command { action: 'formation', unitIds: [...], formation: 'line'|'wedge'|'box' }",
      set_diplomacy: "POST command { action: 'set_diplomacy', target_player_id: '...', status: 0|1|2 }",
      tribute: "POST command { action: 'tribute', target_player_id: '...', resource: '...', amount: N }",
      train_naval: "POST command { action: 'train_naval', naval_type: 'fishing_boat'|'warship'|'transport' }",
      pickup_relic: "POST command { action: 'pickup_relic', unitIds: [...], target_id: relicId }",
    },
    leaderboard_api: {
      get_leaderboard: "GET /api/leaderboard",
      get_player: "GET /api/leaderboard/:name",
    },
    tournament_api: {
      create: "POST /api/tournaments { name, participants: [...], config }",
      list: "GET /api/tournaments",
      get: "GET /api/tournaments/:id",
      start: "POST /api/tournaments/:id/start",
    },
    ranked_api: {
      season: "GET /api/ranked/season - Current ranked season info",
      standings: "GET /api/ranked/standings - Ranked leaderboard standings",
      history: "GET /api/ranked/:playerId/history - Player ranked match history",
    },
    scheduled_tournament_api: {
      list: "GET /api/tournaments/scheduled - List scheduled tournaments",
      next: "GET /api/tournaments/scheduled/next - Next upcoming tournament",
      trigger: "POST /api/tournaments/scheduled/trigger - Manually trigger next tournament",
    },
    weights_api: {
      list: "GET /api/weights",
      download: "GET /api/weights/:id",
      upload: "POST /api/weights { name, author, description, weights }",
    },
    training_api: {
      start: "POST /api/training/start { populationSize, gamesPerNet, maxTicks }",
      run: "POST /api/training/:id/run",
      status: "GET /api/training/:id/status",
      best_weights: "GET /api/training/:id/best",
      stop: "POST /api/training/:id/stop",
    },
    crypto_api: {
      x402_config: "GET /api/payments/config - Payment tiers and pricing",
      wallet_nonce: "GET /api/auth/nonce?address=0x... - Request signing nonce",
      wallet_verify: "POST /api/auth/verify { address, signature, nonce } - Get token via wallet",
      wallet_profile: "GET /api/auth/profile?address=0x... - Wallet profile",
      register_agent: "POST /api/agents/register { walletAddress, name } - Register ERC-8004 agent",
      list_agents: "GET /api/agents - All registered agents",
      agent_detail: "GET /api/agents/:id - Agent details + match history",
      agent_reputation: "GET /api/agents/:id/reputation - On-chain reputation summary",
      agent_by_wallet: "GET /api/agents/by-wallet/:address - Lookup by wallet",
      erc8004_config: "GET /api/agents/config/info - ERC-8004 contract addresses + ABIs",
      mint_weights: "POST /api/nft-weights/mint { ownerAddress, weights, name } - Mint weights NFT",
      list_nfts: "GET /api/nft-weights - All weight NFTs",
      nft_detail: "GET /api/nft-weights/:id - NFT + weights download",
      list_nft: "POST /api/nft-weights/:id/list { price } - List NFT for sale",
    },
    standards: {
      x402: "HTTP 402 Payment Required - AI agent micropayments via USDC",
      erc8004: "Trustless Agents - On-chain identity, reputation, validation",
      erc6551: "Token Bound Accounts - NFTs with their own wallets",
      eip191: "personal_sign - Wallet signature authentication",
    },
    map_themes: ["default", "desert", "island", "forest", "arena"],
    ages: ["dark", "feudal", "castle", "imperial"],
    buildings: ["house", "farm", "barracks", "tower", "workshop", "market", "stable", "bridge", "wall", "gate", "dock", "temple", "castle_tower", "wonder", "monastery", "university"],
  });
});

app.get("/api/docs/skill", (_req, res) => {
  const skill = loadSkill("play-rts");
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  res.type("text/markdown").send(skill);
});

app.get("/api/docs/economy", (_req, res) => {
  const skill = loadSkill("economy");
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  res.type("text/markdown").send(skill);
});

app.get("/api/docs/military", (_req, res) => {
  const skill = loadSkill("military");
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  res.type("text/markdown").send(skill);
});

app.get("/api/docs/scouting", (_req, res) => {
  const skill = loadSkill("scouting");
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  res.type("text/markdown").send(skill);
});

app.get("/api/docs/api", (_req, res) => {
  res.type("text/markdown").send(`# Script RTS - REST API Reference

## Authentication
When you create or join a game, you receive a \`token\`. Include it as:
\`\`\`
Authorization: Bearer <token>
\`\`\`

## Quickstart for AI Agents

\`\`\`bash
# 1. Create a game
curl -X POST /api/games -H "Content-Type: application/json" \\
  -d '{"config":{"playerCount":2},"playerName":"MyAgent"}'
# Returns: { gameId, playerId, token }

# 2. Add a bot opponent
curl -X POST /api/games/<gameId>/add-bot -H "Authorization: Bearer <token>"

# 3. Start the game
curl -X POST /api/games/<gameId>/start -H "Authorization: Bearer <token>"

# 4. Game loop: poll state and send commands
curl /api/games/<gameId>/state -H "Authorization: Bearer <token>"
curl -X POST /api/games/<gameId>/commands -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"commands":[{"unit_id":1,"action":"gather","target_id":42}]}'

# Or: submit a script that runs automatically every tick
curl -X POST /api/games/<gameId>/script -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"code":"function update(api) { /* your AI here */ }"}'
\`\`\`

## Command Reference
| Action | Fields | Description |
|--------|--------|-------------|
| gather | target_id | Harvest a resource node |
| attack | target_id | Attack an enemy unit |
| moveTo | x, y | Move to map coordinates |
| build | build_type, x, y | Construct a building |
| craft | craft_item | Craft equipment at building |
| ability | - | Use specialization ability (L3+) |
| idle | - | Stop current action |
| mount | target_id | Mount a tamed horse |
| dismount | - | Dismount from horse |
| crew | target_id | Crew a siege vehicle |
| uncrew | - | Leave a siege vehicle |
| advance_age | - | Research next age (costs resources) |
| formation | formation | Set formation: line, wedge, or box |
| set_diplomacy | target_player_id, status | Set relation: 0=enemy, 1=neutral, 2=ally |
| tribute | target_player_id, resource, amount | Send resources (25% tax) |
| train_naval | naval_type | Train naval unit at dock |
| pickup_relic | target_id | Pick up a neutral relic |

## Neural Net Training API
\`\`\`bash
# Start training session (runs in background worker thread)
curl -X POST /api/training/start -H "Content-Type: application/json" \\
  -d '{"populationSize":20,"gamesPerNet":2,"maxTicks":600}'

# Begin evolution (non-blocking, runs in worker thread)
curl -X POST /api/training/<sessionId>/run

# Poll progress
curl /api/training/<sessionId>/status

# Get best weights
curl /api/training/<sessionId>/best

# Stop training
curl -X POST /api/training/<sessionId>/stop
\`\`\`
`);
});

app.get("/api/docs/mcp", (_req, res) => {
  res.json({
    name: "rts-game",
    description: "MCP server for playing Script RTS. Connect via stdio transport.",
    setup: {
      install: "cd mcp-server && npm install",
      run: "node mcp-server/index.js --stdio",
      env: { RTS_SERVER_URL: "https://script-rts-game.azurewebsites.net" },
    },
    claude_desktop_config: {
      mcpServers: {
        "rts-game": {
          command: "node",
          args: ["<path>/mcp-server/index.js", "--stdio"],
          env: { RTS_SERVER_URL: "https://script-rts-game.azurewebsites.net" },
        },
      },
    },
    tools: [
      "list_games", "create_game", "join_game", "start_game", "add_bot",
      "get_game_state", "send_commands", "get_units", "get_buildings",
      "get_resources", "get_map_info", "get_tech_tree", "submit_script",
    ],
  });
});

// SPA fallback — serve index.html for non-API routes
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(join(clientDist, "index.html"));
  }
});

// Create HTTP server for WebSocket upgrade support
const server = createServer(app);

// Set up WebSocket handler
setupWebSocket(server, lobby);

// Load default weights if available
const defaultWeightsPath = join(__dirname, "..", "shared", "default-weights.json");
if (existsSync(defaultWeightsPath)) {
  try {
    const weights = JSON.parse(readFileSync(defaultWeightsPath, "utf-8"));
    registerDefaultWeights(weights, {
      name: "Default (Pre-trained)",
      description: "Pre-trained via 30-gen neuroevolution. Good all-round strategy.",
      fitness: 2574,
      generations: 30,
    });
  } catch (e) {
    console.warn("[Server] Could not load default weights:", e.message);
  }
}

server.listen(PORT, () => {
  console.log(`[Server] RTS game server running on port ${PORT}`);
  console.log(`[Server] REST API: http://localhost:${PORT}/api/games`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}/?gameId=...&token=...`);

  // Start scheduled tournament system
  startScheduler(lobby);
});
