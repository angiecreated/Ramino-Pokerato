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
      if (data.status === "playing") { setError("Partita gia iniziata"); return; }
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
    playerIds.forEach((pid) => {
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
            Crea Partita
          </button>
          <button onClick={() => setMode("join")} style={btnStyle("transparent", "#f0c040", true)}>
            Entra in una Partita
          </button>
        </div>
      ) : (
        <div style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 20, padding: 28,
          width: "100%", maxWidth: 360,
        }}>
          <h3 style={{ color: "#f0c040", margin: "0 0 20px", fontSize: 18 }}>
            {mode === "create" ? "Crea Partita" : "Entra in una Partita"}
          </h3>

          <label style={labelStyle}>Il tuo nome</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Come ti chiami?"
            style={inputStyle}
          />

          {mode === "join" && (
            <div>
              <label style={{ ...labelStyle, marginTop: 14 }}>Codice Stanza</label>
              <input
                value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="es. ABC123"
                style={{ ...inputStyle, letterSpacing: 4, fontWeight: 700 }}
              />
            </div>
          )}

          {error && <p style={{ color: "#e74c3c", fontSize: 13, marginTop: 10 }}>{error}</p>}

          <button
            onClick={mode === "create" ? handleCreate : handleJoin}
            style={{ ...btnStyle("#f0c040", "#1a0a2e"), width: "100%", marginTop: 20 }}
          >
            {mode === "create" ? "Crea Stanza" : "Entra"}
          </button>
          <button onClick={() => { setMode(null); setError(""); }} style={{
            background: "transparent", border: "none", color: "#7a8fa6",
            width: "100%", marginTop: 10, padding: 10, cursor: "pointer", fontSize: 14,
          }}>Indietro</button>
        </div>
      )}
    </div>
  );
}

function WaitingRoom({ roomCode, playerId, playerName, onStart }) {
  const [players, setPlayers] = useState({});
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${roomCode}`), snap => {
      const data = snap.val();
      if (!data) return;
      setPlayers(data.players || {});
      setIsHost(data.host === playerId);
    });
    return () => unsub();
  }, [roomCode, playerId]);

  const playerList = Object.values(players).sort((a, b) => a.order - b.order);
  const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "'Georgia', serif",
    }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🃏</div>
        <h2 style={{ color: "#f0c040", margin: 0, fontSize: 24 }}>Sala di Attesa</h2>
      </div>

      <div style={{
        background: "rgba(240,192,64,0.08)",
        border: "2px solid rgba(240,192,64,0.3)",
        borderRadius: 16, padding: "16px 32px",
        textAlign: "center", marginBottom: 28,
      }}>
        <div style={{ color: "#7a8fa6", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>Codice Stanza</div>
        <div style={{ color: "#f0c040", fontSize: 36, fontWeight: 900, letterSpacing: 6 }}>{roomCode}</div>
        <div style={{ color: "#7a8fa6", fontSize: 12 }}>Condividi questo codice con gli amici</div>
      </div>

      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16, padding: 20,
        width: "100%", maxWidth: 360, marginBottom: 24,
      }}>
        <div style={{ color: "#7a8fa6", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
          Giocatori ({playerList.length}/6)
        </div>
        {playerList.map((p, i) => (
          <div key={p.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS[i] }} />
            <span style={{ color: "#e0eaf4", fontWeight: 600, flex: 1 }}>{p.name}</span>
            {p.id === playerId && <span style={{ color: "#f0c040", fontSize: 11 }}>Tu</span>}
          </div>
        ))}
      </div>

      {isHost ? (
        <button
          onClick={onStart}
          disabled={playerList.length < 2}
          style={btnStyle(playerList.length >= 2 ? "#f0c040" : "#4a5a6a", "#1a0a2e")}
        >
          {playerList.length < 2 ? "Aspetta altri giocatori..." : "Inizia Partita"}
        </button>
      ) : (
        <p style={{ color: "#7a8fa6", fontSize: 14 }}>In attesa che l host inizi la partita...</p>
      )}
    </div>
  );
}

const btnStyle = (bg, color, outlined) => ({
  padding: "14px 28px", borderRadius: 12,
  border: outlined ? `2px solid ${bg}` : "none",
  background: outlined ? "transparent" : `linear-gradient(135deg, ${bg}, ${bg}dd)`,
  color: outlined ? bg : color,
  fontWeight: 800, fontSize: 16, cursor: "pointer",
  boxShadow: outlined ? "none" : `0 4px 20px ${bg}44`,
  letterSpacing: 0.5,
  fontFamily: "'Georgia', serif",
});

const labelStyle = {
  display: "block", color: "#f0c040", fontWeight: 700,
  fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8,
};

const inputStyle = {
  width: "100%", background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10,
  padding: "11px 14px", color: "#fff", fontSize: 15, outline: "none",
  boxSizing: "border-box", fontFamily: "'Georgia', serif",
};
