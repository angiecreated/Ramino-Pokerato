import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { ref, onValue, update } from 'firebase/database';
import Card from './Card';
import {
  APERTURE_TYPES, handPoints, isValidCombination, isValidTableCombination,
  detectApertura, canChiuderInMano, createDeck, shuffle, sortBySuit, sortByValue,
  comboHasJoker, getMissingTrisSuits, getJokerDeclaration,
} from '../utils/gameLogic';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

export default function Game({ roomCode, playerId, playerName, room: initialRoom }) {
  const [room, setRoom] = useState(initialRoom);
  const [selected, setSelected] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const [showAperture, setShowAperture] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [msg, setMsg] = useState({ text: '', type: 'error' });
  const [showScores, setShowScores] = useState(false);
  const [discardTimer, setDiscardTimer] = useState(null);
  const [moveMode, setMoveMode] = useState(false);
  const [moveSelected, setMoveSelected] = useState([]);
  const [selectionOrder, setSelectionOrder] = useState([]);
  const [jokerModal, setJokerModal] = useState(null);
  const chatRef = useRef(null);
  const touchRef = useRef({ active: false, startIdx: null, startX: 0, startY: 0 });
  const timerRef = useRef(null);

  useEffect(() => {
    const unsub = onValue(ref(db, 'rooms/' + roomCode), snap => {
      const data = snap.val();
      if (data) {
        setRoom(data);
        if (data.status === 'handEnd') setShowScores(true);
        // Start discard timer when someone draws
        if (data.discardAvailable && data.discardAvailableAt) {
          const elapsed = Date.now() - data.discardAvailableAt;
          const remaining = Math.max(0, 10 - Math.floor(elapsed / 1000));
          setDiscardTimer(remaining);
        } else {
          setDiscardTimer(null);
        }
      }
    });
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [room && room.chatMessages]);

  // Countdown timer for discard
  useEffect(() => {
    if (discardTimer === null) return;
    if (discardTimer <= 0) {
      // Time's up - clear discard availability
      update(ref(db, 'rooms/' + roomCode), { discardAvailable: false, discardQueue: [] });
      return;
    }
    timerRef.current = setTimeout(() => setDiscardTimer(t => t !== null ? t - 1 : null), 1000);
    return () => clearTimeout(timerRef.current);
  }, [discardTimer]);

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
  const myPlayerIndex = playerOrder.indexOf(playerId);

  // Can I take the discard?
  const canTakeDiscard = room.discardAvailable && !isMyTurn && room.topDiscard;
  const imInQueue = room.discardQueue && room.discardQueue.includes(playerId);
  const isFirstPlayer = myPlayerIndex === 0;
  const isFirstManoCard = room.firstManoCard && room.manoCardTaken === false;

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

  // Take first mano card (only first player)
  const takeFirstManoCard = async () => {
    if (!isFirstPlayer || room.manoCardTaken) return;
    const card = room.topDiscard;
    if (!card) return;
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: [...myHand, card],
      topDiscard: null,
      manoCardTaken: true,
      drawnThisTurn: true,
    });
    await addLog(playerName + ' prende la prima carta.');
  };

  const drawFromDeck = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (room.drawnThisTurn) { showMsg('Hai gia pescato!'); return; }
    let deck = [...(room.deck || [])];
    if (deck.length === 0) {
      const tablePoker = (room.table || []).filter(c => c.type === 'poker').flatMap(c => c.cards);
      deck = shuffle([...tablePoker, ...(room.discardPile || [])]);
      await update(ref(db, 'rooms/' + roomCode), { discardPile: [], topDiscard: null });
      await addLog('Mazzo finito! Rimescolati.');
    }
    const card = deck[0];
    await update(ref(db, 'rooms/' + roomCode), {
      deck: deck.slice(1),
      ['hands/' + playerId]: [...myHand, card],
      drawnThisTurn: true,
      discardAvailable: true,
      discardAvailableAt: Date.now(),
      discardQueue: [],
    });
  };

  const drawFromDiscard = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (room.drawnThisTurn) { showMsg('Hai gia pescato!'); return; }
    if (!room.topDiscard) { showMsg('Nessuna carta!'); return; }
    const card = room.topDiscard;
    const newDiscard = [...(room.discardPile || [])];
    await update(ref(db, 'rooms/' + roomCode), {
      topDiscard: newDiscard.length > 0 ? newDiscard[newDiscard.length - 1] : null,
      discardPile: newDiscard.slice(0, -1),
      ['hands/' + playerId]: [...myHand, card],
      drawnThisTurn: true,
      discardAvailable: false,
      discardQueue: [],
    });
    await addLog(playerName + ' prende la carta scartata.');
  };

  // Take discard out of turn
  const takeDiscardOutOfTurn = async () => {
    if (!canTakeDiscard || imInQueue) return;
    if (!room.topDiscard) return;
    // Check if I'm next in queue priority (by player order from current)
    const queue = room.discardQueue || [];
    const currentIdx = room.currentPlayerIndex % playerOrder.length;
    // Add me to queue
    const newQueue = [...queue, playerId];
    await update(ref(db, 'rooms/' + roomCode), { discardQueue: newQueue });
    showMsg('Sei in coda per lo scarto!', 'success');
  };

  // Claim discard from queue
  const claimDiscardFromQueue = async () => {
    if (!room.discardAvailable || !room.topDiscard) return;
    const queue = room.discardQueue || [];
    if (queue[0] !== playerId) { showMsg('Non e il tuo turno nella coda!'); return; }
    const card = room.topDiscard;
    const newDiscard = [...(room.discardPile || [])];
    await update(ref(db, 'rooms/' + roomCode), {
      topDiscard: newDiscard.length > 0 ? newDiscard[newDiscard.length - 1] : null,
      discardPile: newDiscard.slice(0, -1),
      ['hands/' + playerId]: [...myHand, card],
      discardAvailable: false,
      discardQueue: [],
    });
    await addLog(playerName + ' prende lo scarto dalla coda.');
  };

  const passDiscardQueue = async () => {
    const queue = room.discardQueue || [];
    if (queue[0] !== playerId) return;
    const newQueue = queue.slice(1);
    await update(ref(db, 'rooms/' + roomCode), {
      discardQueue: newQueue,
      discardAvailable: newQueue.length > 0,
    });
  };

  const discardCard = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (selected.length !== 1) { showMsg('Seleziona UNA carta da scartare'); return; }
    const card = selected[0];
    if (card.isJoker) { showMsg('Non puoi scartare il jolly!'); return; }
    const newDiscard = [...(room.discardPile || [])];
    if (room.topDiscard) newDiscard.push(room.topDiscard);
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: myHand.filter(c => c.id !== card.id),
      discardPile: newDiscard, topDiscard: card,
      currentPlayerIndex: (room.currentPlayerIndex + 1) % playerOrder.length,
      drawnThisTurn: false,
      discardAvailable: false,
      discardQueue: [],
    });
    setSelected([]);
    await addLog(playerName + ' scarta ' + card.rank + card.suit);
  };

  const handleApertura = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (me.aperta) { showMsg('Hai gia aperto!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte per aprire'); return; }
    const aperturaId = detectApertura(selected);
    if (!aperturaId) { showMsg('Combinazione non valida! Niente jolly in apertura.'); return; }
    if (me.apertureUsate && me.apertureUsate[aperturaId]) { showMsg('Apertura gia usata!'); return; }
    const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));
    const newTable = [...(room.table || []), {
      id: Date.now().toString(), playerId, playerName: me.name,
      color: myColor, type: aperturaId, cards: selected,
    }];
    const updates = {};
    updates['hands/' + playerId] = newHand;
    updates['players/' + playerId + '/apertureUsate/' + aperturaId] = true;
    updates['players/' + playerId + '/aperta'] = true;
    updates.table = newTable;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setSelected([]);
    const found = APERTURE_TYPES.find(a => a.id === aperturaId);
    showMsg('Aperto con ' + (found ? found.label : '') + '!', 'success');
    await addLog(me.name + ' apre con ' + (found ? found.label : ''));
  };

  const handleAbbassCombinazione = async (declaredSuit) => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte da abbassare'); return; }

    const jokerCount = selected.filter(c => c.isJoker).length;
    if (jokerCount > 1) { showMsg('Una combinazione puo avere solo un jolly!'); return; }

    if (!isValidTableCombination(selected)) {
      showMsg('Solo tris, poker o scala (min 3 carte)!'); return;
    }

    // Handle joker declaration
    let cardsToPlay = [...selected];
    if (jokerCount === 1) {
      const jokerCard = selected.find(c => c.isJoker);
      const isTrisLike = selected.filter(c => !c.isJoker).every(c => c.rank === selected.find(nc => !nc.isJoker).rank);

      if (isTrisLike && !declaredSuit) {
        // Need to declare suit for tris
        const missingSuits = getMissingTrisSuits(selected);
        if (missingSuits.length > 1) {
          setJokerModal({ type: 'tris', suits: missingSuits, onConfirm: (suit) => {
            setJokerModal(null);
            handleAbbassCombinazione(suit);
          }});
          return;
        }
      }

      // Auto-declare for scala based on selection order
      let declaration = null;
      if (isTrisLike) {
        if (declaredSuit) {
          const nonJokerCard = selected.find(c => !c.isJoker);
          declaration = nonJokerCard.rank + declaredSuit;
        }
      } else {
        declaration = getJokerDeclaration(selectionOrder, jokerCard);
      }

      if (declaration && typeof declaration === 'string') {
        cardsToPlay = cardsToPlay.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
      }
    }

    const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));
    const newTable = [...(room.table || []), {
      id: Date.now().toString(), playerId, playerName: me.name,
      color: myColor, type: 'libera', cards: cardsToPlay,
    }];
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: newHand, table: newTable,
    });
    setSelected([]);
    setSelectionOrder([]);
    showMsg('Combinazione abbassata!', 'success');
    await addLog(me.name + ' abbassa una combinazione.');
  };

  const addToCombo = async (comboId) => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte'); return; }
    const combo = room.table && room.table.find(c => c.id === comboId);
    if (!combo) return;
    const addingJoker = selected.some(c => c.isJoker);
    if (addingJoker && comboHasJoker(combo)) {
      showMsg('Una combinazione puo avere solo un jolly!'); return;
    }
    let cardsToAdd = [...selected];
    if (addingJoker) {
      const jokerCard = selected.find(c => c.isJoker);
      const allCards = [...combo.cards, ...selected];
      const nonJokers = allCards.filter(c => !c.isJoker);
      const isTrisLike = nonJokers.every(c => c.rank === nonJokers[0].rank);
      if (isTrisLike) {
        const missingSuits = getMissingTrisSuits(allCards.filter(c => !c.isJoker));
        if (missingSuits.length > 1) {
          setJokerModal({ type: 'tris', suits: missingSuits, onConfirm: async (suit) => {
            setJokerModal(null);
            const declaration = nonJokers[0].rank + suit;
            const declaredCards = cardsToAdd.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
            const newCards = [...combo.cards, ...declaredCards];
            await update(ref(db, 'rooms/' + roomCode), {
              ['hands/' + playerId]: myHand.filter(c => !selected.find(sc => sc.id === c.id)),
              table: room.table.map(c => c.id === comboId ? Object.assign({}, c, { cards: newCards }) : c),
            });
            setSelected([]);
            await addLog(me.name + ' aggiunge carte al tavolo.');
          }});
          return;
        } else if (missingSuits.length === 1) {
          const declaration = nonJokers[0].rank + missingSuits[0];
          cardsToAdd = cardsToAdd.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
        }
      } else {
        const declaration = getJokerDeclaration(selectionOrder, jokerCard);
        if (declaration && typeof declaration === 'string') {
          cardsToAdd = cardsToAdd.map(c => c.isJoker ? Object.assign({}, c, { declaredAs: declaration }) : c);
        }
      }
    }
    const newCards = [...combo.cards, ...cardsToAdd];
    // After opening, just check if resulting cards are valid - no type restriction
    const allNonJokers = newCards.filter(c => !c.isJoker);
    const allSameRank = allNonJokers.every(c => c.rank === allNonJokers[0].rank);
    const allSameSuit = allNonJokers.every(c => c.suit === allNonJokers[0].suit);
    const noDupSuits = new Set(allNonJokers.map(c => c.suit)).size === allNonJokers.length;
    const jokerCount = newCards.filter(c => c.isJoker).length;

    let valid = false;
    if (jokerCount <= 1) {
      // Tris/Poker: same rank, no duplicate suits, 2-4 cards
      if (allSameRank && noDupSuits && newCards.length >= 2 && newCards.length <= 4) valid = true;
      // Scala: same suit, sequential
      if (allSameSuit && newCards.length >= 3) {
        const orders = allNonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
        let gaps = 0;
        for (let i = 1; i < orders.length; i++) gaps += orders[i] - orders[i-1] - 1;
        if (gaps <= jokerCount) valid = true;
      }
    }
    if (!valid) { showMsg('Combinazione non valida!'); return; }
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: myHand.filter(c => !selected.find(sc => sc.id === c.id)),
      table: room.table.map(c => c.id === comboId ? Object.assign({}, c, { cards: newCards }) : c),
    });
    setSelected([]);
    await addLog(me.name + ' aggiunge carte al tavolo.');
  };

  const swapJoker = async (comboId, jokerIdx) => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (selected.length !== 1 || selected[0].isJoker) { showMsg('Seleziona la carta vera'); return; }
    const combo = room.table && room.table.find(c => c.id === comboId);
    if (!combo) return;
    const joker = combo.cards[jokerIdx];
    if (!joker || !joker.isJoker) return;
    const newComboCards = [...combo.cards];
    newComboCards[jokerIdx] = selected[0];
    if (!isValidCombination(newComboCards)) { showMsg('Sostituzione non valida!'); return; }
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: myHand.filter(c => c.id !== selected[0].id).concat(joker),
      table: room.table.map(c => c.id === comboId ? Object.assign({}, c, { cards: newComboCards }) : c),
    });
    setSelected([]);
    await addLog(me.name + ' prende un jolly!');
  };

  const handleChiusura = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (me.apertureUsate && me.apertureUsate.chiusura) { showMsg('Chiusura gia usata!'); return; }
    if (selected.length !== myHand.length - 1) { showMsg('Seleziona TUTTE le carte tranne una!'); return; }
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
    }
    updates['players/' + playerId + '/apertureUsate/chiusura'] = true;
    updates['hands/' + playerId] = [];
    updates.discardPile = newDiscard;
    updates.topDiscard = cardToDiscard;
    updates.status = 'handEnd';
    updates.handScores = scores;
    updates.handWinner = playerId;
    updates.discardAvailable = false;
    updates.discardQueue = [];
    await update(ref(db, 'rooms/' + roomCode), updates);
    setSelected([]);
    await addLog(me.name + ' chiude in mano!');
  };

  const startNewHand = async () => {
    const deck = createDeck();
    const hands = {};
    for (const pid of playerOrder) hands[pid] = deck.splice(0, 13);
    // First card face up
    const firstCard = deck.splice(0, 1)[0];
    const updates = {
      status: 'playing', deck, discardPile: [], topDiscard: firstCard,
      table: [], currentPlayerIndex: (room.currentPlayerIndex + 1) % playerOrder.length,
      mano: (room.mano || 1) + 1, hands, drawnThisTurn: false,
      handScores: null, handWinner: null,
      discardAvailable: false, discardQueue: [],
      firstManoCard: true, manoCardTaken: false,
    };
    for (const pid of playerOrder) updates['players/' + pid + '/aperta'] = false;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setShowScores(false); setSelected([]);
  };

  const sortHandBySuit = async () => {
    const sorted = sortBySuit(myHand);
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: sorted });
  };

  const sortHandByValue = async () => {
    const sorted = sortByValue(myHand);
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: sorted });
  };

  const toggleSelect = (card) => {
    if (moveMode) {
      setMoveSelected(prev => prev.find(c => c.id === card.id) ? prev.filter(c => c.id !== card.id) : [...prev, card]);
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

  const moveCardsToPosition = async (targetIdx) => {
    if (!moveMode || moveSelected.length === 0) return;
    // Remove selected cards from hand
    const remaining = myHand.filter(c => !moveSelected.find(m => m.id === c.id));
    // Insert at target position
    remaining.splice(targetIdx, 0, ...moveSelected);
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: remaining });
    setMoveSelected([]);
    setMoveMode(false);
  };

  // Touch drag and drop
  const handleTouchStart = (e, idx) => {
    touchRef.current = { active: true, startIdx: idx, startX: e.touches[0].clientX, startY: e.touches[0].clientY };
  };

  const handleTouchMove = (e) => {
    if (!touchRef.current.active) return;
    e.preventDefault();
  };

  const handleTouchEnd = async (e, idx) => {
    if (!touchRef.current.active) return;
    const dx = Math.abs(e.changedTouches[0].clientX - touchRef.current.startX);
    const dy = Math.abs(e.changedTouches[0].clientY - touchRef.current.startY);
    if (dx < 5 && dy < 5) {
      // It was a tap, not a drag
      touchRef.current = { active: false, startIdx: null, startX: 0, startY: 0 };
      return;
    }
    const startIdx = touchRef.current.startIdx;
    touchRef.current = { active: false, startIdx: null, startX: 0, startY: 0 };
    if (startIdx === idx || startIdx === null) return;
    const newHand = [...myHand];
    const [moved] = newHand.splice(startIdx, 1);
    newHand.splice(idx, 0, moved);
    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: newHand });
  };

  const sortedPlayers = playerOrder.map((pid, i) => Object.assign({}, players[pid], {
    id: pid, color: COLORS[i], handCount: ((room.hands && room.hands[pid]) || []).length,
  }));
  const otherPlayers = sortedPlayers.filter(p => p.id !== playerId);
  const discardQueue = room.discardQueue || [];
  const imFirstInQueue = discardQueue[0] === playerId;

  return (
    <div style={s.root}>
      {/* HEADER */}
      <div style={s.header}>
        <span style={s.headerTitle}>POKERAMI</span>
        <span style={s.headerMano}>MANO {room.mano}</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
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
              <span style={{ color: p.color, fontWeight: 800, fontSize: 10, minWidth: 65 }}>
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
              <div style={{ color: p.color, fontWeight: 900, fontSize: 11, letterSpacing: 0.5 }}>
                {p.name && p.name.toUpperCase()}
              </div>
              <div style={{ display: 'flex', marginTop: 4 }}>
                {Array.from({ length: Math.min(p.handCount, 7) }).map((_, i) => (
                  <div key={i} style={{
                    width: 18, height: 26, borderRadius: 3,
                    background: 'linear-gradient(135deg, #0d3a5c, #071f3a)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    marginLeft: i > 0 ? -7 : 0,
                    boxShadow: '1px 2px 4px rgba(0,0,0,0.5)',
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
            <div style={{ color: '#1a3a4a', fontSize: 10, textAlign: 'center', padding: '6px 0' }}>Tavolo vuoto</div>
          ) : (
            <div style={s.tableCombos}>
              {room.table.map(combo => (
                <div key={combo.id} style={Object.assign({}, s.tableCombo, { borderColor: combo.color + '55' })}>
                  <div style={{ color: combo.color, fontSize: 8, fontWeight: 800, marginBottom: 4 }}>
                    {combo.playerName && combo.playerName.toUpperCase()}
                    {combo.type !== 'libera' && ' - ' + (APERTURE_TYPES.find(a => a.id === combo.type) ? APERTURE_TYPES.find(a => a.id === combo.type).label : '')}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {combo.cards.map((card, idx) => (
                      <div key={card.id} onClick={() => card.isJoker && isMyTurn && me.aperta ? swapJoker(combo.id, idx) : null}
                        style={{ cursor: card.isJoker && isMyTurn && me.aperta ? 'pointer' : 'default' }}>
                        <Card card={card} small />
                      </div>
                    ))}
                  </div>
                  {isMyTurn && me.aperta && selected.length > 0 && (
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
            <div style={s.deckLabel}>COPERTA ({(room.deck || []).length})</div>
            <div onClick={isMyTurn && !room.drawnThisTurn ? drawFromDeck : null}
              style={Object.assign({}, s.deckCard, { cursor: isMyTurn && !room.drawnThisTurn ? 'pointer' : 'default',
                boxShadow: isMyTurn && !room.drawnThisTurn ? '0 0 12px rgba(240,192,64,0.3), 2px 4px 10px rgba(0,0,0,0.5)' : '2px 4px 10px rgba(0,0,0,0.5)' })}>
              <div style={{ fontSize: 22 }}>🂠</div>
            </div>
          </div>
          <div style={s.deckArea}>
            <div style={s.deckLabel}>SCARTI</div>
            {room.topDiscard ? (
              <div onClick={isMyTurn && !room.drawnThisTurn ? drawFromDiscard : null}
                style={{ cursor: isMyTurn && !room.drawnThisTurn ? 'pointer' : 'default' }}>
                <Card card={room.topDiscard} />
              </div>
            ) : (
              <div style={s.emptyDiscard}>VUOTO</div>
            )}
            {/* First mano card - only first player can take */}
            {isFirstManoCard && isFirstPlayer && !room.drawnThisTurn && (
              <button onClick={takeFirstManoCard} style={s.firstCardBtn}>PRENDI</button>
            )}
          </div>
        </div>
      </div>

      {/* MY HAND */}
      <div style={s.handArea}>
        {/* Discard notification bar - above cards */}
        {canTakeDiscard && !imInQueue && (
          <div style={s.discardNotif}>
            <span style={{ color: '#c0d4e0', fontSize: 11 }}>
              {playerOrder.length === 2
                ? 'Puoi prendere lo scarto al tuo turno'
                : 'Scarto disponibile! ' + (discardTimer !== null ? discardTimer + 's' : '')}
            </span>
            {playerOrder.length > 2 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={claimDiscardFromQueue} style={s.discardBtn('#2ecc71')}>PRENDO</button>
                <button onClick={takeDiscardOutOfTurn} style={s.discardBtn('#f39c12')}>PRENOTO</button>
              </div>
            )}
          </div>
        )}

        {/* In queue notification */}
        {imInQueue && canTakeDiscard && (
          <div style={s.discardNotif}>
            <span style={{ color: '#f39c12', fontSize: 11 }}>
              {imFirstInQueue ? 'Tocca a te! Vuoi lo scarto?' : 'Sei in coda (' + (discardQueue.indexOf(playerId) + 1) + ')'}
              {discardTimer !== null && ' ' + discardTimer + 's'}
            </span>
            {imFirstInQueue && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={claimDiscardFromQueue} style={s.discardBtn('#2ecc71')}>SI</button>
                <button onClick={passDiscardQueue} style={s.discardBtn('#e74c3c')}>NO</button>
              </div>
            )}
          </div>
        )}

        <div style={s.handHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: myColor, fontWeight: 900, fontSize: 13, letterSpacing: 1 }}>
              {playerName && playerName.toUpperCase()}
            </span>
            <span style={{ color: '#4a6a7a', fontSize: 10 }}>{myHand.length} carte</span>
            <span style={{ fontWeight: 900, fontSize: 12, color: myPoints > 50 ? '#e74c3c' : myPoints > 25 ? '#f39c12' : '#2ecc71' }}>
              {myPoints}PT
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={sortHandBySuit} style={s.sortBtn}>♠ SEME</button>
            <button onClick={sortHandByValue} style={s.sortBtn}>7 VALORE</button>
            <button onClick={() => { setMoveMode(!moveMode); setMoveSelected([]); setSelected([]); }}
              style={Object.assign({}, s.sortBtn, { color: moveMode ? '#f0c040' : '#4a8fa6', border: '1px solid ' + (moveMode ? 'rgba(240,192,64,0.4)' : 'rgba(255,255,255,0.1)') })}>
              {moveMode ? 'ANNULLA' : 'SPOSTA'}
            </button>
            {!moveMode && selected.length > 0 && (
              <button onClick={() => setSelected([])} style={s.clearBtn}>x ({selected.length})</button>
            )}
            {moveMode && moveSelected.length > 0 && (
              <button onClick={() => setMoveSelected([])} style={s.clearBtn}>x ({moveSelected.length})</button>
            )}
          </div>
        </div>

        {moveMode && (
          <div style={s.hint('#f39c12')}>
            {moveSelected.length === 0 ? 'TOCCA LE CARTE DA SPOSTARE' : 'TOCCA LA POSIZIONE DOVE INSERIRLE (' + moveSelected.length + ' selezionate)'}
          </div>
        )}
        {!moveMode && selected.length > 0 && detectedApertura && !(me.apertureUsate && me.apertureUsate[detectedApertura]) && !me.aperta && (
          <div style={s.hint('#9b59b6')}>
            APERTURA: {APERTURE_TYPES.find(a => a.id === detectedApertura) ? APERTURE_TYPES.find(a => a.id === detectedApertura).label : ''}
          </div>
        )}
        {selected.length > 0 && me.aperta && isValidTableCombination(selected) && (
          <div style={s.hint('#3498db')}>COMBINAZIONE VALIDA - puoi abbassarla!</div>
        )}

        {/* Cards overlapping - touch enabled */}
        <div style={s.handCards}>
          {moveMode && moveSelected.length > 0 && (
            <div
              onClick={() => moveCardsToPosition(0)}
              style={s.insertSlot}
            />
          )}
          {myHand.map((card, idx) => {
            const isSelected = !!selected.find(c => c.id === card.id);
            const isMoveSelected = !!moveSelected.find(c => c.id === card.id);
            return (
              <React.Fragment key={card.id}>
                <div
                  draggable
                  onDragStart={() => touchRef.current.startIdx = idx}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async () => {
                    const si = touchRef.current.startIdx;
                    if (si === null || si === idx) return;
                    const newHand = [...myHand];
                    const [moved] = newHand.splice(si, 1);
                    newHand.splice(idx, 0, moved);
                    touchRef.current.startIdx = null;
                    await update(ref(db, 'rooms/' + roomCode), { ['hands/' + playerId]: newHand });
                  }}
                  onTouchStart={(e) => handleTouchStart(e, idx)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={(e) => handleTouchEnd(e, idx)}
                  onClick={() => toggleSelect(card)}
                  style={{
                    marginLeft: idx === 0 ? 0 : (moveMode ? 4 : -24),
                    zIndex: isMoveSelected ? 100 : isSelected ? 90 : idx,
                    position: 'relative',
                    transition: 'margin 0.1s',
                    opacity: isMoveSelected ? 0.5 : 1,
                  }}
                >
                  <Card card={card} selected={isMoveSelected || (!moveMode && isSelected)} />
                </div>
                {moveMode && moveSelected.length > 0 && !isMoveSelected && (
                  <div
                    onClick={() => moveCardsToPosition(idx + 1)}
                    style={s.insertSlot}
                  />
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
                <button onClick={handleApertura} style={s.actionBtn('#9b59b6', null)}>APRI</button>
              )}
              {me.aperta && selected.length > 0 && isValidTableCombination(selected) && (
                <button onClick={handleAbbassCombinazione} style={s.actionBtn('#3498db', null)}>ABBASSA</button>
              )}
              {selected.length === myHand.length - 1 && (
                <button onClick={handleChiusura} style={s.actionBtn('#f0c040', '#061a26')}>CHIUDI</button>
              )}
              <button onClick={discardCard} style={s.actionBtn('#e74c3c', null)}>SCARTA</button>
            </React.Fragment>
          )}
        </div>
      )}

      {/* CHAT - always visible below hand */}
      <div style={s.chatArea}>
        <div ref={chatRef} style={s.chatMessages}>
          {(room.chatMessages || []).length === 0 ? (
            <div style={{ color: '#1a3a4a', fontSize: 10, padding: '4px 0' }}>Nessun messaggio</div>
          ) : (room.chatMessages || []).slice(-5).map(m => (
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

      {/* JOKER DECLARATION MODAL */}
      {jokerModal && (
        <div style={s.modalOverlay}>
          <div style={Object.assign({}, s.modal, { maxWidth: 300, textAlign: 'center' })}>
            <h3 style={{ color: '#f0c040', margin: '0 0 8px', fontSize: 16, letterSpacing: 2 }}>DICHIARA IL JOLLY</h3>
            <p style={{ color: '#4a6a7a', fontSize: 12, marginBottom: 16 }}>Quale seme rappresenta il jolly?</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              {jokerModal.suits.map(suit => (
                <button key={suit} onClick={() => jokerModal.onConfirm(suit)} style={{
                  padding: '12px 16px', borderRadius: 10, border: 'none',
                  background: (suit === '♥' || suit === '♦') ? 'rgba(192,57,43,0.2)' : 'rgba(26,26,46,0.5)',
                  color: (suit === '♥' || suit === '♦') ? '#e74c3c' : '#e0eaf4',
                  fontSize: 28, cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}>
                  {suit}
                </button>
              ))}
            </div>
            <button onClick={() => setJokerModal(null)} style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#4a6a7a', cursor: 'pointer', fontSize: 12, fontFamily: 'Georgia, serif' }}>
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
  root: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #061a26 0%, #0a2e3d 40%, #061a26 100%)',
    fontFamily: 'Georgia, serif', color: '#e0eaf4',
    display: 'flex', flexDirection: 'column', userSelect: 'none',
  },
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
  firstCardBtn: { marginTop: 4, padding: '4px 8px', borderRadius: 5, background: 'rgba(240,192,64,0.15)', border: '1px solid rgba(240,192,64,0.4)', color: '#f0c040', fontSize: 9, cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif', fontWeight: 800 },
  handArea: { flex: 1, background: '#051520', padding: '8px 12px 0', borderTop: '2px solid rgba(10,100,140,0.25)' },
  discardNotif: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6 },
  discardBtn: (color) => ({ padding: '4px 10px', borderRadius: 6, border: 'none', background: color + '22', color: color, fontWeight: 800, fontSize: 10, cursor: 'pointer', letterSpacing: 1, fontFamily: 'Georgia, serif', border: '1px solid ' + color + '44' }),
  handHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  hint: (color) => ({ background: color + '12', border: '1px solid ' + color + '35', borderRadius: 5, padding: '3px 8px', color: color, fontSize: 9, letterSpacing: 1, fontWeight: 800, marginBottom: 5 }),
  handCards: { display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 12, paddingTop: 4, minHeight: 96 },
  sortBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#4a8fa6', borderRadius: 5, padding: '3px 7px', fontSize: 8, cursor: 'pointer', letterSpacing: 0.5, fontFamily: 'Georgia, serif' },
  clearBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#4a6a7a', borderRadius: 5, padding: '3px 7px', fontSize: 8, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  insertSlot: { width: 12, height: 84, borderRadius: 4, background: 'rgba(240,192,64,0.2)', border: '2px dashed rgba(240,192,64,0.5)', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start', marginTop: 6, transition: 'background 0.15s' },
  actions: { padding: '8px 12px 10px', background: 'rgba(0,0,0,0.5)', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 8, flexWrap: 'wrap' },
  actionBtn: (color, textColor) => ({ flex: 1, padding: '11px 8px', borderRadius: 9, border: textColor ? 'none' : '1px solid ' + color + '44', background: textColor ? 'linear-gradient(135deg, ' + color + ', ' + color + 'cc)' : color + '18', color: textColor || color, fontWeight: 900, fontSize: 12, cursor: 'pointer', letterSpacing: 1, fontFamily: 'Georgia, serif' }),
  chatArea: { background: 'rgba(0,0,0,0.35)', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '6px 12px 16px' },
  chatMessages: { overflowY: 'auto', maxHeight: 60, marginBottom: 5 },
  chatMsg: { fontSize: 11, marginBottom: 2, lineHeight: 1.4 },
  chatInput: { display: 'flex', gap: 5 },
  chatInputField: { flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 8px', color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'Georgia, serif' },
  chatSend: { background: 'linear-gradient(135deg, #f0c040, #c8860a)', border: 'none', borderRadius: 7, color: '#061a26', fontWeight: 900, fontSize: 9, padding: '5px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16, fontFamily: 'Georgia, serif' },
  modal: { background: 'linear-gradient(135deg, #061a26, #0a2e3d)', border: '1px solid rgba(240,192,64,0.2)', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, maxHeight: '85vh', overflowY: 'auto' },
  modalTitle: { color: '#f0c040', margin: '8px 0 4px', fontSize: 18, letterSpacing: 3 },
  scoreRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', letterSpacing: 1 },
};
