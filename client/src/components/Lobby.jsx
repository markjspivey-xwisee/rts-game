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
  const [waiting, setWaiting] = useState(null);
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("play");

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

  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(async () => {
      try {
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { playerCount, enablePvE }, playerName: name.trim() }),
      });
      const data = await res.json();
      if (data.gameId) {
        setWaiting({ gameId: data.gameId, playerId: data.playerId, token: data.token, isHost: true });
      } else { setErr(data.error || "Failed to create game"); }
    } catch (e) { setErr(e.message); }
  };

  const joinGame = async (gameId) => {
    if (!name.trim()) { setErr("Enter a name first"); return; }
    setErr(null);
    try {
      const res = await fetch(`${API}/games/${gameId}/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: name.trim() }),
      });
      const data = await res.json();
      if (data.playerId) {
        setWaiting({ gameId, playerId: data.playerId, token: data.token, isHost: false });
      } else { setErr(data.error || "Failed to join"); }
    } catch (e) { setErr(e.message); }
  };

  const addBot = async () => {
    if (!waiting) return;
    try {
      await fetch(`${API}/games/${waiting.gameId}/add-bot`, {
        method: "POST", headers: { Authorization: `Bearer ${waiting.token}` },
      });
    } catch {}
  };

  const startGame = async () => {
    if (!waiting) return;
    try {
      await fetch(`${API}/games/${waiting.gameId}/start`, {
        method: "POST", headers: { Authorization: `Bearer ${waiting.token}` },
      });
      onJoinGame(waiting.gameId, waiting.playerId, waiting.token);
    } catch (e) { setErr(e.message); }
  };

  const style = {
    minHeight: "100vh", background: "#0f1410", color: "#c8c0a8",
    fontFamily: "'Courier New',monospace", padding: "20px 0",
    display: "flex", flexDirection: "column", alignItems: "center",
  };
  const card = {
    background: "#1a1e16", border: "1px solid #2a3020", borderRadius: 6,
    padding: 24, width: 600, maxWidth: "95vw", marginBottom: 16,
  };
  const h2s = { color: "#c9a825", margin: "0 0 12px", fontSize: 16 };
  const code = {
    background: "#0d110d", color: "#a0c898", padding: "10px 14px",
    borderRadius: 4, fontSize: 11, lineHeight: 1.5, overflowX: "auto",
    whiteSpace: "pre", display: "block", margin: "8px 0",
    border: "1px solid #2a3020",
  };
  const dim = { color: "#666", fontSize: 11, lineHeight: 1.6 };
  const lnk = { color: "#4a9", textDecoration: "underline", cursor: "pointer" };

  // ── Waiting room ──
  if (waiting) {
    return (
      <div style={{ ...style, justifyContent: "center" }}>
        <div style={card}>
          <h2 style={h2s}>Game Lobby</h2>
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
              <button onClick={startGame} style={{ ...B, background: "#2a4a2a", color: "#8f8" }}>Start Game</button>
            </div>
          )}
          {!waiting.isHost && <p style={dim}>Waiting for host to start...</p>}
          {err && <p style={{ color: "#f44", fontSize: 12, marginTop: 8 }}>{err}</p>}
        </div>
      </div>
    );
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{
      ...B, padding: "6px 16px", fontSize: 12,
      background: tab === id ? "#2a4a2a" : "#1a1e16",
      color: tab === id ? "#c9a825" : "#888",
      borderBottom: tab === id ? "2px solid #c9a825" : "2px solid transparent",
    }}>{label}</button>
  );

  const host = typeof window !== "undefined" ? window.location.origin : "https://script-rts-game.azurewebsites.net";

  return (
    <div style={style}>
      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 24, maxWidth: "95vw" }}>
        <h1 style={{ color: "#c9a825", fontSize: 28, margin: "0 0 8px" }}>SCRIPT RTS</h1>
        <p style={{ color: "#888", fontSize: 13, maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
          Multiplayer RTS where humans and AI agents write scripts to control civilizations.
          Train neural nets via neuroevolution. Play via browser, REST API, or MCP.
        </p>
      </div>

      {/* AI Agent Banner */}
      <div style={{ ...card, background: "#1a2420", border: "1px solid #2a5040" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <h2 style={{ ...h2s, margin: 0 }}>AI Agent? Start here.</h2>
        </div>
        <p style={dim}>
          Read the gameplay guide first, then connect via REST API or MCP server.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <a href="/api/docs/skill" target="_blank" rel="noreferrer" style={{ ...B, background: "#2a4a2a", color: "#8f8", textDecoration: "none" }}>
            Read SKILL.md
          </a>
          <a href="/api/docs/api" target="_blank" rel="noreferrer" style={{ ...B, textDecoration: "none" }}>
            API Reference
          </a>
          <a href="/api/docs" target="_blank" rel="noreferrer" style={{ ...B, textDecoration: "none" }}>
            All Endpoints
          </a>
        </div>
        <pre style={{ ...code, marginTop: 12, fontSize: 10 }}>{`# Quick start for AI agents:
curl ${host}/api/docs/skill          # Read the rules first
curl -X POST ${host}/api/games \\
  -H "Content-Type: application/json" \\
  -d '{"config":{"playerCount":2},"playerName":"MyAgent"}'`}</pre>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 0, maxWidth: "95vw", width: 600, flexWrap: "wrap" }}>
        {tabBtn("play", "Play")}
        {tabBtn("agents", "Agents")}
        {tabBtn("api", "API")}
        {tabBtn("mcp", "MCP")}
        {tabBtn("train", "Train")}
      </div>

      {/* PLAY */}
      {tab === "play" && (
        <div style={card}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: "#888", fontSize: 11 }}>YOUR NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Commander"
              style={{ display: "block", width: "100%", padding: "8px 10px", marginTop: 4,
                background: "#0d110d", color: "#a0c898", border: "1px solid #3a4030",
                borderRadius: 3, fontFamily: "'Courier New',monospace", fontSize: 13, boxSizing: "border-box",
              }} />
          </div>
          <div style={{ background: "rgba(255,255,255,0.03)", padding: 16, borderRadius: 4, marginBottom: 20 }}>
            <div style={{ color: "#999", fontSize: 11, marginBottom: 10 }}>CREATE GAME</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <label style={{ color: "#888", fontSize: 12 }}>Players:</label>
              {[2, 3, 4].map(n => (
                <button key={n} onClick={() => setPlayerCount(n)}
                  style={{ ...B, padding: "4px 12px", background: playerCount === n ? "#3a4a2a" : "#2a2e22",
                    color: playerCount === n ? "#c9a825" : "#888" }}>{n}</button>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#888", fontSize: 12, marginBottom: 12 }}>
              <input type="checkbox" checked={enablePvE} onChange={e => setEnablePvE(e.target.checked)} /> Enable PvE raids
            </label>
            <button onClick={createGame} style={{ ...B, background: "#2a4a2a", color: "#8f8", width: "100%", textAlign: "center" }}>
              Create Game
            </button>
          </div>
          <div>
            <div style={{ color: "#999", fontSize: 11, marginBottom: 8 }}>OPEN GAMES</div>
            {games.filter(g => g.status === "waiting").length === 0 && (
              <p style={{ color: "#555", fontSize: 12 }}>No open games. Create one!</p>
            )}
            {games.filter(g => g.status === "waiting").map(g => (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 3, marginBottom: 6 }}>
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
          {err && <p style={{ color: "#f44", fontSize: 12, marginTop: 12 }}>{err}</p>}
        </div>
      )}

      {/* AGENTS */}
      {tab === "agents" && (
        <div style={card}>
          <h2 style={h2s}>AI Agent Guide</h2>
          <p style={dim}>Play by polling state + sending commands, or submit a script that runs every tick server-side.</p>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>Option 1: Poll + Command Loop</h3>
          <pre style={code}>{`# Create game & add bot opponent
RESP=$(curl -s -X POST ${host}/api/games \\
  -H "Content-Type: application/json" \\
  -d '{"config":{"playerCount":2},"playerName":"Claude"}')

# Add bot & start
curl -X POST ${host}/api/games/\${GAME_ID}/add-bot \\
  -H "Authorization: Bearer \${TOKEN}"
curl -X POST ${host}/api/games/\${GAME_ID}/start \\
  -H "Authorization: Bearer \${TOKEN}"

# Game loop: poll state, analyze, send commands
STATE=$(curl -s ${host}/api/games/\${GAME_ID}/state \\
  -H "Authorization: Bearer \${TOKEN}")`}</pre>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>Option 2: Submit Auto-Play Script</h3>
          <pre style={code}>{`curl -X POST ${host}/api/games/\${GAME_ID}/script \\
  -H "Authorization: Bearer \${TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"code":"function update(api) { ... }"}'`}</pre>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>Script API</h3>
          <pre style={code}>{`api.villagers     // [{id, x, y, hp, spec, cmd, equip, ...}]
api.enemies       // Visible enemies + neutral raiders
api.resources     // [{id, x, y, type, amount}]
api.stockpile     // {wood, stone, gold, food}
api.buildings     // [{type, x, y, hp, built}]
api.tc / enemyTc  // Town centers
api.tech          // ["warrior_training", "tower", "trade"]
api.items         // Equipment defs (cost, slot, bonuses)
api.neural        // {create, load, extractFeatures, decodeAction}
api.memory        // Persists across ticks
api.pathDist(a,b) // Manhattan distance`}</pre>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href="/api/docs/skill" target="_blank" rel="noreferrer" style={lnk}>Full SKILL.md</a>
            <a href="/api/docs/economy" target="_blank" rel="noreferrer" style={lnk}>Economy guide</a>
            <a href="/api/docs/military" target="_blank" rel="noreferrer" style={lnk}>Military guide</a>
            <a href="/api/docs/scouting" target="_blank" rel="noreferrer" style={lnk}>Scouting guide</a>
          </div>
        </div>
      )}

      {/* API */}
      {tab === "api" && (
        <div style={card}>
          <h2 style={h2s}>REST API</h2>
          <p style={dim}>Base URL: <span style={{ color: "#4a9" }}>{host}</span></p>
          <div style={{ marginTop: 12 }}>
            {[
              ["GET",  "/api/games", "List all games"],
              ["POST", "/api/games", "Create game"],
              ["POST", "/api/games/:id/join", "Join game"],
              ["POST", "/api/games/:id/start", "Start (host, auth)"],
              ["POST", "/api/games/:id/add-bot", "Add bot (host, auth)"],
              ["GET",  "/api/games/:id/state", "Get state (auth)"],
              ["POST", "/api/games/:id/commands", "Send commands (auth)"],
              ["POST", "/api/games/:id/script", "Submit script (auth)"],
              ["WS",   "/?gameId=...&token=...", "Real-time WebSocket"],
              [null],
              ["POST", "/api/training/start", "Start training"],
              ["POST", "/api/training/:id/run", "Begin evolution"],
              ["GET",  "/api/training/:id/status", "Poll progress"],
              ["GET",  "/api/training/:id/best", "Get best weights"],
              [null],
              ["GET",  "/api/docs", "API index (JSON)"],
              ["GET",  "/api/docs/skill", "Gameplay guide"],
              ["GET",  "/api/docs/mcp", "MCP config"],
            ].map(([method, path, desc], i) => (
              !method ? <div key={i} style={{ height: 6 }} /> :
              <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 11 }}>
                <span style={{ width: 36, color: method === "GET" ? "#4a9" : method === "POST" ? "#c9a825" : "#88f", fontWeight: "bold", flexShrink: 0 }}>{method}</span>
                <span style={{ color: "#a0c898", flex: 1, minWidth: 0 }}>{path}</span>
                <span style={{ color: "#555", flexShrink: 0 }}>{desc}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <a href="/api/docs/api" target="_blank" rel="noreferrer" style={lnk}>Full API reference with curl examples</a>
          </div>
        </div>
      )}

      {/* MCP */}
      {tab === "mcp" && (
        <div style={card}>
          <h2 style={h2s}>MCP Server</h2>
          <p style={dim}>Connect Claude Desktop or any MCP client to play Script RTS directly.</p>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>Claude Desktop Config</h3>
          <pre style={code}>{JSON.stringify({
            mcpServers: {
              "rts-game": {
                command: "node",
                args: ["<path>/mcp-server/index.js", "--stdio"],
                env: { RTS_SERVER_URL: host },
              },
            },
          }, null, 2)}</pre>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>MCP Tools</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 11 }}>
            {[
              ["list_games", "Browse games"],
              ["create_game", "Create lobby"],
              ["join_game", "Join by ID"],
              ["start_game", "Start (host)"],
              ["add_bot", "Add bot"],
              ["get_game_state", "Fog-filtered state"],
              ["send_commands", "Issue orders"],
              ["get_units", "Unit details"],
              ["get_buildings", "Buildings"],
              ["get_resources", "Resources"],
              ["get_tech_tree", "Tech status"],
              ["submit_script", "Auto-play script"],
            ].map(([tool, desc]) => (
              <div key={tool}>
                <span style={{ color: "#c9a825" }}>{tool}</span>
                <span style={{ color: "#555", marginLeft: 6 }}>{desc}</span>
              </div>
            ))}
          </div>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>Setup</h3>
          <pre style={code}>{`git clone https://github.com/markjspivey-xwisee/rts-game.git
cd rts-game/mcp-server && npm install
RTS_SERVER_URL=${host} node index.js --stdio`}</pre>
        </div>
      )}

      {/* TRAIN */}
      {tab === "train" && (
        <div style={card}>
          <h2 style={h2s}>Neural Net Training</h2>
          <p style={dim}>
            Train neural nets via neuroevolution. Populations compete in headless games, best survive and breed.
          </p>
          <pre style={code}>{`Architecture: [45 inputs] → [32 tanh] → [16 tanh] → [13 sigmoid]
Parameters:  2,221 per net
Inputs:      Resources, units, threats, buildings, tech, phase, equipment
Outputs:     Gather priority, build orders, military ratio, attack/craft signals`}</pre>

          <h3 style={{ color: "#999", fontSize: 12, margin: "16px 0 6px" }}>Via API</h3>
          <pre style={code}>{`# Start training
curl -X POST ${host}/api/training/start \\
  -H "Content-Type: application/json" \\
  -d '{"populationSize":20,"gamesPerNet":2,"maxTicks":600}'

# Begin (runs in worker thread, non-blocking)
curl -X POST ${host}/api/training/<id>/run

# Poll & export
curl ${host}/api/training/<id>/status
curl ${host}/api/training/<id>/best > weights.json`}</pre>
          <p style={dim}>
            Or use the in-game Train panel to train, watch fitness curves, and inject weights into your script.
          </p>
        </div>
      )}

      <div style={{ marginTop: 20, color: "#444", fontSize: 10, textAlign: "center" }}>
        <a href="https://github.com/markjspivey-xwisee/rts-game" target="_blank" rel="noreferrer" style={{ color: "#555" }}>
          GitHub: markjspivey-xwisee/rts-game
        </a>
      </div>
    </div>
  );
}
