import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { ref, onValue, update } from 'firebase/database';
import Card from './Card';
import {
  APERTURE_TYPES, handPoints, isValidCombination,
  detectApertura, canChiuderInMano, createDeck, shuffle,
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
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const chatRef = useRef(null);

  useEffect(() => {
    const unsub = onValue(ref(db, 'rooms/' + roomCode), snap => {
      const data = snap.val();
      if (data) { setRoom(data); if (data.status === 'handEnd') setShowScores(true); }
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
    });
  };

  const drawFromDiscard = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (room.drawnThisTurn) { showMsg('Hai gia pescato!'); return; }
    if (!room.topDiscard) { showMsg('Nessuna carta scartata!'); return; }
    const card = room.topDiscard;
    const newDiscard = [...(room.discardPile || [])];
    await update(ref(db, 'rooms/' + roomCode), {
      topDiscard: newDiscard.length > 0 ? newDiscard[newDiscard.length - 1] : null,
      discardPile: newDiscard.slice(0, -1),
      ['hands/' + playerId]: [...myHand, card],
      drawnThisTurn: true,
    });
    await addLog(me.name + ' prende la carta scartata.');
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
    });
    setSelected([]);
    await addLog(me.name + ' scarta ' + card.rank + card.suit);
  };

  // APERTURA - solo prima volta che scendi
  const handleApertura = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (me.aperta) { showMsg('Hai gia aperto! Usa il tavolo per abbassare combinazioni.'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte per aprire'); return; }
    const aperturaId = detectApertura(selected);
    if (!aperturaId) { showMsg('Combinazione non valida! Niente jolly in apertura.'); return; }
    if (me.apertureUsate && me.apertureUsate[aperturaId]) {
      showMsg('Apertura gia usata in una partita precedente!'); return;
    }
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

  // ABBASSA COMBINAZIONE LIBERA - dopo aver gia aperto
  const handleAbbassCombinazione = async () => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!room.drawnThisTurn) { showMsg('Devi prima pescare!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte da abbassare'); return; }
    if (!isValidCombination(selected)) { showMsg('Combinazione non valida!'); return; }
    const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));
    const newTable = [...(room.table || []), {
      id: Date.now().toString(), playerId, playerName: me.name,
      color: myColor, type: 'libera', cards: selected,
    }];
    await update(ref(db, 'rooms/' + roomCode), {
      ['hands/' + playerId]: newHand,
      table: newTable,
    });
    setSelected([]);
    showMsg('Combinazione abbassata!', 'success');
    await addLog(me.name + ' abbassa una combinazione.');
  };

  const addToCombo = async (comboId) => {
    if (!isMyTurn) { showMsg('Non e il tuo turno!'); return; }
    if (!me.aperta) { showMsg('Devi prima aprire!'); return; }
    if (selected.length === 0) { showMsg('Seleziona le carte da aggiungere'); return; }
    const combo = room.table && room.table.find(c => c.id === comboId);
    if (!combo) return;
    const newCards = [...combo.cards, ...selected];
    if (!isValidCombination(newCards)) { showMsg('Combinazione non valida!'); return; }
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
    }
    updates['players/' + playerId + '/apertureUsate/chiusura'] = true;
    updates['hands/' + playerId] = [];
    updates.discardPile = newDiscard;
    updates.topDiscard = cardToDiscard;
    updates.status = 'handEnd';
    updates.handScores = scores;
    updates.handWinner = playerId;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setSelected([]);
    await addLog(me.name + ' chiude in mano!');
  };

  const startNewHand = async () => {
    const deck = createDeck();
    const hands = {};
    for (const pid of playerOrder) hands[pid] = deck.splice(0, 13);
    const updates = {
      status: 'playing', deck, discardPile: [], topDiscard: null, table: [],
      currentPlayerIndex: (room.currentPlayerIndex + 1) % playerOrder.length,
      mano: (room.mano || 1) + 1, hands, drawnThisTurn: false,
      handScores: null, handWinner: null,
    };
    for (const pid of playerOrder) updates['players/' + pid + '/aperta'] = false;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setShowScores(false); setSelected([]);
  };

  const toggleSelect = (card) => {
    setSelected(prev => prev.find(c => c.id === card.id) ? prev.filter(c => c.id !== card.id) : [...prev, card]);
  };

  const handleDragStart = (idx) => setDragIndex(idx);
  const handleDragOver = (idx) => setDragOverIndex(idx);
  const handleDrop = async (idx) => {
    if (dragIndex === null || dragIndex === idx) { setDragIndex(null); setDragOverIndex(null); return; }
    const newHand = [...myHand];
    const [moved] = newHand.splice(dragIndex, 1);
    newHand.splice(idx, 0, moved);
    const updates = {};
    updates['hands/' + playerId] = newHand;
    await update(ref(db, 'rooms/' + roomCode), updates);
    setDragIndex(null); setDragOverIndex(null);
  };

  const sortedPlayers = playerOrder.map((pid, i) => Object.assign({}, players[pid], {
    id: pid, color: COLORS[i],
    handCount: ((room.hands && room.hands[pid]) || []).length,
  }));

  // Position players around table
  const otherPlayers = sortedPlayers.filter(p => p.id !== playerId);

  return (
    <div style={s.root}>
      {/* HEADER */}
      <div style={s.header}>
        <span style={s.headerTitle}>POKERAMI</span>
        <span style={s.headerMano}>MANO {room.mano}</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button onClick={() => setShowAperture(!showAperture)} style={s.headerBtn}>APERTURE</button>
          <button onClick={() => setShowChat(!showChat)} style={s.headerBtn}>
            CHAT {room.chatMessages && room.chatMessages.length > 0 ? '(' + room.chatMessages.length + ')' : ''}
          </button>
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
        {/* Other players around table */}
        <div style={s.otherPlayersRow}>
          {otherPlayers.map(p => (
            <div key={p.id} style={Object.assign({}, s.otherPlayerChip, {
              borderColor: p.id === currentPid ? p.color : 'rgba(255,255,255,0.08)',
              boxShadow: p.id === currentPid ? '0 0 16px ' + p.color + '66' : 'none',
            })}>
              <div style={{ color: p.color, fontWeight: 900, fontSize: 12, letterSpacing: 1 }}>
                {p.name && p.name.toUpperCase()}
              </div>
              <div style={{ display: 'flex', gap: -8, marginTop: 6 }}>
                {Array.from({ length: Math.min(p.handCount, 8) }).map((_, i) => (
                  <div key={i} style={{
                    width: 20, height: 30, borderRadius: 3,
                    background: 'linear-gradient(135deg, #0d3a5c, #071f3a)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    marginLeft: i > 0 ? -8 : 0,
                    boxShadow: '1px 2px 4px rgba(0,0,0,0.5)',
                  }} />
                ))}
                {p.handCount > 8 && (
                  <div style={{ color: '#4a6a7a', fontSize: 10, marginLeft: 4, alignSelf: 'center' }}>
                    +{p.handCount - 8}
                  </div>
                )}
              </div>
              <div style={{ color: '#f0c040', fontSize: 11, fontWeight: 800, marginTop: 4 }}>{p.score}pt</div>
              {p.aperta && <div style={{ color: p.color, fontSize: 8, letterSpacing: 1 }}>APERTO</div>}
            </div>
          ))}
        </div>

        {/* Table combinations */}
        <div style={s.tableCombosArea}>
          {(!room.table || room.table.length === 0) ? (
            <div style={{ color: '#1a3a4a', fontSize: 11, textAlign: 'center', padding: '10px 0' }}>
              Nessuna combinazione sul tavolo
            </div>
          ) : (
            <div style={s.tableCombos}>
              {room.table.map(combo => (
                <div key={combo.id} style={Object.assign({}, s.tableCombo, { borderColor: combo.color + '55' })}>
                  <div style={{ color: combo.color, fontSize: 8, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>
                    {combo.playerName && combo.playerName.toUpperCase()}
                    {combo.type !== 'libera' && ' - ' + (APERTURE_TYPES.find(a => a.id === combo.type) ? APERTURE_TYPES.find(a => a.id === combo.type).label : '')}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {combo.cards.map((card, idx) => (
                      <div key={card.id} onClick={() => card.isJoker ? swapJoker(combo.id, idx) : null}
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
              style={Object.assign({}, s.deckCard, { cursor: isMyTurn && !room.drawnThisTurn ? 'pointer' : 'default' })}>
              <div style={{ fontSize: 20 }}>🂠</div>
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
          </div>
        </div>
      </div>

      {/* MY HAND */}
      <div style={s.handArea}>
        <div style={s.handHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: myColor, fontWeight: 900, fontSize: 13, letterSpacing: 1 }}>
              {playerName && playerName.toUpperCase()}
            </span>
            <span style={{ color: '#4a6a7a', fontSize: 11 }}>{myHand.length} carte</span>
            <span style={{
              fontWeight: 900, fontSize: 13,
              color: myPoints > 50 ? '#e74c3c' : myPoints > 25 ? '#f39c12' : '#2ecc71',
            }}>{myPoints}PT</span>
          </div>
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} style={s.clearBtn}>
              x DESELEZIONA ({selected.length})
            </button>
          )}
        </div>

        {selected.length > 0 && detectedApertura && !(me.apertureUsate && me.apertureUsate[detectedApertura]) && !me.aperta && (
          <div style={s.aperturaHint}>
            APERTURA RILEVATA: {APERTURE_TYPES.find(a => a.id === detectedApertura) ? APERTURE_TYPES.find(a => a.id === detectedApertura).label : ''}
          </div>
        )}

        {selected.length > 0 && me.aperta && isValidCombination(selected) && (
          <div style={Object.assign({}, s.aperturaHint, { background: 'rgba(52,152,219,0.15)', borderColor: 'rgba(52,152,219,0.4)', color: '#3498db' })}>
            COMBINAZIONE VALIDA - puoi abbassarla!
          </div>
        )}

        {/* Cards overlapping */}
        <div style={s.handCards}>
          {myHand.map((card, idx) => {
            const isSelected = !!selected.find(c => c.id === card.id);
            return (
              <div
                key={card.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => { e.preventDefault(); handleDragOver(idx); }}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                onClick={() => toggleSelect(card)}
                style={{
                  marginLeft: idx === 0 ? 0 : -24,
                  zIndex: isSelected ? 100 : idx,
                  position: 'relative',
                  opacity: dragIndex === idx ? 0.4 : 1,
                  transition: 'margin 0.1s',
                }}
              >
                <Card card={card} selected={isSelected} />
              </div>
            );
          })}
        </div>

        {/* My aperture badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingBottom: 8 }}>
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
              {me.aperta && selected.length > 0 && isValidCombination(selected) && (
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

      {/* CHAT */}
      {showChat && (
        <div style={s.chatPanel}>
          <div style={s.chatTitle}>CHAT DI GIOCO</div>
          <div ref={chatRef} style={s.chatMessages}>
            {(room.chatMessages || []).map(m => (
              <div key={m.id} style={s.chatMsg}>
                <span style={{ color: '#f0c040', fontWeight: 800 }}>{m.name}: </span>
                <span style={{ color: '#c0d4e0' }}>{m.text}</span>
              </div>
            ))}
          </div>
          <div style={s.chatInput}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder='Scrivi...'
              style={s.chatInputField}
              autoComplete='off' autoCorrect='off' spellCheck='false'
            />
            <button onClick={sendChat} style={s.chatSend}>INVIA</button>
          </div>
        </div>
      )}

      {/* SCORES MODAL */}
      {showScores && room.status === 'handEnd' && (
        <div style={s.modalOverlay}>
          <div style={s.modal}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40 }}>POKERAMI</div>
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
              <p style={{ color: '#4a6a7a', textAlign: 'center', fontSize: 11, marginTop: 16 }}>
                In attesa dell host...
              </p>
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
  loading: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#061a26', color: '#f0c040', fontSize: 18, letterSpacing: 3,
  },
  header: {
    background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(255,255,255,0.05)',
    padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
  },
  headerTitle: { color: '#f0c040', fontWeight: 900, fontSize: 16, letterSpacing: 4 },
  headerMano: { color: '#2a4a5a', fontSize: 11, letterSpacing: 2 },
  headerBtn: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#4a8fa6', borderRadius: 6, padding: '5px 10px', fontSize: 9,
    cursor: 'pointer', letterSpacing: 1, fontFamily: 'Georgia, serif',
  },
  turnBanner: { padding: '7px 14px', textAlign: 'center' },
  msgBar: {
    padding: '7px 14px', textAlign: 'center', fontSize: 12,
    border: '1px solid', letterSpacing: 1, fontWeight: 700,
  },
  aperturePanel: {
    background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(255,255,255,0.04)',
    padding: '8px 12px', maxHeight: 180, overflowY: 'auto',
  },
  aperturePlayerRow: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  tableArea: {
    background: 'linear-gradient(180deg, #0d3a4a 0%, #0a2e3a 100%)',
    borderBottom: '2px solid rgba(10,140,180,0.2)',
    padding: '10px 12px',
    boxShadow: 'inset 0 -4px 20px rgba(0,0,0,0.4)',
  },
  otherPlayersRow: {
    display: 'flex', justifyContent: 'center', gap: 12,
    marginBottom: 10, flexWrap: 'wrap',
  },
  otherPlayerChip: {
    background: 'rgba(0,0,0,0.35)', border: '1px solid',
    borderRadius: 12, padding: '8px 12px', textAlign: 'center',
    minWidth: 80, transition: 'box-shadow 0.2s',
  },
  tableCombosArea: { minHeight: 60, marginBottom: 8 },
  tableCombos: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  tableCombo: {
    background: 'rgba(0,0,0,0.3)', border: '1px solid', borderRadius: 8, padding: 7,
  },
  addBtn: {
    marginTop: 5, padding: '3px 7px', borderRadius: 4,
    background: 'rgba(240,192,64,0.1)', border: '1px solid rgba(240,192,64,0.3)',
    color: '#f0c040', fontSize: 8, cursor: 'pointer', width: '100%', letterSpacing: 1,
    fontFamily: 'Georgia, serif',
  },
  deckDiscardRow: {
    display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'flex-end',
  },
  deckArea: { textAlign: 'center' },
  deckLabel: { color: '#2a5a6a', fontSize: 9, letterSpacing: 2, marginBottom: 4 },
  deckCard: {
    width: 58, height: 84, borderRadius: 7,
    background: 'linear-gradient(135deg, #0d3a5c, #071f3a)',
    border: '1.5px solid rgba(255,255,255,0.15)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '2px 4px 10px rgba(0,0,0,0.5)',
  },
  emptyDiscard: {
    width: 58, height: 84, borderRadius: 7,
    border: '2px dashed rgba(255,255,255,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#1a3a4a', fontSize: 9, letterSpacing: 1,
  },
  handArea: {
    flex: 1, background: '#051520',
    padding: '10px 12px 0', borderTop: '2px solid rgba(10,100,140,0.3)',
  },
  handHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  aperturaHint: {
    background: 'rgba(155,89,182,0.12)', border: '1px solid rgba(155,89,182,0.35)',
    borderRadius: 5, padding: '4px 10px', color: '#9b59b6',
    fontSize: 9, letterSpacing: 2, fontWeight: 800, marginBottom: 6,
  },
  handCards: {
    display: 'flex', flexWrap: 'nowrap', overflowX: 'auto',
    paddingBottom: 14, paddingTop: 6, minHeight: 100,
  },
  clearBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    color: '#4a6a7a', borderRadius: 5, padding: '3px 8px',
    fontSize: 9, cursor: 'pointer', letterSpacing: 1, fontFamily: 'Georgia, serif',
  },
  actions: {
    padding: '8px 12px 10px', background: 'rgba(0,0,0,0.5)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    display: 'flex', gap: 8, flexWrap: 'wrap',
  },
  actionBtn: (color, textColor) => ({
    flex: 1, padding: '11px 8px', borderRadius: 9,
    border: textColor ? 'none' : '1px solid ' + color + '44',
    background: textColor ? 'linear-gradient(135deg, ' + color + ', ' + color + 'cc)' : color + '18',
    color: textColor || color,
    fontWeight: 900, fontSize: 12, cursor: 'pointer', letterSpacing: 1,
    fontFamily: 'Georgia, serif',
    boxShadow: textColor ? '0 4px 14px ' + color + '44' : 'none',
  }),
  chatPanel: {
    position: 'fixed', bottom: 0, right: 0, width: '280px',
    background: 'linear-gradient(180deg, #061a26, #0a2e3d)',
    border: '1px solid rgba(240,192,64,0.2)',
    borderRadius: '12px 12px 0 0',
    zIndex: 150, maxHeight: '60vh', display: 'flex', flexDirection: 'column',
  },
  chatTitle: {
    color: '#f0c040', fontWeight: 900, fontSize: 11, letterSpacing: 3,
    padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  chatMessages: {
    flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 100, maxHeight: 200,
  },
  chatMsg: { fontSize: 12, marginBottom: 6, lineHeight: 1.4 },
  chatInput: {
    display: 'flex', gap: 6, padding: '8px 10px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  chatInputField: {
    flex: 1, background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
    padding: '7px 10px', color: '#fff', fontSize: 13, outline: 'none',
    fontFamily: 'Georgia, serif',
  },
  chatSend: {
    background: 'linear-gradient(135deg, #f0c040, #c8860a)',
    border: 'none', borderRadius: 8, color: '#061a26',
    fontWeight: 900, fontSize: 10, padding: '7px 10px', cursor: 'pointer',
    letterSpacing: 1, fontFamily: 'Georgia, serif',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, padding: 16, fontFamily: 'Georgia, serif',
  },
  modal: {
    background: 'linear-gradient(135deg, #061a26, #0a2e3d)',
    border: '1px solid rgba(240,192,64,0.2)', borderRadius: 20, padding: 24,
    width: '100%', maxWidth: 360, maxHeight: '85vh', overflowY: 'auto',
  },
  modalTitle: { color: '#f0c040', margin: '8px 0 4px', fontSize: 18, letterSpacing: 3 },
  scoreRow: {
    display: 'flex', justifyContent: 'space-between', padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.05)', letterSpacing: 1,
  },
};
