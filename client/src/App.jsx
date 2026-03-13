import React, { useState } from "react";
import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";
import Spectate from "./components/Spectate.jsx";

export default function App() {
  const [session, setSession] = useState(null);

  // Check URL params for spectate/replay
  if (!session) {
    const params = new URLSearchParams(window.location.search);
    const spectateId = params.get("spectate");
    const replayId = params.get("replay");
    if (spectateId) {
      return (
        <Spectate
          mode="spectate"
          gameId={spectateId}
          onBack={() => { window.history.pushState({}, "", "/"); window.location.reload(); }}
        />
      );
    }
    if (replayId) {
      return (
        <Spectate
          mode="replay"
          gameId={replayId}
          onBack={() => { window.history.pushState({}, "", "/"); window.location.reload(); }}
        />
      );
    }
  }

  if (!session) {
    return (
      <Lobby
        onJoinGame={(gameId, playerId, token) => setSession({ gameId, playerId, token })}
      />
    );
  }

  return (
    <Game
      gameId={session.gameId}
      playerId={session.playerId}
      token={session.token}
      playerName={session.playerName}
      onLeave={() => setSession(null)}
    />
  );
}
