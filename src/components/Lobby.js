import React, { useState, useEffect } from "react";
import { db } from "../firebase/config";
import { ref, set, onValue, update } from "firebase/database";
import { generateRoomCode, createDeck, shuffle } from "../utils/gameLogic";

export default function Lobby({ onGameStart }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(null);
  const [playerId] = useState(() => Math.random().toString(36).slice(2));

  useEffect(() => {
    if (!waiting) return;
    const roomRef = ref(db, `rooms/${waiting.roomCode}`);
    const unsub = onValue(roomRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.status === "playing") {
        onGameStart({ roomCode: waiting.roomCode, playerId, playerName: waiting.name, room: data });
      }
    });
    return () => unsub();
  }, [waiting]);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Inserisci il tuo nome"); return; }
    const code = generateRoomCode();
    const roomRef = ref(db, `rooms/${code}`);
    await set(roomRef, {
      code,
      status: "waiting",
      host: playerId,
      players: { [playerId]: { name: name.trim(), id: playerId, score: 0, apertureUsate: {}, aperta: false, order: 0 } },
      createdAt: Date.now(),
    });
    setWaiting({ roomCode: code, name: name.trim() });
  };

  const handleJoin = async () => {
    if (!name.trim()) { setError("Inserisci il tuo nome"); return; }
    if (!roomCode.trim()) { setError("Inserisci il codice stanza"); return; }
    const code = roomCode.toUpperCase().trim();
    const roomRef = ref(db, `rooms/${code}`);
    onValue(roomRef, async (snap) => {
      const data = snap.val();
      if (!data) { setError("Stanza non trovata"); return; }
      if (data.status === "playing") { setError("Partita già iniziata"); return; }
      const playerCount = Object.keys(data.players || {}).length;
      if (playerCount >= 6) { setError("Stanza piena (max 6 giocatori)"); return; }
      await update(ref(db, `rooms/${code}/players/${playerId}`), {
        name: name.trim(), id: playerId, score: 0, apertureUsate: {}, aperta: false, order: playerCount,
      });
      setWaiting({ roomCode: code, name: name.trim() });
    }, { onlyOnce: true });
  };

  const handleStartGame = async () => {
    const code = waiting.roomCode;
    const roomSnap = await new Promise(res => onValue(ref(db, `rooms/${code}`), res, { onlyOnce: true }));
    const room = roomSnap.val();
    const players = room.players;
    const playerIds = Object.keys(players);

    const deck = createDeck();
    const hands = {};
    playerIds.forEach((pid, i) => {
      hands[pid] = deck.splice(0, 13);
    });

    await update(ref(db, `rooms/${code}`), {
      status: "playing",
      deck,
      discardPile: [],
      table: [],
      currentPlayerIndex: 0,
      playerOrder: playerIds,
      mano: 1,
      hands,
      log: ["Partita iniziata! 🃏"],
    });
  };

  if (waiting) {
    return (
      <WaitingRoom
        roomCode={waiting.roomCode}
        playerId={playerId}
        playerName={waiting.name}
        onStart={handleStartGame}
      />
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "'Georgia', serif",
    }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>🃏</div>
        <h1 style={{
          fontSize: 38, fontWeight: 900, margin: 0,
          background: "linear-gradient(135deg, #f0c040, #e8a020)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: 2,
        }}>Ramino Pokerato</h1>
        <p style={{ color: "#7a8fa6", marginTop: 8, fontSize: 14, letterSpacing: 3, textTransform: "uppercase" }}>
          la variante pazza
        </p>
      </div>

      {!mode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 320 }}>
          <button onClick={() => setMode("create")} style={btnStyle("#f0c040", "#1a0a2e")}>
            ✨ Crea Partita
          </button>
          <button onClick={() => setMode("join")} style={btnStyle("transparent", "#f0c040", true)}>
            🚪 Entra in una Partita
          </button>
        </div>
      ) : (
        <div style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20, padding: 28,
          width: "100%", maxWidth: 360,
        }}>
          <h3 style={{ color: "#f0c040", margin: "0 0 20px", fontSize: 18
