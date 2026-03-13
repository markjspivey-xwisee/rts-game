import React, { useState } from "react";
import Lobby from "./components/Lobby.jsx";
import Game from "./components/Game.jsx";

export default function App() {
  const [session, setSession] = useState(null);

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
