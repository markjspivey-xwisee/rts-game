import { useState, useEffect } from "react";

const API = "/api";
const B = {
  background: "#2a2e22", color: "#a8a890", border: "1px solid #3a4030",
  borderRadius: 3, cursor: "pointer", fontFamily: "'Courier New',monospace",
  padding: "8px 14px", fontSize: 13,
};

export default function Lobby({ onJoinGame }) {
  const [games, setGames] = useState([]);
  const [name, setName] = useState("");
  const [playerCount, setPlayerCount] = useState(2);
  const [enablePvE, setEnablePvE] = useState(false);
  const [waiting, setWaiting] = useState(null); // { gameId, playerId, token, isHost }
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [err, setErr] = useState(null);

  // Poll games list
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API}/games`);
        const data = await res.json();
        setGames(data.games || []);
      } catch {}
    };
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, []);

  // Poll lobby state when waiting
  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(async () => {
      try {
        // First check game list for player info and status
        const listRes = await fetch(`${API}/games`);
        if (listRes.ok) {
          const listData = await listRes.json();
          const game = (listData.games || []).find(g => g.id === waiting.gameId);
          if (game) {
            setLobbyPlayers(game.players || []);
            if (game.status === "playing") {
              onJoinGame(waiting.gameId, waiting.playerId, waiting.token);
              return;
            }
          }
        }
      } catch {}
    }, 1500);
    return () => clearInterval(iv);
  }, [waiting, onJoinGame]);

  const createGame = async () => {
    if (!name.trim()) { setErr("Enter a name"); return; }
    setErr(null);
    try {
      const res = await fetch(`${API}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { playerCount, enablePvE },
          playerName: name.trim(),
        }),
      });
      const data = await res.json();
      if (data.gameId) {
        setWaiting({ gameId: data.gameId, playerId: data.playerId, token: data.token, isHost: true });
      } else {
        setErr(data.error || "Failed to create game");
      }
    } catch (e) { setErr(e.message); }
  };

  const joinGame = async (gameId) => {
    if (!name.trim()) { setErr("Enter a name first"); return; }
    setErr(null);
    try {
      const res = await fetch(`${API}/games/${gameId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: name.trim() }),
      });
      const data = await res.json();
      if (data.playerId) {
        setWaiting({ gameId, playerId: data.playerId, token: data.token, isHost: false });
      } else {
        setErr(data.error || "Failed to join");
      }
    } catch (e) { setErr(e.message); }
  };

  const addBot = async () => {
    if (!waiting) return;
    try {
      await fetch(`${API}/games/${waiting.gameId}/add-bot`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waiting.token}` },
      });
    } catch {}
  };

  const startGame = async () => {
    if (!waiting) return;
    try {
      await fetch(`${API}/games/${waiting.gameId}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${waiting.token}` },
      });
      onJoinGame(waiting.gameId, waiting.playerId, waiting.token);
    } catch (e) { setErr(e.message); }
  };

  const style = {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    height: "100vh", background: "#0f1410", color: "#c8c0a8",
    fontFamily: "'Courier New',monospace",
  };

  // ── Waiting room ──
  if (waiting) {
    return (
      <div style={style}>
        <div style={{ background: "#1a1e16", border: "1px solid #2a3020", borderRadius: 6, padding: 30, width: 400, maxWidth: "90vw" }}>
          <h2 style={{ color: "#c9a825", margin: "0 0 16px" }}>⚔ Game Lobby</h2>
          <p style={{ color: "#888", fontSize: 12 }}>Game ID: {waiting.gameId.substring(0, 8)}</p>
          <div style={{ margin: "16px 0" }}>
            <div style={{ color: "#999", fontSize: 11, marginBottom: 6 }}>PLAYERS</div>
            {lobbyPlayers.map((p, i) => (
              <div key={i} style={{ padding: "4px 8px", color: p.type === "bot" ? "#888" : "#c9a825", display: "flex", gap: 8 }}>
                <span style={{ color: p.color || "#888" }}>●</span>
                <span>{p.name}</span>
                <span style={{ color: "#555", fontSize: 11 }}>({p.type})</span>
              </div>
            ))}
          </div>
          {waiting.isHost && (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addBot} style={B}>+ Add Bot</button>
              <button onClick={startGame} style={{ ...B, background: "#2a4a2a", color: "#8f8" }}>▶ Start Game</button>
            </div>
          )}
          {!waiting.isHost && (
            <p style={{ color: "#888", fontSize: 12 }}>Waiting for host to start...</p>
          )}
          {err && <p style={{ color: "#f44", fontSize: 12, marginTop: 8 }}>{err}</p>}
        </div>
      </div>
    );
  }

  // ── Main lobby ──
  return (
    <div style={style}>
      <div style={{ background: "#1a1e16", border: "1px solid #2a3020", borderRadius: 6, padding: 30, width: 500, maxWidth: "95vw" }}>
        <h1 style={{ color: "#c9a825", margin: "0 0 20px", fontSize: 22 }}>⚔ SCRIPT RTS</h1>

        {/* Name input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ color: "#888", fontSize: 11 }}>YOUR NAME</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Commander"
            style={{ display: "block", width: "100%", padding: "8px 10px", marginTop: 4,
              background: "#0d110d", color: "#a0c898", border: "1px solid #3a4030",
              borderRadius: 3, fontFamily: "'Courier New',monospace", fontSize: 13, boxSizing: "border-box",
            }}
          />
        </div>

        {/* Create game */}
        <div style={{ background: "rgba(255,255,255,0.03)", padding: 16, borderRadius: 4, marginBottom: 20 }}>
          <div style={{ color: "#999", fontSize: 11, marginBottom: 10 }}>CREATE GAME</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <label style={{ color: "#888", fontSize: 12 }}>Players:</label>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => setPlayerCount(n)}
                style={{ ...B, padding: "4px 12px", background: playerCount === n ? "#3a4a2a" : "#2a2e22",
                  color: playerCount === n ? "#c9a825" : "#888" }}>
                {n}
              </button>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#888", fontSize: 12, marginBottom: 12 }}>
            <input type="checkbox" checked={enablePvE} onChange={e => setEnablePvE(e.target.checked)} />
            Enable PvE raids
          </label>
          <button onClick={createGame} style={{ ...B, background: "#2a4a2a", color: "#8f8", width: "100%", textAlign: "center" }}>
            Create Game
          </button>
        </div>

        {/* Game list */}
        <div>
          <div style={{ color: "#999", fontSize: 11, marginBottom: 8 }}>OPEN GAMES</div>
          {games.filter(g => g.status === "waiting").length === 0 && (
            <p style={{ color: "#555", fontSize: 12 }}>No open games. Create one!</p>
          )}
          {games.filter(g => g.status === "waiting").map(g => (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 3, marginBottom: 6,
            }}>
              <div>
                <span style={{ color: "#c9a825" }}>{g.id.substring(0, 8)}</span>
                <span style={{ color: "#888", fontSize: 11, marginLeft: 8 }}>
                  {g.players?.length || 0}/{g.config?.playerCount || 2} players
                </span>
              </div>
              <button onClick={() => joinGame(g.id)} style={{ ...B, padding: "4px 12px" }}>Join</button>
            </div>
          ))}
        </div>

        {err && <p style={{ color: "#f44", fontSize: 12, marginTop: 12 }}>⚠ {err}</p>}
      </div>
    </div>
  );
}
