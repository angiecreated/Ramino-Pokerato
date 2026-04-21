import React, { useState } from "react";
import Lobby from "./components/Lobby";
import Game from "./components/Game";

export default function App() {
  const [gameState, setGameState] = useState(null);

  if (gameState) {
    return (
      <Game
        roomCode={gameState.roomCode}
        playerId={gameState.playerId}
        playerName={gameState.playerName}
        room={gameState.room}
      />
    );
  }

  return <Lobby onGameStart={setGameState} />;
}
