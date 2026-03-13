// ═══════════════════════════════════════════════════════════════════════════
//  HTTP Client for RTS Game API
// ═══════════════════════════════════════════════════════════════════════════

const BASE_URL = process.env.RTS_SERVER_URL || process.env.RTS_API_URL || "http://localhost:3000";

/** Stores tokens per gameId */
const tokens = new Map();

async function request(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function listGames() {
  return request("GET", "/api/games");
}

export async function createGame(playerName, playerCount = 2, enablePvE = false) {
  const data = await request("POST", "/api/games", {
    config: { playerCount, enablePvE },
    playerName,
  });
  if (data.token) tokens.set(data.gameId, data.token);
  return data;
}

export async function joinGame(gameId, playerName) {
  const data = await request("POST", `/api/games/${gameId}/join`, { playerName });
  if (data.token) tokens.set(gameId, data.token);
  return data;
}

export async function startGame(gameId) {
  const token = tokens.get(gameId);
  return request("POST", `/api/games/${gameId}/start`, null, token);
}

export async function addBot(gameId) {
  const token = tokens.get(gameId);
  return request("POST", `/api/games/${gameId}/add-bot`, null, token);
}

export async function getState(gameId) {
  const token = tokens.get(gameId);
  return request("GET", `/api/games/${gameId}/state`, null, token);
}

export async function sendCommands(gameId, commands) {
  const token = tokens.get(gameId);
  return request("POST", `/api/games/${gameId}/commands`, { commands }, token);
}

export async function submitScript(gameId, code) {
  const token = tokens.get(gameId);
  return request("POST", `/api/games/${gameId}/script`, { code }, token);
}

export async function getLog(gameId) {
  const token = tokens.get(gameId);
  return request("GET", `/api/games/${gameId}/log`, null, token);
}

export function getToken(gameId) {
  return tokens.get(gameId);
}
