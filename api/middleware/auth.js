// ═══════════════════════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE - Extract and validate player tokens
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates middleware that reads Bearer token from Authorization header,
 * looks up the player in the lobby, and attaches req.playerId, req.gameId,
 * and req.gameRoom.
 *
 * @param {import("../../server/lobby.js").Lobby} lobby
 * @returns {import("express").RequestHandler}
 */
export function extractPlayerAuth(lobby) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: "Empty token" });
    }

    const result = lobby.findByToken(token);
    if (!result) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.playerId = result.playerId;
    req.gameId = result.gameId;
    req.gameRoom = result.room;
    req.playerToken = token;

    next();
  };
}
