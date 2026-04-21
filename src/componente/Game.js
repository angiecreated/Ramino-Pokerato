import React, { useState, useEffect, useRef } from "react";
import { db } from "../firebase/config";
import { ref, onValue, update } from "firebase/database";
import Card from "./Card";
import {
  APERTURE_TYPES, handPoints, isValidCombination,
  validateApertura, canChiuderInMano, createDeck, shuffle
} from "../utils/gameLogic";

const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];

export default function Game({ roomCode, playerId, playerName, room: initialRoom }) {
  const [room, setRoom] = useState(initialRoom);
  const [selected, setSelected] = useState([]);
  const [showApertura, setShowApertura] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [msg, setMsg] = useState("");
  const [showScores, setShowScores] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    const unsub = onValue(ref(db, `rooms/${roomCode}`), snap => {
      const data = snap.val();
      if (data) setRoom(data);
    });
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [room?.log]);

  if (!room) return <div style={loadingStyle}>Caricamento...</div>;

  const myHand = (room.hands?.[playerId]) || [];
  const players = room.players || {};
  const playerOrder = room.playerOrder || [];
  const currentPid = playerOrder[room.currentPlayerIndex % playerOrder.length];
  const isMyTurn = currentPid === playerId;
  const me = players[playerId] || {};
  const myColor = COLORS[playerOrder.indexOf(playerId)] || "#f0c040";

  const addLog = async (msg) => {
    const logs = room.log || [];
    await update(ref(db, `rooms/${roomCode}`), { log: [...logs.slice(-20), msg] });
  };

  const showMsg = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const drawCard = async () => {
    if (!isMyTurn) { showMsg("Non è il tuo turno!"); return; }
    if (room.drawnThisTurn) { showMsg("Hai già pescato!"); return; }

    let deck = [...(room.deck || [])];
    if (deck.length === 0) {
      const tablePoker = (room.table || []).filter(combo => combo.type === "poker").flatMap(c => c.cards);
      const discards = room.discardPile || [];
      deck = shuffle([...tablePoker, ...discards]);
      await update(ref(db, `rooms/${roomCode}`), { discardPile: [] });
      await addLog("🔀 Mazzo finito! Rimescolati i poker e gli scarti.");
    }

    const card = deck[0];
    const newDeck = deck.slice(1);
    const newHand = [...myHand, card];

    await update(ref(db, `rooms/${roomCode}`), {
      deck: newDeck,
      [`hands/${playerId}`]: newHand,
      drawnThisTurn: true,
    });
    await addLog(`${me.name} pesca una carta.`);
  };

  const discardCard = async () => {
    if (!isMyTurn) { showMsg("Non è il tuo turno!"); return; }
    if (!room.drawnThisTurn) { showMsg("Devi prima pescare!"); return; }
    if (selected.length !== 1) { showMsg("Seleziona una carta da scartare"); return; }
    const card = selected[0];
    if (card.isJoker) { showMsg("Non puoi scartare il jolly!"); return; }

    const newHand = myHand.filter(c => c.id !== card.id);
    const newDiscard = [...(room.discardPile || []), card];
    const nextIndex = (room.currentPlayerIndex + 1) % playerOrder.length;

    await update(ref(db, `rooms/${roomCode}`), {
      [`hands/${playerId}`]: newHand,
      discardPile: newDiscard,
      currentPlayerIndex: nextIndex,
      drawnThisTurn: false,
    });
    setSelected([]);
    await addLog(`${me.name} scarta ${card.rank}${card.suit}.`);
  };

  const handleApertura = async (aperturaId) => {
    if (!isMyTurn) { showMsg("Non è il tuo turno!"); return; }
    if (!room.drawnThisTurn) { showMsg("Devi prima pescare!"); return; }
    if (me.apertureUsate?.[aperturaId]) { showMsg("Apertura già usata!"); return; }

    if (aperturaId === "chiusura") {
      await handleChiusura();
      setShowApertura(false);
      return;
    }

    if (selected.length === 0) { showMsg("Seleziona le carte per l'apertura"); setShowApertura(false); return; }
    if (!validateApertura(selected, aperturaId)) {
      showMsg("Combinazione non valida per questa apertura!"); setShowApertura(false); return;
    }

    const newHand = myHand.filter(c => !selected.find(s => s.id === c.id));
    const newTable = [...(room.table || []), {
      id: Date.now().toString(),
      playerId,
      playerName: me.name,
      color: myColor,
      type: aperturaId,
      cards: selected,
    }];

    await update(ref(db, `rooms/${roomCode}`), {
      [`hands/${playerId}`]: newHand,
      [`players/${playerId}/apertureUsate/${aperturaId}`]: true,
      [`players/${playerId}/aperta`]: true,
      table: newTable,
    });
    setSelected([]);
    setShowApertura(false);
    await addLog(`🎉 ${me.name} apre con ${APERTURE_TYPES.find(a => a.id === aperturaId)?.label}!`);
  };

  const handleChiusura = async () => {
    if (!isMyTurn) { showMsg("Non è il tuo turno!"); return; }
    if (!room.drawnThisTurn) { showMsg("Devi prima pescare!"); return; }
    if (me.apertureUsate?.chiusura) { showMsg("Chiusura già usata!"); return; }

    if (selected.length !== myHand.length - 1) {
      showMsg("Per chiudere seleziona tutte le carte tranne una da scartare!"); return;
    }

    const cardToDiscard = myHand.find(c => !selected.find(s => s.id === c.id));
    if (cardToDiscard?.isJoker) { showMsg("Non puoi scartare il jolly!"); return; }

    if (!canChiuderInMano(selected)) {
      showMsg("Le tue carte non formano combinazioni valide!"); return;
    }

    const newDiscard = [...(room.discardPile || []), cardToDiscard];
    const scores = {};
    for (const pid of playerOrder) {
      if (pid === playerId) { scores[pid] = 0; continue; }
      const hand = room.hands?.[pid] || [];
      scores[pid] = handPoints(hand);
    }

    const updates = {};
    for (const pid of playerOrder) {
      updates[`players/${pid}/score`] = (players[pid]?.score || 0) + (scores[pid] || 0);
      updates[`players/${pid}/aperta`] = false;
    }
    updates[`players/${playerId}/apertureUsate/chiusura`] = true;
    updates[`hands/${playerId}`] = [];
    updates.discardPile = newDiscard;
    updates.status = "handEnd";
    updates.handScores = scores;
    updates.handWinner = playerId;

    await update(ref(db, `rooms/${roomCode}`), updates);
    setSelected([]);
    await addLog(`⚡ ${me.name} chiude in mano! 🎉`);
    setShowScores(true);
  };

  const addToTableCombo = async (comboId) => {
    if (!isMyTurn) { showMsg("Non è il tuo turno!"); return; }
    if (!me.aperta) { showMsg("Devi prima aprire!"); return; }
    if (selected.length === 0) { showMsg("Seleziona le carte da aggiungere"); return; }

    const combo = room.table?.find(c => c.id === comboId);
    if (!combo) return;

    const newCards = [...combo.cards, ...selected];
    if (!isValidCombination(newCards)) { showMsg("Le carte non formano una combinazione valida!"); return; }

    const newTable = room.table.map(c => c.id === comboId ? { ...c, cards: newCards } : c);
    const newHand = myHand.filter(c => !selected.find(s => s.id === c.id));

    await update(ref(db, `rooms/${roomCode}`), {
      [`hands/${playerId}`]: newHand,
      table: newTable,
    });
    setSelected([]);
    await addLog(`${me.name} aggiunge carte a una combinazione.`);
  };

  const swapJoker = async (comboId, jokerIndex) => {
    if (!isMyTurn) { showMsg("Non è il tuo turno!"); return; }
    if (!me.aperta) { showMsg("Devi prima aprire!"); return; }
    if (selected.length !== 1 || selected[0].isJoker) { showMsg("Seleziona la carta vera da mettere al posto del jolly"); return; }

    const combo = room.table?.find(c => c.id === comboId);
    if (!combo) return;

    const joker = combo.cards[jokerIndex];
    if (!joker?.isJoker) return;

    const newComboCards = [...combo.cards];
    newComboCards[jokerIndex] = selected[0];
    if (!isValidCombination(newComboCards)) { showMsg("La sostituzione non è valida!"); return; }

    const newTable = room.table.map(c => c.id === comboId ? { ...c, cards: newComboCards } : c);
    const newHand = myHand.filter(c => c.id !== selected[0].id).concat(joker);

    await update(ref(db, `rooms/${roomCode}`), {
      [`hands/${playerId}`]: newHand,
      table: newTable,
    });
    setSelected([]);
    await addLog(`${me.name} prende un jolly! 🃏`);
  };

  const startNewHand = async () => {
    const deck = createDeck();
    const hands = {};
    for (const pid of playerOrder) hands[pid] = deck.splice(0, 13);

    const updates = {
      status: "playing",
      deck,
      discardPile: [],
      table: [],
      currentPlayerIndex: (room.currentPlayerIndex + 1) % playerOrder.length,
      mano: (room.mano || 1) + 1,
      hands,
      drawnThisTurn: false,
      handScores: null,
      handWinner: null,
    };
    for (const pid of playerOrder) {
      updates[`players/${pid}/aperta`] = false;
    }
    await update(ref(db, `rooms/${roomCode}`), updates);
    setShowScores(false);
    setSelected([]);
  };

  const toggleSelect = (card) => {
    setSelected(prev =>
      prev.find(c => c.id === card.id)
        ? prev.filter(c => c.id !== card.id)
        : [...prev, card]
    );
  };

  const sortedPlayers = playerOrder.map((pid, i) => ({ ...players[pid], id: pid, color: COLORS[i] }));

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0a0f1a 0%, #0d1b2a 50%, #071015 100%)",
      fontFamily: "'Georgia', serif", color: "#e0eaf4",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <span style={{ color: "#f0c040", fontWeight: 800, fontSize: 16 }}>🃏 Ramino Pokerato</span>
          <span style={{ color: "#4a5a6a", fontSize: 12, marginLeft: 10 }}>Mano {room.mano}</span>
        </div>
        <button onClick={() => setShowTable(!showTable)} style={smallBtn}>
          {showTable ? "🙈 Nascondi" : "🂠 Tavolo"}
        </button>
      </div>

      <div style={{
        background: isMyTurn ? "rgba(240,192,64,0.12)" : "rgba(255,255,255,0.03)",
        borderBottom: `2px solid ${isMyTurn ? "#f0c040" : "transparent"}`,
        padding: "8px 16px", textAlign: "center",
        color: isMyTurn ? "#f0c040" : "#7a8fa6", fontSize: 13, fontWeight: 700,
      }}>
        {isMyTurn ? "⭐ È IL TUO TURNO!" : `⏳ Turno di ${players[currentPid]?.name || "..."}`}
      </div>

      {msg && (
        <div style={{
          background: "#c0392b", color: "#fff", padding: "8px 16px",
          textAlign: "center", fontSize: 13, fontWeight: 600,
        }}>{msg}</div>
      )}

      <div style={{ display: "flex", gap: 8, padding: "10px 12px", overflowX: "auto" }}>
        {sortedPlayers.map(p => (
          <div key={p.id} style={{
            flexShrink: 0, background: "rgba(255,255,255,0.04)",
            border: `1px solid ${p.id === currentPid ? p.color : "rgba(255,255,255,0.07)"}`,
            borderRadius: 10, padding: "8px 12px", minWidth: 90, textAlign: "center",
          }}>
            <div style={{ color: p.color, fontWeight: 700, fontSize: 12 }}>{p.name}</div>
            <div style={{ color: "#f0c040", fontSize: 18, fontWeight: 800 }}>{p.score}</div>
            <div style={{ fontSize: 10, color: "#4a5a6a" }}>
              {Object.keys(p.apertureUsate || {}).length}/8 ap.
            </div>
            {p.aperta && <div style={{ color: p.color, fontSize: 10 }}>✓ aperto</div>}
          </div>
        ))}
      </div>

      {showTable && room.table?.length > 0 && (
        <div style={{
          padding: "10px 12px",
          background: "rgba(0,0,0,0.3)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{ color: "#7a8fa6", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
            Tavolo
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {room.table.map(combo => (
              <div key={combo.id} style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${combo.color}44`,
                borderRadius: 10, padding: 10,
              }}>
                <div style={{ color: combo.color, fontSize: 10, marginBottom: 6, fontWeight: 700 }}>
                  {combo.playerName} — {APERTURE_TYPES.find(a => a.id === combo.type)?.label}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {combo.cards.map((card, idx) => (
                    <div key={card.id} onClick={() => card.isJoker && swapJoker(combo.id, idx)}>
                      <Card card={card} small />
                    </div>
                  ))}
                </div>
                {isMyTurn && me.aperta && (
                  <button onClick={() => addToTableCombo(combo.id)} style={{
                    marginTop: 8, padding: "4px 10px", borderRadius: 6,
                    background: "rgba(240,192,64,0.15)", border: "1px solid rgba(240,192,64,0.3)",
                    color: "#f0c040", fontSize: 11, cursor: "pointer", width: "100%",
                  }}>+ Aggiungi carte selezionate</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, padding: "12px 12px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <span style={{ color: myColor, fontWeight: 700, fontSize: 14 }}>{playerName}</span>
            <span style={{ color: "#7a8fa6", fontSize: 12, marginLeft: 8 }}>
              {myHand.length} carte • {handPoints(myHand)}pt
            </span>
          </div>
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} style={{
              background: "transparent", border: "none", color: "#7a8fa6", fontSize: 12, cursor: "pointer",
            }}>✕ Deseleziona</button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 0 20px" }}>
          {myHand.map(card => (
            <Card
              key={card.id}
              card={card}
              selected={!!selected.find(s => s.id === card.id)}
              onClick={() => toggleSelect(card)}
            />
          ))}
        </div>
      </div>

      <div style={{ padding: "0 12px 10px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {APERTURE_TYPES.map(a => {
            const used = !!me.apertureUsate?.[a.id];
            return (
              <div key={a.id} style={{
                padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                background: used ? `${myColor}22` : "rgba(255,255,255,0.04)",
                color: used ? myColor : "#3a4a5a",
                border: used ? `1px solid ${myColor}44` : "1px solid rgba(255,255,255,0.05)",
              }}>
                {used ? "✓ " : ""}{a.label}
              </div>
            );
          })}
        </div>
      </div>

      {isMyTurn && (
        <div style={{
          padding: "10px 12px 16px",
          background: "rgba(0,0,0,0.4)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 8, flexWrap: "wrap",
        }}>
          {!room.drawnThisTurn && (
            <button onClick={drawCard} style={actionBtn("#3498db")}>🂠 Pesca</button>
          )}
          {room.drawnThisTurn && (
            <>
              <button onClick={() => setShowApertura(true)} style={actionBtn("#9b59b6")}>✨ Apertura</button>
              <button onClick={discardCard} style={actionBtn("#e74c3c")}>🗑 Scarta</button>
            </>
          )}
        </div>
      )}

      <div ref={logRef} style={{
        height: 60, overflowY: "auto", padding: "6px 12px",
        background: "rgba(0,0,0,0.5)", borderTop: "1px solid rgba(255,255,255,0.05)",
      }}>
        {(room.log || []).map((l, i) => (
          <div key={i} style={{ color: "#4a6a7a", fontSize: 11, lineHeight: 1.6 }}>{l}</div>
        ))}
      </div>

      {showApertura && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ color: "#f0c040", margin: "0 0 4px" }}>Scegli Apertura</h3>
            <p style={{ color: "#7a8fa6", fontSize: 12, margin: "0 0 16px" }}>
              Carte selezionate: {selected.length}
            </p>
            {APERTURE_TYPES.map(a => {
              const used = !!me.apertureUsate?.[a.id];
              return (
                <button key={a.id} onClick={() => handleApertura(a.id)} disabled={used} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 10, marginBottom: 6,
                  border: used ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(255,255,255,0.1)",
                  background: used ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.07)",
                  cursor: used ? "not-allowed" : "pointer",
                  opacity: used ? 0.35 : 1, textAlign: "left",
                }}>
                  <span style={{ fontSize: 20 }}>{a.emoji}</span>
                  <div>
                    <div style={{ color: "#e0eaf4", fontWeight: 700, fontSize: 14 }}>
                      {a.label} {used && <span style={{ color: "#e74c3c", fontSize: 11 }}>✗ usata</span>}
                    </div>
                    <div style={{ color: "#7a8fa6", fontSize: 11 }}>{a.desc}</div>
                  </div>
                </button>
              );
            })}
            <button onClick={() => setShowApertura(false)} style={{
              width: "100%", marginTop: 8, padding: 12, borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
              color: "#7a8fa6", cursor: "pointer", fontFamily: "'Georgia', serif",
            }}>Annulla</button>
          </div>
        </div>
      )}

      {showScores && room.status === "handEnd" && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 40 }}>🏆</div>
              <h3 style={{ color: "#f0c040", margin: "8px 0 4px" }}>
                {players[room.handWinner]?.name} chiude la mano!
              </h3>
              <p style={{ color: "#7a8fa6", fontSize: 13, margin: 0 }}>Mano {room.mano}</p>
            </div>
            {sortedPlayers.map(p => (
              <div key={p.id} style={{
                display: "flex", justifyContent: "space-between",
                padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}>
                <span style={{ color: p.color, fontWeight: 700 }}>{p.name}</span>
                <span>
                  {room.handScores?.[p.id] > 0
                    ? <span style={{ color: "#e74c3c" }}>+{room.handScores[p.id]}pt</span>
                    : <span style={{ color: "#2ecc71" }}>0pt ✓</span>}
                  <span style={{ color: "#7a8fa6", fontSize: 12 }}> (tot: {p.score})</span>
                </span>
              </div>
            ))}
            {room.host === playerId && (
              <button onClick={startNewHand} style={{
                width: "100%", marginTop: 20, padding: 14, borderRadius: 12,
                border: "none", background: "linear-gradient(135deg, #f0c040, #e8a020)",
                color: "#1a0a2e", fontWeight: 800, fontSize: 15, cursor: "pointer",
                fontFamily: "'Georgia', serif",
              }}>Prossima Mano →</button>
            )}
            {room.host !== playerId && (
              <p style={{ color: "#7a8fa6", textAlign: "center", fontSize: 13, marginTop: 16 }}>
                In attesa che l'host inizi la prossima mano...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const smallBtn = {
  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#a0b4c8", borderRadius: 8, padding: "6px 12px",
  fontSize: 12, cursor: "pointer", fontFamily: "'Georgia', serif",
};

const actionBtn = (color) => ({
  flex: 1, padding: "12px 0", borderRadius: 10,
  background: `${color}22`, color,
  border: `1px solid ${color}44`,
  fontWeight: 700, fontSize: 14, cursor: "pointer",
  fontFamily: "'Georgia', serif",
});

const modalOverlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 200, padding: 16, fontFamily: "'Georgia', serif",
};

const modalBox = {
  background: "linear-gradient(135deg, #0d1117, #161b22)",
  border: "1px solid rgba(240,192,64,0.25)",
  borderRadius: 20, padding: 24,
  width: "100%", maxWidth: 400,
  maxHeight: "85vh", overflowY: "auto",
};

const loadingStyle = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#0d1117", color: "#f0c040", fontSize: 20, fontFamily: "'Georgia', serif",
};
