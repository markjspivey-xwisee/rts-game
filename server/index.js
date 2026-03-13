// ═══════════════════════════════════════════════════════════════════════════
//  RTS GAME SERVER - Main entry point
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import express from "express";
import cors from "cors";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { Lobby } from "./lobby.js";
import { createApiRouter } from "../api/index.js";
import { setupWebSocket } from "./ws-handler.js";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Create lobby
const lobby = new Lobby();

// Mount API routes
app.use(createApiRouter(lobby));

// Serve client static files in production
const clientDist = join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", games: lobby.games.size });
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
      create_game: "POST /api/games { config: { playerCount, enablePvE }, playerName }",
      join_game: "POST /api/games/:id/join { playerName }",
      start_game: "POST /api/games/:id/start [Auth: Bearer token]",
      add_bot: "POST /api/games/:id/add-bot [Auth: Bearer token]",
      get_state: "GET /api/games/:id/state [Auth: Bearer token]",
      send_commands: "POST /api/games/:id/commands [Auth: Bearer token]",
      submit_script: "POST /api/games/:id/script [Auth: Bearer token]",
      websocket: "WS /?gameId=...&token=...",
    },
    training_api: {
      start: "POST /api/training/start { populationSize, gamesPerNet, maxTicks }",
      run: "POST /api/training/:id/run",
      status: "GET /api/training/:id/status",
      best_weights: "GET /api/training/:id/best",
      stop: "POST /api/training/:id/stop",
    },
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

server.listen(PORT, () => {
  console.log(`[Server] RTS game server running on port ${PORT}`);
  console.log(`[Server] REST API: http://localhost:${PORT}/api/games`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}/?gameId=...&token=...`);
});
