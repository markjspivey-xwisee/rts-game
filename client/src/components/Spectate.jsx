import { useState, useEffect, useRef, useCallback } from "react";

const TILE = 14;
const PLAYER_COLORS = ["#4488ff", "#ff4444", "#44cc44", "#cc44cc"];

/**
 * Spectate a live game or replay a finished one.
 * Props:
 *   mode: "spectate" | "replay"
 *   gameId: string
 *   onBack: () => void
 */
export default function Spectate({ mode, gameId, onBack }) {
  const canvasRef = useRef(null);
  const [state, setState] = useState(null);
  const [replayData, setReplayData] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);

  // SPECTATE MODE: connect via WebSocket
  useEffect(() => {
    if (mode !== "spectate") return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/?gameId=${gameId}&spectate=true`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "state") setState(msg.data);
        if (msg.type === "gameOver") setState(s => s ? { ...s, gameOver: true, winner: msg.data.winner } : s);
      } catch {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => { ws.close(); };
  }, [mode, gameId]);

  // REPLAY MODE: fetch replay data
  useEffect(() => {
    if (mode !== "replay") return;
    const load = async () => {
      try {
        const res = await fetch(`/api/games/${gameId}/replay`);
        const data = await res.json();
        setReplayData(data);
        if (data.frames?.length > 0) {
          setState(data.frames[0]);
          setFrameIndex(0);
        }
      } catch {}
    };
    load();
  }, [mode, gameId]);

  // REPLAY playback timer
  useEffect(() => {
    if (mode !== "replay" || !replayData || !playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setFrameIndex(i => {
        const next = i + 1;
        if (next >= replayData.frames.length) {
          setPlaying(false);
          return i;
        }
        setState(replayData.frames[next]);
        return next;
      });
    }, 100 / speed);
    return () => clearInterval(intervalRef.current);
  }, [mode, replayData, playing, speed]);

  // Render canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    const ctx = canvas.getContext("2d");
    const W = 64 * TILE;
    const H = 44 * TILE;
    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = "#0a0e0a";
    ctx.fillRect(0, 0, W, H);

    // Draw grid lines (subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    for (let x = 0; x < 64; x++) {
      ctx.beginPath(); ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, H); ctx.stroke();
    }
    for (let y = 0; y < 44; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * TILE); ctx.lineTo(W, y * TILE); ctx.stroke();
    }

    // Draw resources
    const resColors = { wood: "#2a5a2a", stone: "#5a5a5a", gold: "#8a7a2a", food: "#2a6a4a" };
    for (const r of (state.resources || [])) {
      ctx.fillStyle = resColors[r.type] || "#333";
      ctx.fillRect(r.x * TILE + 2, r.y * TILE + 2, TILE - 4, TILE - 4);
    }

    // Draw buildings
    const allBuildings = state.allBuildings || [];
    for (const b of allBuildings) {
      const pi = parseInt(b.owner?.replace("p", "") || "1") - 1;
      ctx.fillStyle = b.type === "town_center" ? PLAYER_COLORS[pi] : (PLAYER_COLORS[pi] + "88");
      const size = b.type === "town_center" ? 3 : (b.type === "house" || b.type === "farm" ? 1 : 2);
      ctx.fillRect(b.x * TILE, b.y * TILE, size * TILE, size * TILE);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.strokeRect(b.x * TILE, b.y * TILE, size * TILE, size * TILE);
      // Label
      ctx.fillStyle = "#fff";
      ctx.font = "8px monospace";
      ctx.fillText(b.type[0].toUpperCase(), b.x * TILE + 2, b.y * TILE + 10);
    }

    // Draw TCs from player data (in spectate mode, allBuildings may not include TCs)
    if (state.players) {
      for (const p of state.players) {
        if (p.tc) {
          const pi = parseInt(p.id?.replace("p", "") || "1") - 1;
          ctx.fillStyle = PLAYER_COLORS[pi];
          ctx.fillRect(p.tc.x * TILE, p.tc.y * TILE, 3 * TILE, 3 * TILE);
          ctx.strokeStyle = "#000";
          ctx.strokeRect(p.tc.x * TILE, p.tc.y * TILE, 3 * TILE, 3 * TILE);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 10px monospace";
          ctx.fillText("TC", p.tc.x * TILE + 8, p.tc.y * TILE + 24);
        }
      }
    }

    // Draw units
    const allUnits = state.allUnits || [];
    for (const u of allUnits) {
      const pi = parseInt(u.owner?.replace("p", "") || "1") - 1;
      ctx.fillStyle = PLAYER_COLORS[pi];
      ctx.beginPath();
      ctx.arc(u.x * TILE + TILE / 2, u.y * TILE + TILE / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      // Spec indicator
      if (u.spec === "warrior") {
        ctx.strokeStyle = "#ff0";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // For replay frames which use player.units instead of allUnits
    if (allUnits.length === 0 && state.players) {
      for (const p of state.players) {
        const pi = parseInt(p.id?.replace("p", "") || "1") - 1;
        for (const u of (p.units || [])) {
          ctx.fillStyle = PLAYER_COLORS[pi];
          ctx.beginPath();
          ctx.arc(u.x * TILE + TILE / 2, u.y * TILE + TILE / 2, 4, 0, Math.PI * 2);
          ctx.fill();
          if (u.spec === "warrior") {
            ctx.strokeStyle = "#ff0";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }

    // Game over overlay
    if (state.gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#c9a825";
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`GAME OVER`, W / 2, H / 2 - 10);
      ctx.font = "16px monospace";
      ctx.fillStyle = "#fff";
      ctx.fillText(`Winner: ${state.winner || "None"}`, W / 2, H / 2 + 16);
      ctx.textAlign = "left";
    }
  }, [state]);

  useEffect(() => { render(); }, [render]);

  const btnStyle = {
    background: "#2a2e22", color: "#a8a890", border: "1px solid #3a4030",
    borderRadius: 3, cursor: "pointer", fontFamily: "'Courier New',monospace",
    padding: "6px 12px", fontSize: 12,
  };

  return (
    <div style={{ background: "#0f1410", color: "#c8c0a8", fontFamily: "'Courier New',monospace",
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, width: "100%", maxWidth: 900 }}>
        <button onClick={onBack} style={btnStyle}>Back</button>
        <span style={{ color: "#c9a825", fontWeight: "bold" }}>
          {mode === "spectate" ? "SPECTATING" : "REPLAY"} {gameId.substring(0, 8)}
        </span>
        {state && <span style={{ color: "#888", fontSize: 11 }}>Tick: {state.tick}</span>}
      </div>

      {/* Player stats bar */}
      {state?.players && (
        <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          {state.players.map((p, i) => (
            <div key={p.id} style={{ fontSize: 11, opacity: p.eliminated ? 0.4 : 1 }}>
              <span style={{ color: PLAYER_COLORS[i], fontWeight: "bold" }}>{p.name || p.id}</span>
              {p.stockpile && (
                <span style={{ color: "#666", marginLeft: 6 }}>
                  W:{Math.floor(p.stockpile.wood)} S:{Math.floor(p.stockpile.stone)} G:{Math.floor(p.stockpile.gold)} F:{Math.floor(p.stockpile.food)}
                </span>
              )}
              <span style={{ color: "#555", marginLeft: 6 }}>
                {p.unitCount ?? (p.units?.length ?? "?")} units
              </span>
              {p.eliminated && <span style={{ color: "#f44", marginLeft: 6 }}>ELIMINATED</span>}
            </div>
          ))}
        </div>
      )}

      {/* Canvas */}
      <canvas ref={canvasRef} style={{ border: "1px solid #2a3020", maxWidth: "100%", imageRendering: "pixelated" }} />

      {/* Replay controls */}
      {mode === "replay" && replayData && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button onClick={() => setPlaying(!playing)} style={btnStyle}>
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={(replayData.frames?.length || 1) - 1}
            value={frameIndex}
            onChange={e => {
              const idx = parseInt(e.target.value);
              setFrameIndex(idx);
              setState(replayData.frames[idx]);
              setPlaying(false);
            }}
            style={{ flex: 1, maxWidth: 400 }}
          />
          <span style={{ color: "#888", fontSize: 11 }}>
            {frameIndex + 1}/{replayData.frames?.length || 0}
          </span>
          <select value={speed} onChange={e => setSpeed(parseFloat(e.target.value))}
            style={{ ...btnStyle, padding: "4px 8px" }}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>
      )}

      {!state && (
        <p style={{ color: "#888", marginTop: 20 }}>
          {mode === "spectate" ? "Connecting to game..." : "Loading replay..."}
        </p>
      )}
    </div>
  );
}
