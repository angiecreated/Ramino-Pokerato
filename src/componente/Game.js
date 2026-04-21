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
    if (!isValidCombination(newCards)) { showMsg("Le​​​​​​​​​​​​​​​​
