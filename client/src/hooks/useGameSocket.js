import { useState, useEffect, useRef, useCallback } from "react";

/**
 * WebSocket hook for connecting to game server.
 * @param {string} serverUrl - base URL (e.g. "localhost:3000")
 * @param {string} gameId
 * @param {string} token
 */
export function useGameSocket(serverUrl, gameId, token) {
  const [view, setView] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("connecting"); // connecting, lobby, playing, finished
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  useEffect(() => {
    if (!gameId || !token) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${serverUrl}/ws?gameId=${gameId}&token=${token}`;

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          switch (msg.type) {
            case "joined":
              setStatus("lobby");
              break;
            case "lobbyUpdate":
              setView(prev => ({ ...prev, lobby: msg.data }));
              break;
            case "gameStarted":
              setStatus("playing");
              break;
            case "state":
              setView(msg.data);
              break;
            case "gameOver":
              setStatus("finished");
              setView(prev => prev ? { ...prev, gameOver: true, winner: msg.winner } : prev);
              break;
            case "error":
              setError(msg.message);
              break;
          }
        } catch (e) {
          console.error("WS parse error:", e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 2s
        reconnectRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [serverUrl, gameId, token]);

  const sendCommands = useCallback((commands) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "commands", commands }));
    }
  }, []);

  const sendScript = useCallback((code) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "script", code }));
    }
  }, []);

  const sendStart = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "start" }));
    }
  }, []);

  return { view, connected, error, status, sendCommands, sendScript, sendStart };
}
