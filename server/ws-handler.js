// ═══════════════════════════════════════════════════════════════════════════
//  WEBSOCKET HANDLER - Manages WebSocket connections for real-time play
// ═══════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from "ws";

const HEARTBEAT_INTERVAL = 30000;

/**
 * Set up WebSocket server on the given HTTP server.
 * @param {import("http").Server} server
 * @param {import("./lobby.js").Lobby} lobby
 */
export function setupWebSocket(server, lobby) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade requests
  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const gameId = url.searchParams.get("gameId");
      const token = url.searchParams.get("token");

      if (!gameId || !token) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      const room = lobby.getGame(gameId);
      if (!room) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      const slot = room.getPlayerByToken(token);
      if (!slot) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, { gameId, playerId: slot.id, token });
      });
    } catch (err) {
      console.error("[WS] Upgrade error:", err.message);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  // Handle new connections
  wss.on("connection", (ws, _req, { gameId, playerId, token }) => {
    const room = lobby.getGame(gameId);
    if (!room) {
      ws.close(4004, "Game not found");
      return;
    }

    // Attach to game room
    room.connectWs(playerId, ws);

    // Mark alive for heartbeat
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    // Handle incoming messages
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, lobby, room, gameId, playerId, token, msg);
      } catch (err) {
        console.error(`[WS] Message parse error from ${playerId}:`, err.message);
        sendError(ws, "Invalid JSON");
      }
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error for ${playerId} in game ${gameId}:`, err.message);
    });
  });

  // Heartbeat: ping every 30s, terminate unresponsive clients
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  console.log("[WS] WebSocket handler initialized");
  return wss;
}

/**
 * Handle a parsed message from a client.
 */
function handleMessage(ws, lobby, room, gameId, playerId, token, msg) {
  switch (msg.type) {
    case "commands": {
      if (!Array.isArray(msg.commands)) {
        sendError(ws, "commands must be an array");
        return;
      }
      try {
        room.queueCommands(playerId, msg.commands);
        ws.send(JSON.stringify({ type: "ack", accepted: msg.commands.length }));
      } catch (err) {
        sendError(ws, err.message);
      }
      break;
    }

    case "script": {
      if (typeof msg.code !== "string") {
        sendError(ws, "code must be a string");
        return;
      }
      const result = room.submitScript(playerId, msg.code);
      ws.send(JSON.stringify({ type: "scriptResult", ...result }));
      break;
    }

    case "start": {
      try {
        lobby.startGame(gameId, token);
        // Notify all connected players that the game has started
        for (const slot of room.playerSlots) {
          if (slot.ws && slot.ws.readyState === 1) {
            slot.ws.send(JSON.stringify({ type: "started" }));
          }
        }
      } catch (err) {
        sendError(ws, err.message);
      }
      break;
    }

    default:
      sendError(ws, `Unknown message type: ${msg.type}`);
  }
}

/**
 * Send an error message to a WebSocket client.
 */
function sendError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "error", message }));
  }
}
