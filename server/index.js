// ═══════════════════════════════════════════════════════════════════════════
//  RTS GAME SERVER - Main entry point
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
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
