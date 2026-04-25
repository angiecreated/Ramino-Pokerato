import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { ref, onValue, update } from 'firebase/database';
import Card from './Card';
import {
  APERTURE_TYPES, handPoints, isValidTableCombination,
  detectApertura, canChiuderInMano, createDeck, shuffle,
  sortBySuit, sortByValue, sortForTable, canAddToCombo,
  getMissingTrisSuits, getJokerDeclaration, comboHasJoker,
  RANK_ORDER,
} from '../utils/gameLogic';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

export default function Game({ roomCode, playerId, playerName, room: initialRoom }) {
  const [room, setRoom] = useState(initialRoom);
  const [selected, setSelected] = useState([]);
  const [selectionOrder, setSelectionOrder] = useState([]);
  const [showAperture, setShowAperture] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [msg, setMsg] = useState({ text: '', type: 'error' });
  const [showScores, setShowScores] = useState(false);
  const [jokerModal, setJokerModal] = useState(null);
  const [moveMode, setMoveMode] = useState(false);
  const [moveSelected, setMoveSelected] = useState([]);
  const chatRef = useRef(null);
  const dragRef = useRef({ startIdx: null });

  useEffect(() => {
    const unsub = onValue(ref(db, 'rooms/' + roomCode), snap => {
      const data = snap.val();
      if (data) {
        setRoom(data);
        if (data.status === 'handEnd') setShowScores(true);
      }
    });
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [room && room.chatMessages]);

  if (!room) return <div style={s.loading}>Caricamento...</div>;

  const myHand = (room.hands && room.hands[playerId]) || [];
  const players = room.players || {};
  const playerOrder = room.playerOrder || [];
  const currentPid = playerOrder[room.currentPlayerIndex % playerOrder.length];
  const isMyTurn = currentPid === playerId;
  const me = players[playerId] || {};
  const myColor = COLORS[playerOrder.indexOf(playerId)] || '#f0c040';
  const myPoints = handPoints(myHand);
  const detectedApertura = detectApertura(selected);
  const canAbbassa = me.aperta && !me.apertaQuestoTurno && isMyTurn && room.drawnThisTurn;

  const addLog = async (text) => {
    const logs = room.log || [];
    await update(ref(db, 'rooms/' + roomCode), { log: [...logs.slice(-20), text] });
  };

  const showMsg = (text, type) => {
    setMsg({ text, type: type || 'error' });
    setTimeout(() => setMsg({ text: '', type: 'error' }), 3000);
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const msgs = room.chatMessages || [];
    await update(ref(db, 'rooms/' + roomCode), {
      chatMessages: [...msgs.slice(-50), { name: playerName, text: chatInput.trim(), id: Date.now() }]
    });
    setChatInput('');
  };

  // DRAW FROM DECK
  const drawFromDeck = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (room.drawnThisTurn) { showMsg('Hai gia pescato!'); return; }
    let deck = [...(room.deck || [])];
    if (deck.length === 0) {
      const discards = room.discardPile || [];
      deck = shuffle([...discards]);
      await update(ref(db, 'rooms/' + roomCode), { discardPile: [] });
      await addLog('Mazzo finito! Rimescolati gli scarti.');
    }
    const card = deck[0];
    await update(ref(db, 'rooms/' + roomCode), {
      deck: deck.slice(1),
      ['hands/' + playerId]: [...myHand, card],
      drawnThisTurn: true,
      discardAvailable: false,
    });
  };

  // DRAW FROM DISCARD
  const drawFromDiscard = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (room.drawnThisTurn) { showMsg('Hai gia pescato!'); return; }
    if (!room.topDiscard) { showMsg('Nessuna carta negli scarti!'); return; }
    const card = room.topDiscard;
    const newDiscard = [...(room.discardPile || [])];
    await update(ref(db, 'rooms/' + roomCode), {
      topDiscard: newDiscard.length > 0 ? newDiscard[newDiscard.length - 1] : null,
      discardPile: newDiscard.slice(0, -1),
      ['hands/' + playerId]: [...myHand, card],
      drawnThisTurn: true,
      discardAvailable: false,
      firstManoCard: false,
    });
    await addLog(me.name + ' prende la carta scartata.');
  };

  // DISCARD
  const discardCard = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (selected.length !== 1) { showMsg('Seleziona UNA carta da scartare'); return; }
    const card = selected[0];
    if (card.isJoker) { showMsg('Non puoi scartare il jolly!'); return; }

    // Check if card can be added to any table combo (if already opened)
    // Even if opened this turn, cannot discard a card that goes to table
    if (me.aperta) {
      const table = room.table || [];
      const canAdd = table.some(combo => {
        const result = canAddToCombo(combo.cards, [card]);
        return result.valid;
      });
      if (canAdd) {
        showMsg('Non puoi scartare questa carta - puoi aggiungerla al tavolo!');
        return;
      }
    }

    const newHand = myHand.filter(c => c.id !== card.id);
    const newDiscard = [...(room.discardPile || [])];
    if (room.topDiscard) newDiscard.push(room.topDiscard);
    const nextIndex = (room.currentPlayerIndex + 1) % playerOrder.length;

    const updates = {
      ['hands/' + playerId]: newHand,
      discardPile: newDiscard,
      topDiscard: card,
      currentPlayerIndex: nextIndex,
      drawnThisTurn: false,
      discardAvailable: true,
      ['players/' + playerId + '/apertaQuestoTurno']: false,
    };

    // Auto-close if player has 0 cards after discard
    if (newHand.length === 0) {
      const scores = {};
      for (const pid of playerOrder) {
        scores[pid] = pid === playerId ? 0 : handPoints((room.hands && room.hands[pid]) || []);
      }
      for (const pid of playerOrder) {
        updates['players/' + pid + '/score'] = ((players[pid] && players[pid].score) || 0) + (scores[pid] || 0);
        updates['players/' + pid + '/aperta'] = false;
        updates['players/' + pid + '/apertaQuestoTurno'] = false;
      }
      updates.status = 'handEnd';
      updates.handScores = scores;
      updates.handWinner = playerId;
      updates.discardAvailable = false;
    }

    await update(ref(db, 'rooms/' + roomCode), updates);
    setSelected([]);
    setSelectionOrder([]);
    await addLog(me.name + ' scarta ' + card.rank + card.suit);
  };

  // APERTURA
  const handleApertura = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (me.aperta) { showMsg('Hai gia aperto!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte per aprire'); return; }
    const aperturaId = detectApertura(selected);
    if (!aperturaId) { showMsg('Combinazione non valida per apertura! (niente jolly)'); return; }
    if (me.apertureUsate && me.apertureUsate[aperturaId]) {
      showMsg('Apertura gia usata in una partita precedente!'); return;
    }
    const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));
    // Split mixed combos (doppia coppia, full) into separate groups on table
    const nonJokers = selected.filter(c => !c.isJoker);
    const allSameSuit = nonJokers.every(c => c.suit === nonJokers[0].suit);
    const allSameRank = nonJokers.every(c => c.rank === nonJokers[0].rank);
    const isMixed = !allSameSuit && !allSameRank;

    let newCombos = [];
    if (isMixed) {
      // Group by rank and create separate combos
      const rankGroups = {};
      nonJokers.forEach(c => {
        if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
        rankGroups[c.rank].push(c);
      });
      Object.values(rankGroups).forEach(group => {
        const suitOrder = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
        const sorted = [...group].sort((a, b) => (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0));
        newCombos.push({
          id: Date.now().toString() + Math.random(),
          playerId, playerName: me.name, color: myColor,
          cards: sorted,
        });
      });
    } else {
      newCombos.push({
        id: Date.now().toString(), playerId,
        playerName: me.name, color: myColor,
        cards: sortForTable(selected),
      });
    }
    const newTable = [...(room.table || []), ...newCombos];
    const updates = {};
    updates['hands/' + playerId] = newHand;
    updates['players/' + playerId + '/apertureUsate/' + aperturaId] = true;
    updates['players/' + playerId + '/aperta'] = true;
    updates['players/' + playerId + '/apertaQuestoTurno'] = true;
    updates.table = newTable;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setSelected([]);
    setSelectionOrder([]);
    const found = APERTURE_TYPES.find(a => a.id === aperturaId);
    showMsg('Aperto con ' + (found ? found.label : '') + '!', 'success');
    await addLog(me.name + ' apre con ' + (found ? found.label : ''));
  };

  // ABBASSA COMBINAZIONE LIBERA
  const handleAbbassa = async (declaredSuit) => {
    if (!canAbbassa) {
      if (!me.aperta) showMsg('Devi prima aprire!');
      else if (me.apertaQuestoTurno) showMsg('Puoi abbassare dal prossimo turno!');
      else showMsg('Non puoi abbassare adesso');
      return;
    }
    if (selected.length === 0) { showMsg('Seleziona le carte da abbassare'); return; }
    if (!isValidTableCombination(selected)) {
      showMsg('Combinazione non valida! Min 3 carte (tris, poker o scala)'); return;
    }

    // Handle joker declaration in tris
    const jokerCard = selected.find(c => c.isJoker);
    let cardsToPlay = [...selected];

    if (jokerCard) {
      const nonJokers = selected.filter(c => !c.isJoker);
      const isTrisLike = nonJokers.length >= 2 && nonJokers.every(c => c.rank === nonJokers[0].rank);

      if (isTrisLike) {
        if (!declaredSuit) {
          const missingSuits = getMissingTrisSuits(nonJokers);
          if (missingSuits.length > 1) {
            setJokerModal({
              type: 'tris',
              suits: missingSuits,
              onConfirm: (suit) => { setJokerModal(null); handleAbbassa(suit); }
            });
            return;
          } else if (missingSuits.length === 1) {
            const declaration = nonJokers[0].rank + missingSuits[0];
            cardsToPlay = cardsToPlay.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
          }
        } else {
          const declaration = selected.find(c => !c.isJoker).rank + declaredSuit;
          cardsToPlay = cardsToPlay.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
        }
      } else {
        // Scala - auto declare from position
        const sorted = sortForTable(cardsToPlay);
        const declaration = getJokerDeclaration(sorted, jokerCard);
        if (declaration) {
          cardsToPlay = sorted.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
        } else {
          cardsToPlay = sorted;
        }
      }
    } else {
      cardsToPlay = sortForTable(cardsToPlay);
    }

    const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));
    // Split mixed combos into separate groups
    const playNonJokers = cardsToPlay.filter(c => !c.isJoker);
    const playAllSameSuit = playNonJokers.every(c => c.suit === playNonJokers[0].suit);
    const playAllSameRank = playNonJokers.every(c => c.rank === playNonJokers[0].rank);
    const playIsMixed = !playAllSameSuit && !playAllSameRank;

    let newCombos = [];
    if (playIsMixed) {
      const rankGroups = {};
      playNonJokers.forEach(c => {
        if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
        rankGroups[c.rank].push(c);
      });
      const suitOrder = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
      Object.values(rankGroups).forEach(group => {
        const sorted = [...group].sort((a, b) => (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0));
        newCombos.push({
          id: Date.now().toString() + Math.random(),
          playerId, playerName: me.name, color: myColor,
          cards: sorted,
        });
      });
    } else {
      newCombos.push({
        id: Date.now().toString(), playerId,
        playerName: me.name, color: myColor,
        cards: cardsToPlay,
      });
    }

    const newTable = [...(room.table || []), ...newCombos];
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: newHand,
      table: newTable,
    });
    setSelected([]);
    setSelectionOrder([]);
    showMsg('Combinazione abbassata!', 'success');
    await addLog(me.name + ' abbassa una combinazione.');
  };

  // ADD TO EXISTING COMBO
  const addToCombo = async (comboId, declaredSuit) => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (me.apertaQuestoTurno) { showMsg('Puoi aggiungere carte dal prossimo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte da aggiungere'); return; }

    const combo = room.table && room.table.find(c => c.id === comboId);
    if (!combo) return;

    // Check single joker rule
    if (selected.some(c => c.isJoker) && comboHasJoker(combo)) {
      showMsg('Una combinazione puo avere solo un jolly!'); return;
    }

    // Handle joker declaration in tris
    let cardsToAdd = [...selected];
    if (selected.some(c => c.isJoker)) {
      const jokerCard = selected.find(c => c.isJoker);
      const allNonJokers = [...combo.cards.filter(c => !c.isJoker), ...selected.filter(c => !c.isJoker)];
      const isTrisLike = allNonJokers.every(c => c.rank === allNonJokers[0].rank);

      if (isTrisLike) {
        if (!declaredSuit) {
          const missingSuits = getMissingTrisSuits(allNonJokers);
          if (missingSuits.length > 1) {
            setJokerModal({
              type: 'tris',
              suits: missingSuits,
              onConfirm: (suit) => { setJokerModal(null); addToCombo(comboId, suit); }
            });
            return;
          } else if (missingSuits.length === 1) {
            const declaration = allNonJokers[0].rank + missingSuits[0];
            cardsToAdd = cardsToAdd.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
          }
        } else {
          const declaration = allNonJokers[0].rank + declaredSuit;
          cardsToAdd = cardsToAdd.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
        }
      }
    }

    const result = canAddToCombo(combo.cards, cardsToAdd);
    if (!result.valid) { showMsg(result.reason || 'Combinazione non valida!'); return; }

    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: myHand.filter(c => !selected.find(sc => sc.id === c.id)),
      table: room.table.map(c => c.id === comboId ? Object.assign({}, c, { cards: result.newCards }) : c),
    });
    setSelected([]);
    setSelectionOrder([]);
    await addLog(me.name + ' aggiunge carte al tavolo.');
  };

  // SWAP JOKER - show modal to ask where to use the joker
  const swapJoker = async (comboId, jokerIdx) => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (selected.length !== 1 || selected[0].isJoker) {
      showMsg('Seleziona la carta vera da mettere al posto del jolly'); return;
    }
    const combo = room.table && room.table.find(c => c.id === comboId);
    if (!combo) return;
    const joker = combo.cards[jokerIdx];
    if (!joker || !joker.isJoker) return;

    // Validate swap
    const comboWithoutJoker = combo.cards.filter((_, i) => i !== jokerIdx);
    const result = canAddToCombo(comboWithoutJoker, [selected[0]]);
    if (!result.valid) { showMsg('Sostituzione non valida!'); return; }

    // Joker goes to hand - ask player where they want to use it
    // Show modal with available combos on table that accept a joker
    const availableCombos = (room.table || []).filter(c => {
      if (c.id === comboId) return false; // not the same combo
      if (comboHasJoker(c)) return false; // already has joker
      return true;
    });

    const newJoker = Object.assign({}, joker, { declaredAs: null });
    const newHand = myHand.filter(c => c.id !== selected[0].id).concat(newJoker);

    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: newHand,
      table: room.table.map(c => c.id === comboId ? Object.assign({}, c, { cards: result.newCards }) : c),
    });
    setSelected([]);
    showMsg('Hai preso il jolly! Usalo in una combinazione.', 'success');
    await addLog(me.name + ' prende il jolly!');
  };

  // CHIUSURA IN MANO
  const handleChiusura = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (me.apertureUsate && me.apertureUsate.chiusura) { showMsg('Chiusura gia usata!'); return; }

    // Special case: 1 card in hand - can close by discarding it
    if (myHand.length === 1) {
      const card = myHand[0];
      if (card.isJoker) { showMsg('Non puoi scartare il jolly!'); return; }
      const newDiscard = [...(room.discardPile || [])];
      if (room.topDiscard) newDiscard.push(room.topDiscard);
      const scores = {};
      for (const pid of playerOrder) {
        scores[pid] = pid === playerId ? 0 : handPoints((room.hands && room.hands[pid]) || []);
      }
      const updates = {};
      for (const pid of playerOrder) {
        updates['players/' + pid + '/score'] = ((players[pid] && players[pid].score) || 0) + (scores[pid] || 0);
        updates['players/' + pid + '/aperta'] = false;
        updates['players/' + pid + '/apertaQuestoTurno'] = false;
      }
      updates['players/' + playerId + '/apertureUsate/chiusura'] = true;
      updates['hands/' + playerId] = [];
      updates.discardPile = newDiscard;
      updates.topDiscard = card;
      updates.status = 'handEnd';
      updates.handScores = scores;
      updates.handWinner = playerId;
      updates.discardAvailable = false;
      await update(ref(db, 'rooms/' + roomCode), updates);
      setSelected([]);
      await addLog(me.name + ' chiude in mano!');
      return;
    }

    if (selected.length !== myHand.length - 1) {
      showMsg('Seleziona TUTTE le carte tranne una da scartare!'); return;
    }
    const cardToDiscard = myHand.find(c => !selected.find(sc => sc.id === c.id));
    if (cardToDiscard && cardToDiscard.isJoker) { showMsg('Non puoi scartare il jolly!'); return; }
    if (!canChiuderInMano(selected)) { showMsg('Le carte non formano combinazioni valide!'); return; }

    const newDiscard = [...(room.discardPile || [])];
    if (room.topDiscard) newDiscard.push(room.topDiscard);
    const scores = {};
    for (const pid of playerOrder) {
      scores[pid] = pid === playerId ? 0 : handPoints((room.hands && room.hands[pid]) || []);
    }
    const updates = {};
    for (const pid of playerOrder) {
      updates['players/' + pid + '/score'] = ((players[pid] && players[pid].score) || 0) + (scores[pid] || 0);
      updates['players/' + pid + '/aperta'] = false;
      updates['players/' + pid + '/apertaQuestoTurno'] = false;
    }
    updates['players/' + playerId + '/apertureUsate/chiusura'] = true;
    updates['hands/' + playerId] = [];
    updates.discardPile = newDiscard;
    updates.topDiscard = cardToDiscard;
    updates.status = 'handEnd';
    updates.handScores = scores;
    updates.handWinner = playerId;
    updates.discardAvailable = false;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setSelected([]);
    await addLog(me.name + ' chiude in mano!');
  };

  // NEW HAND
  const startNewHand = async () => {
    const deck = createDeck();
    const hands = {};
    for (const pid of playerOrder) hands[pid] = deck.splice(0, 13);
    const firstCard = deck.splice(0, 1)[0];
    const updates = {
      status: 'playing', deck, discardPile: [], topDiscard: firstCard,
      table: [], currentPlayerIndex: (room.currentPlayerIndex + 1) % playerOrder.length,
      mano: (room.mano || 1) + 1, hands, drawnThisTurn: false,
      handScores: null, handWinner: null,
      discardAvailable: true, firstManoCard: true,
    };
    for (const pid of playerOrder) {
      updates['players/' + pid + '/aperta'] = false;
      updates['players/' + pid + '/apertaQuestoTurno'] = false;
    }
    await update(ref(db, 'rooms/' + roomCode), updates);
    setShowScores(false); setSelected([]); setSelectionOrder([]);
  };

  // SORT HAND
  const sortHandBySuit = async () => {
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: sortBySuit(myHand) });
  };

  const sortHandByValue = async () => {
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: sortByValue(myHand) });
  };

  // SELECT CARD
  const toggleSelect = (card) => {
    if (moveMode) {
      setMoveSelected(prev => prev.find(c => c.id === card.id)
        ? prev.filter(c => c.id !== card.id)
        : [...prev, card]);
    } else {
      setSelected(prev => {
        if (prev.find(c => c.id === card.id)) {
          setSelectionOrder(o => o.filter(c => c.id !== card.id));
          return prev.filter(c => c.id !== card.id);
        } else {
          setSelectionOrder(o => [...o, card]);
          return [...prev, card];
        }
      });
    }
  };

  // MOVE CARDS (tap-tap)
  const moveCardsToPosition = async (targetIdx) => {
    if (!moveMode || moveSelected.length === 0) return;
    const remaining = myHand.filter(c => !moveSelected.find(m => m.id === c.id));
    remaining.splice(targetIdx, 0, ...moveSelected);
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: remaining });
    setMoveSelected([]);
    setMoveMode(false);
  };

  // DRAG AND DROP (desktop)
  const handleDragStart = (idx) => { dragRef.current.startIdx = idx; };
  const handleDrop = async (idx) => {
    const si = dragRef.current.startIdx;
    dragRef.current.startIdx = null;
    if (si === null || si === idx) return;
    const newHand = [...myHand];
    const [moved] = newHand.splice(si, 1);
    newHand.splice(idx, 0, moved);
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: newHand });
  };

  const sortedPlayers = playerOrder.map((pid, i) => Object.assign({}, players[pid], {
    id: pid, color: COLORS[i],
    handCount: ((room.hands && room.hands[pid]) || []).length,
  }));
  const otherPlayers = sortedPlayers.filter(p => p.id !== playerId);

  return (
    <div style={s.root}>
      {/* HEADER */}
      <div style={s.header}>
        <span style={s.headerTitle}>POKERAMI</span>
        <span style={s.headerMano}>MANO {room.mano}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => setShowAperture(!showAperture)} style={s.headerBtn}>APERTURE</button>
        </div>
      </div>

      {/* TURN BANNER */}
      <div style={Object.assign({}, s.turnBanner, {
        background: isMyTurn ? 'rgba(240,192,64,0.12)' : 'rgba(0,0,0,0.2)',
        borderBottom: '2px solid ' + (isMyTurn ? '#f0c040' : 'transparent'),
      })}>
        <span style={{ color: isMyTurn ? '#f0c040' : '#4a6a7a', fontWeight: 800, letterSpacing: 2, fontSize: 12 }}>
          {isMyTurn ? 'TOCCA A TE!' : 'TURNO DI ' + ((players[currentPid] && players[currentPid].name) || '...').toUpperCase()}
        </span>
      </div>

      {/* MESSAGE */}
      {msg.text && (
        <div style={Object.assign({}, s.msgBar, {
          background: msg.type === 'success' ? '#1a5a3a' : '#5a1a1a',
          borderColor: msg.type === 'success' ? '#2ecc71' : '#e74c3c',
        })}>{msg.text}</div>
      )}

      {/* APERTURE PANEL */}
      {showAperture && (
        <div style={s.aperturePanel}>
          {sortedPlayers.map(p => (
            <div key={p.id} style={s.aperturePlayerRow}>
              <span style={{ color: p.color, fontWeight: 800, fontSize: 10, minWidth: 70 }}>
                {p.name && p.name.toUpperCase()}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {APERTURE_TYPES.map(a => {
                  const used = p.apertureUsate && !!p.apertureUsate[a.id];
                  return (
                    <div key={a.id} style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: 8, fontWeight: 700,
                      background: used ? 'rgba(255,255,255,0.03)' : p.color + '18',
                      color: used ? '#3a4a5a' : p.color,
                      border: '1px solid ' + (used ? 'rgba(255,255,255,0.04)' : p.color + '44'),
                      textDecoration: used ? 'line-through' : 'none',
                    }}>
                      {used && 'x '}{a.label}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TABLE AREA */}
      <div style={s.tableArea}>
        {/* Other players */}
        <div style={s.otherPlayersRow}>
          {otherPlayers.map(p => (
            <div key={p.id} style={Object.assign({}, s.otherPlayerChip, {
              borderColor: p.id === currentPid ? p.color : 'rgba(255,255,255,0.08)',
              boxShadow: p.id === currentPid ? '0 0 14px ' + p.color + '55' : 'none',
            })}>
              <div style={{ color: p.color, fontWeight: 900, fontSize: 11 }}>
                {p.name && p.name.toUpperCase()}
              </div>
              <div style={{ display: 'flex', marginTop: 4 }}>
                {Array.from({ length: Math.min(p.handCount, 7) }).map((_, i) => (
                  <div key={i} style={{
                    width: 18, height: 26, borderRadius: 3,
                    background: 'linear-gradient(135deg, #0d3a5c, #071f3a)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    marginLeft: i > 0 ? -7 : 0,
                  }} />
                ))}
                {p.handCount > 7 && <span style={{ color: '#4a6a7a', fontSize: 9, marginLeft: 4, alignSelf: 'center' }}>+{p.handCount - 7}</span>}
              </div>
              <div style={{ color: '#f0c040', fontSize: 10, fontWeight: 800, marginTop: 3 }}>{p.score}pt</div>
              {p.aperta && <div style={{ color: p.color, fontSize: 8 }}>APERTO</div>}
            </div>
          ))}
        </div>

        {/* Table combinations */}
        <div style={s.tableCombosArea}>
          {(!room.table || room.table.length === 0) ? (
            <div style={{ color: '#1a3a4a', fontSize: 10, textAlign: 'center', padding: '4px 0' }}>Tavolo vuoto</div>
          ) : (
            <div style={s.tableCombos}>
              {room.table.map(combo => (
                <div key={combo.id} style={Object.assign({}, s.tableCombo, { borderColor: combo.color + '55' })}>
                  <div style={{ color: combo.color, fontSize: 8, fontWeight: 800, marginBottom: 4 }}>
                    {combo.playerName && combo.playerName.toUpperCase()}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {combo.cards.map((card, idx) => (
                      <div key={card.id}
                        onClick={() => card.isJoker && isMyTurn && me.aperta ? swapJoker(combo.id, idx) : null}
                        style={{ cursor: card.isJoker && isMyTurn && me.aperta ? 'pointer' : 'default' }}>
                        <Card card={card} small />
                      </div>
                    ))}
                  </div>
                  {canAbbassa && selected.length > 0 && (
                    <button onClick={() => addToCombo(combo.id)} style={s.addBtn}>+ AGGIUNGI</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deck and Discard */}
        <div style={s.deckDiscardRow}>
          <div style={s.deckArea}>
            <div style={s.deckLabel}>TALLONE ({(room.deck || []).length})</div>
            <div onClick={isMyTurn && !room.drawnThisTurn ? drawFromDeck : null}
              style={Object.assign({}, s.deckCard, {
                cursor: isMyTurn && !room.drawnThisTurn ? 'pointer' : 'default',
                boxShadow: isMyTurn && !room.drawnThisTurn ? '0 0 12px rgba(240,192,64,0.3)' : '2px 4px 10px rgba(0,0,0,0.5)',
              })}>
              <div style={{ fontSize: 22 }}>🂠</div>
            </div>
          </div>
          <div style={s.deckArea}>
            <div style={s.deckLabel}>POZZO</div>
            {room.topDiscard ? (
              <div onClick={isMyTurn && !room.drawnThisTurn ? drawFromDiscard : null}
                style={{ cursor: isMyTurn && !room.drawnThisTurn ? 'pointer' : 'default' }}>
                <Card card={room.topDiscard} />
              </div>
            ) : (
              <div style={s.emptyDiscard}>VUOTO</div>
            )}
          </div>
        </div>
      </div>

      {/* MY HAND */}
      <div style={s.handArea}>
        <div style={s.handHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: myColor, fontWeight: 900, fontSize: 13, letterSpacing: 1 }}>
              {playerName && playerName.toUpperCase()}
            </span>
            <span style={{ color: '#4a6a7a', fontSize: 10 }}>{myHand.length} carte</span>
            <span style={{
              fontWeight: 900, fontSize: 12,
              color: myPoints > 50 ? '#e74c3c' : myPoints > 25 ? '#f39c12' : '#2ecc71',
            }}>{myPoints}PT</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={sortHandBySuit} style={s.sortBtn}>♠ SEME</button>
            <button onClick={sortHandByValue} style={s.sortBtn}>7 VALORE</button>
            <button onClick={() => { setMoveMode(!moveMode); setMoveSelected([]); setSelected([]); }}
              style={Object.assign({}, s.sortBtn, {
                color: moveMode ? '#f0c040' : '#4a8fa6',
                border: '1px solid ' + (moveMode ? 'rgba(240,192,64,0.4)' : 'rgba(255,255,255,0.1)'),
              })}>
              {moveMode ? 'ANNULLA' : 'SPOSTA'}
            </button>
            {!moveMode && selected.length > 0 && (
              <button onClick={() => { setSelected([]); setSelectionOrder([]); }} style={s.clearBtn}>
                x ({selected.length})
              </button>
            )}
          </div>
        </div>

        {/* Hints */}
        {moveMode && (
          <div style={s.hint('#f39c12')}>
            {moveSelected.length === 0 ? 'TOCCA LE CARTE DA SPOSTARE' : 'TOCCA LA POSIZIONE DOVE INSERIRLE'}
          </div>
        )}
        {!moveMode && selected.length > 0 && detectedApertura && !me.aperta && !(me.apertureUsate && me.apertureUsate[detectedApertura]) && (
          <div style={s.hint('#9b59b6')}>
            APERTURA: {APERTURE_TYPES.find(a => a.id === detectedApertura) ? APERTURE_TYPES.find(a => a.id === detectedApertura).label : ''}
          </div>
        )}
        {!moveMode && selected.length > 0 && canAbbassa && isValidTableCombination(selected) && (
          <div style={s.hint('#3498db')}>COMBINAZIONE VALIDA - puoi abbassarla!</div>
        )}

        {/* Cards */}
        <div style={s.handCards}>
          {moveMode && moveSelected.length > 0 && (
            <div onClick={() => moveCardsToPosition(0)} style={s.insertSlot} />
          )}
          {myHand.map((card, idx) => {
            const isSelected = !!selected.find(c => c.id === card.id);
            const isMoveSelected = !!moveSelected.find(c => c.id === card.id);
            return (
              <React.Fragment key={card.id}>
                <div
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(idx)}
                  onClick={() => toggleSelect(card)}
                  style={{
                    marginLeft: idx === 0 ? 0 : (moveMode ? 4 : -24),
                    zIndex: isMoveSelected || isSelected ? 100 : idx,
                    position: 'relative',
                    transition: 'margin 0.1s',
                    opacity: isMoveSelected ? 0.5 : 1,
                  }}
                >
                  <Card card={card} selected={isMoveSelected || (!moveMode && isSelected)} />
                </div>
                {moveMode && moveSelected.length > 0 && !isMoveSelected && (
                  <div onClick={() => moveCardsToPosition(idx + 1)} style={s.insertSlot} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* My aperture badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingBottom: 6 }}>
          {APERTURE_TYPES.map(a => {
            const used = me.apertureUsate && !!me.apertureUsate[a.id];
            return (
              <div key={a.id} style={{
                padding: '2px 6px', borderRadius: 4, fontSize: 8, fontWeight: 700,
                background: used ? 'rgba(255,255,255,0.03)' : myColor + '18',
                color: used ? '#2a3a4a' : myColor,
                border: '1px solid ' + (used ? 'rgba(255,255,255,0.04)' : myColor + '44'),
                textDecoration: used ? 'line-through' : 'none',
              }}>
                {used && 'x '}{a.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* ACTIONS */}
      {isMyTurn && (
        <div style={s.actions}>
          {!room.drawnThisTurn ? (
            <button onClick={drawFromDeck} style={s.actionBtn('#3498db', null)}>PESCA</button>
          ) : (
            <React.Fragment>
              {!me.aperta && selected.length > 0 && detectedApertura && !(me.apertureUsate && me.apertureUsate[detectedApertura]) && (
                <button onClick={handleApertura} style={s.actionBtn('#9b59b6', null)}>
                  APRI: {APERTURE_TYPES.find(a => a.id === detectedApertura) ? APERTURE_TYPES.find(a => a.id === detectedApertura).label : ''}
                </button>
              )}
              {canAbbassa && selected.length > 0 && isValidTableCombination(selected) && (
                <button onClick={() => handleAbbassa()} style={s.actionBtn('#2ecc71', null)}>ABBASSA</button>
              )}
              {selected.length === myHand.length - 1 && !(me.apertureUsate && me.apertureUsate.chiusura) && (
                <button onClick={handleChiusura} style={s.actionBtn('#f0c040', '#061a26')}>CHIUDI</button>
              )}
              <button onClick={discardCard} style={s.actionBtn('#e74c3c', null)}>SCARTA</button>
            </React.Fragment>
          )}
        </div>
      )}

      {/* CHAT */}
      <div style={s.chatArea}>
        <div ref={chatRef} style={s.chatMessages}>
          {(room.chatMessages || []).slice(-4).map(m => (
            <div key={m.id} style={s.chatMsg}>
              <span style={{ color: '#f0c040', fontWeight: 800 }}>{m.name}: </span>
              <span style={{ color: '#c0d4e0' }}>{m.text}</span>
            </div>
          ))}
        </div>
        <div style={s.chatInput}>
          <input value={chatInput} onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder='Scrivi nella chat...' style={s.chatInputField}
            autoComplete='off' autoCorrect='off' spellCheck='false' />
          <button onClick={sendChat} style={s.chatSend}>INVIA</button>
        </div>
      </div>

      {/* JOKER MODAL */}
      {jokerModal && (
        <div style={s.modalOverlay}>
          <div style={Object.assign({}, s.modal, { maxWidth: 280, textAlign: 'center' })}>
            <h3 style={{ color: '#f0c040', margin: '0 0 8px', fontSize: 16, letterSpacing: 2 }}>DICHIARA IL JOLLY</h3>
            <p style={{ color: '#4a6a7a', fontSize: 12, marginBottom: 16 }}>Quale seme rappresenta?</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              {jokerModal.suits.map(suit => (
                <button key={suit} onClick={() => jokerModal.onConfirm(suit)} style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: (suit === '\u2665' || suit === '\u2666') ? 'rgba(192,57,43,0.2)' : 'rgba(26,26,46,0.5)',
                  color: (suit === '\u2665' || suit === '\u2666') ? '#e74c3c' : '#e0eaf4',
                  fontSize: 28, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)',
                }}>
                  {suit}
                </button>
              ))}
            </div>
            <button onClick={() => setJokerModal(null)} style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#4a6a7a', cursor: 'pointer', fontSize: 12 }}>
              ANNULLA
            </button>
          </div>
        </div>
      )}

      {/* SCORES MODAL */}
      {showScores && room.status === 'handEnd' && (
        <div style={s.modalOverlay}>
          <div style={s.modal}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h3 style={s.modalTitle}>
                {players[room.handWinner] && players[room.handWinner].name && players[room.handWinner].name.toUpperCase()} CHIUDE!
              </h3>
              <p style={{ color: '#4a6a7a', fontSize: 11, letterSpacing: 2 }}>FINE MANO {room.mano}</p>
            </div>
            {sortedPlayers.map(p => (
              <div key={p.id} style={s.scoreRow}>
                <span style={{ color: p.color, fontWeight: 800 }}>{p.name && p.name.toUpperCase()}</span>
                <span>
                  {room.handScores && room.handScores[p.id] > 0
                    ? <span style={{ color: '#e74c3c', fontWeight: 800 }}>+{room.handScores[p.id]}</span>
                    : <span style={{ color: '#2ecc71', fontWeight: 800 }}>0</span>}
                  <span style={{ color: '#4a6a7a', fontSize: 11 }}> tot: {p.score}</span>
                </span>
              </div>
            ))}
            {room.host === playerId ? (
              <button onClick={startNewHand} style={Object.assign({}, s.actionBtn('#f0c040', '#061a26'), { width: '100%', marginTop: 20 })}>
                PROSSIMA MANO
              </button>
            ) : (
              <p style={{ color: '#4a6a7a', textAlign: 'center', fontSize: 11, marginTop: 16 }}>In attesa dell host...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  root: { minHeight: '100vh', background: 'linear-gradient(180deg, #061a26 0%, #0a2e3d 40%, #061a26 100%)', fontFamily: 'Georgia, serif', color: '#e0eaf4', display: 'flex', flexDirection: 'column', userSelect: 'none' },
  loading: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#061a26', color: '#f0c040', fontSize: 18, letterSpacing: 3 },
  header: { background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#f0c040', fontWeight: 900, fontSize: 16, letterSpacing: 4 },
  headerMano: { color: '#2a4a5a', fontSize: 11, letterSpacing: 2 },
  headerBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#4a8fa6', borderRadius: 6, padding: '5px 10px', fontSize: 9, cursor: 'pointer', letterSpacing: 1, fontFamily: 'Georgia, serif' },
  turnBanner: { padding: '7px 14px', textAlign: 'center' },
  msgBar: { padding: '7px 14px', textAlign: 'center', fontSize: 12, border: '1px solid', letterSpacing: 1, fontWeight: 700 },
  aperturePanel: { background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 12px', maxHeight: 160, overflowY: 'auto' },
  aperturePlayerRow: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  tableArea: { background: 'linear-gradient(180deg, #0d3a4a 0%, #0a2e3a 100%)', borderBottom: '2px solid rgba(10,140,180,0.15)', padding: '8px 12px' },
  otherPlayersRow: { display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  otherPlayerChip: { background: 'rgba(0,0,0,0.35)', border: '1px solid', borderRadius: 10, padding: '7px 10px', textAlign: 'center', minWidth: 75, transition: 'box-shadow 0.2s' },
  tableCombosArea: { minHeight: 50, marginBottom: 6 },
  tableCombos: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tableCombo: { background: 'rgba(0,0,0,0.3)', border: '1px solid', borderRadius: 7, padding: 6 },
  addBtn: { marginTop: 4, padding: '2px 6px', borderRadius: 4, background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.3)', color: '#f0c040', fontSize: 8, cursor: 'pointer', width: '100%', letterSpacing: 1, fontFamily: 'Georgia, serif' },
  deckDiscardRow: { display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-end' },
  deckArea: { textAlign: 'center' },
  deckLabel: { color: '#2a5a6a', fontSize: 9, letterSpacing: 1, marginBottom: 4 },
  deckCard: { width: 58, height: 84, borderRadius: 7, background: 'linear-gradient(135deg, #0d3a5c, #071f3a)', border: '1.5px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  emptyDiscard: { width: 58, height: 84, borderRadius: 7, border: '2px dashed rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a3a4a', fontSize: 9 },
  handArea: { flex: 1, background: '#051520', padding: '10px 12px 0', borderTop: '2px solid rgba(10,100,140,0.25)' },
  handHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  hint: (color) => ({ background: color + '12', border: '1px solid ' + color + '35', borderRadius: 5, padding: '3px 8px', color: color, fontSize: 9, letterSpacing: 1, fontWeight: 800, marginBottom: 5 }),
  handCards: { display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 12, paddingTop: 4, minHeight: 96 },
  insertSlot: { width: 14, height: 84, borderRadius: 4, background: 'rgba(240,192,64,0.15)', border: '2px dashed rgba(240,192,64,0.5)', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start', marginTop: 6 },
  sortBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#4a8fa6', borderRadius: 5, padding: '3px 7px', fontSize: 8, cursor: 'pointer', letterSpacing: 0.5, fontFamily: 'Georgia, serif' },
  clearBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#4a6a7a', borderRadius: 5, padding: '3px 7px', fontSize: 8, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  actions: { padding: '8px 12px 10px', background: 'rgba(0,0,0,0.5)', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 8, flexWrap: 'wrap' },
  actionBtn: (color, textColor) => ({ flex: 1, padding: '11px 8px', borderRadius: 9, border: textColor ? 'none' : '1px solid ' + color + '44', background: textColor ? 'linear-gradient(135deg, ' + color + ', ' + color + 'cc)' : color + '18', color: textColor || color, fontWeight: 900, fontSize: 11, cursor: 'pointer', letterSpacing: 1, fontFamily: 'Georgia, serif' }),
  chatArea: { background: 'rgba(0,0,0,0.35)', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '6px 12px 16px' },
  chatMessages: { overflowY: 'auto', maxHeight: 55, marginBottom: 5 },
  chatMsg: { fontSize: 11, marginBottom: 2, lineHeight: 1.4 },
  chatInput: { display: 'flex', gap: 5 },
  chatInputField: { flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 8px', color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'Georgia, serif' },
  chatSend: { background: 'linear-gradient(135deg, #f0c040, #c8860a)', border: 'none', borderRadius: 7, color: '#061a26', fontWeight: 900, fontSize: 9, padding: '5px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16, fontFamily: 'Georgia, serif' },
  modal: { background: 'linear-gradient(135deg, #061a26, #0a2e3d)', border: '1px solid rgba(240,192,64,0.2)', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, maxHeight: '85vh', overflowY: 'auto' },
  modalTitle: { color: '#f0c040', margin: '8px 0 4px', fontSize: 18, letterSpacing: 3 },
  scoreRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', letterSpacing: 1 },
};
