import React, { useState, useEffect, useRef } from ‘react’;
import { db } from ‘../firebase/config’;
import { ref, onValue, update } from ‘firebase/database’;
import Card from ‘./Card’;
import {
APERTURE_TYPES,
handPoints,
isValidCombination,
detectApertura,
canChiuderInMano,
createDeck,
shuffle,
} from ‘../utils/gameLogic’;

const COLORS = [’#e74c3c’, ‘#3498db’, ‘#2ecc71’, ‘#f39c12’, ‘#9b59b6’, ‘#1abc9c’];

export default function Game({ roomCode, playerId, playerName, room: initialRoom }) {
const [room, setRoom] = useState(initialRoom);
const [selected, setSelected] = useState([]);
const [showTable, setShowTable] = useState(true);
const [showAperture, setShowAperture] = useState(false);
const [msg, setMsg] = useState({ text: ‘’, type: ‘error’ });
const [showScores, setShowScores] = useState(false);
const [dragIndex, setDragIndex] = useState(null);
const [dragOverIndex, setDragOverIndex] = useState(null);
const logRef = useRef(null);

useEffect(() => {
const unsub = onValue(ref(db, ‘rooms/’ + roomCode), snap => {
const data = snap.val();
if (data) {
setRoom(data);
if (data.status === ‘handEnd’) setShowScores(true);
}
});
return () => unsub();
}, [roomCode]);

useEffect(() => {
if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
}, [room && room.log]);

if (!room) return <div style={s.loading}>Caricamento…</div>;

const myHand = (room.hands && room.hands[playerId]) || [];
const players = room.players || {};
const playerOrder = room.playerOrder || [];
const currentPid = playerOrder[room.currentPlayerIndex % playerOrder.length];
const isMyTurn = currentPid === playerId;
const me = players[playerId] || {};
const myColor = COLORS[playerOrder.indexOf(playerId)] || ‘#f0c040’;
const myPoints = handPoints(myHand);

const addLog = async (text) => {
const logs = room.log || [];
await update(ref(db, ‘rooms/’ + roomCode), { log: […logs.slice(-30), text] });
};

const showMsg = (text, type) => {
setMsg({ text, type: type || ‘error’ });
setTimeout(() => setMsg({ text: ‘’, type: ‘error’ }), 3000);
};

const drawFromDeck = async () => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (room.drawnThisTurn) { showMsg(‘Hai gia pescato!’); return; }

```
let deck = [...(room.deck || [])];
if (deck.length === 0) {
  const tablePoker = (room.table || [])
    .filter(c => c.type === 'poker')
    .flatMap(c => c.cards);
  const discards = room.discardPile || [];
  deck = shuffle([...tablePoker, ...discards]);
  await update(ref(db, 'rooms/' + roomCode), { discardPile: [], topDiscard: null });
  await addLog('Mazzo finito! Rimescolati poker e scarti.');
}

const card = deck[0];
const newDeck = deck.slice(1);
const newHand = [...myHand, card];

await update(ref(db, 'rooms/' + roomCode), {
  deck: newDeck,
  ['hands/' + playerId]: newHand,
  drawnThisTurn: true,
});
await addLog(me.name + ' pesca dal mazzo.');
```

};

const drawFromDiscard = async () => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (room.drawnThisTurn) { showMsg(‘Hai gia pescato!’); return; }
if (!room.topDiscard) { showMsg(‘Nessuna carta scartata!’); return; }

```
const card = room.topDiscard;
const newDiscard = [...(room.discardPile || [])];
const newHand = [...myHand, card];

await update(ref(db, 'rooms/' + roomCode), {
  topDiscard: newDiscard.length > 0 ? newDiscard[newDiscard.length - 1] : null,
  discardPile: newDiscard.slice(0, -1),
  ['hands/' + playerId]: newHand,
  drawnThisTurn: true,
});
await addLog(me.name + ' prende la carta scartata.');
```

};

const discardCard = async () => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (!room.drawnThisTurn) { showMsg(‘Devi prima pescare!’); return; }
if (selected.length !== 1) { showMsg(‘Seleziona UNA carta da scartare’); return; }
const card = selected[0];
if (card.isJoker) { showMsg(‘Non puoi scartare il jolly!’); return; }

```
const newHand = myHand.filter(c => c.id !== card.id);
const newDiscard = [...(room.discardPile || [])];
if (room.topDiscard) newDiscard.push(room.topDiscard);
const nextIndex = (room.currentPlayerIndex + 1) % playerOrder.length;

await update(ref(db, 'rooms/' + roomCode), {
  ['hands/' + playerId]: newHand,
  discardPile: newDiscard,
  topDiscard: card,
  currentPlayerIndex: nextIndex,
  drawnThisTurn: false,
});
setSelected([]);
await addLog(me.name + ' scarta ' + card.rank + card.suit);
```

};

const handleApertura = async () => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (!room.drawnThisTurn) { showMsg(‘Devi prima pescare!’); return; }
if (selected.length === 0) { showMsg(‘Seleziona le carte per aprire’); return; }

```
const aperturaId = detectApertura(selected);
if (!aperturaId) { showMsg('Combinazione non valida! (niente jolly in apertura)'); return; }
if (me.apertureUsate && me.apertureUsate[aperturaId]) {
  const found = APERTURE_TYPES.find(a => a.id === aperturaId);
  showMsg('Hai gia usato: ' + (found ? found.label : aperturaId));
  return;
}

const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));
const newTable = [...(room.table || []), {
  id: Date.now().toString(),
  playerId,
  playerName: me.name,
  color: myColor,
  type: aperturaId,
  cards: selected,
}];

const updates = {};
updates['hands/' + playerId] = newHand;
updates['players/' + playerId + '/apertureUsate/' + aperturaId] = true;
updates['players/' + playerId + '/aperta'] = true;
updates.table = newTable;

await update(ref(db, 'rooms/' + roomCode), updates);
setSelected([]);
const found = APERTURE_TYPES.find(a => a.id === aperturaId);
showMsg('Aperto con ' + (found ? found.label : aperturaId) + '!', 'success');
await addLog(me.name + ' apre con ' + (found ? found.label : aperturaId));
```

};

const handleChiusura = async () => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (!room.drawnThisTurn) { showMsg(‘Devi prima pescare!’); return; }
if (me.apertureUsate && me.apertureUsate.chiusura) { showMsg(‘Chiusura gia usata!’); return; }

```
if (selected.length !== myHand.length - 1) {
  showMsg('Seleziona TUTTE le carte tranne una da scartare!'); return;
}

const cardToDiscard = myHand.find(c => !selected.find(sc => sc.id === c.id));
if (cardToDiscard && cardToDiscard.isJoker) { showMsg('Non puoi scartare il jolly!'); return; }
if (!canChiuderInMano(selected)) {
  showMsg('Le carte non formano combinazioni valide!'); return;
}

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
```

};

const addToCombo = async (comboId) => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (!me.aperta) { showMsg(‘Devi prima aprire!’); return; }
if (selected.length === 0) { showMsg(‘Seleziona le carte da aggiungere’); return; }

```
const combo = room.table && room.table.find(c => c.id === comboId);
if (!combo) return;

const newCards = [...combo.cards, ...selected];
if (!isValidCombination(newCards)) { showMsg('Le carte non formano una combinazione valida!'); return; }

const newTable = room.table.map(c => c.id === comboId ? Object.assign({}, c, { cards: newCards }) : c);
const newHand = myHand.filter(c => !selected.find(sc => sc.id === c.id));

const updates = {};
updates['hands/' + playerId] = newHand;
updates.table = newTable;
await update(ref(db, 'rooms/' + roomCode), updates);
setSelected([]);
await addLog(me.name + ' aggiunge carte al tavolo.');
```

};

const swapJoker = async (comboId, jokerIdx) => {
if (!isMyTurn) { showMsg(‘Non e il tuo turno!’); return; }
if (!me.aperta) { showMsg(‘Devi prima aprire!’); return; }
if (selected.length !== 1 || selected[0].isJoker) {
showMsg(‘Seleziona la carta vera da mettere al posto del jolly’); return;
}

```
const combo = room.table && room.table.find(c => c.id === comboId);
if (!combo) return;
const joker = combo.cards[jokerIdx];
if (!joker || !joker.isJoker) return;

const newComboCards = [...combo.cards];
newComboCards[jokerIdx] = selected[0];
if (!isValidCombination(newComboCards)) { showMsg('Sostituzione non valida!'); return; }

const newTable = room.table.map(c =>
  c.id === comboId ? Object.assign({}, c, { cards: newComboCards }) : c
);
const newHand = myHand.filter(c => c.id !== selected[0].id).concat(joker);

const updates = {};
updates['hands/' + playerId] = newHand;
updates.table = newTable;
await update(ref(db, 'rooms/' + roomCode), updates);
setSelected([]);
await addLog(me.name + ' prende un jolly!');
```

};

const startNewHand = async () => {
const deck = createDeck();
const hands = {};
for (const pid of playerOrder) hands[pid] = deck.splice(0, 13);

```
const updates = {
  status: 'playing',
  deck,
  discardPile: [],
  topDiscard: null,
  table: [],
  currentPlayerIndex: (room.currentPlayerIndex + 1) % playerOrder.length,
  mano: (room.mano || 1) + 1,
  hands,
  drawnThisTurn: false,
  handScores: null,
  handWinner: null,
};
for (const pid of playerOrder) {
  updates['players/' + pid + '/aperta'] = false;
}
await update(ref(db, 'rooms/' + roomCode), updates);
setShowScores(false);
setSelected([]);
```

};

const toggleSelect = (card) => {
setSelected(prev =>
prev.find(c => c.id === card.id)
? prev.filter(c => c.id !== card.id)
: […prev, card]
);
};

const handleDragStart = (idx) => setDragIndex(idx);
const handleDragOver = (idx) => setDragOverIndex(idx);
const handleDrop = async (idx) => {
if (dragIndex === null || dragIndex === idx) {
setDragIndex(null); setDragOverIndex(null); return;
}
const newHand = […myHand];
const [moved] = newHand.splice(dragIndex, 1);
newHand.splice(idx, 0, moved);
const updates = {};
updates[‘hands/’ + playerId] = newHand;
await update(ref(db, ‘rooms/’ + roomCode), updates);
setDragIndex(null); setDragOverIndex(null);
};

const sortedPlayers = playerOrder.map((pid, i) => Object.assign({}, players[pid], {
id: pid,
color: COLORS[i],
handCount: ((room.hands && room.hands[pid]) || []).length,
}));

const detectedApertura = detectApertura(selected);

return (
<div style={s.root}>
<div style={s.header}>
<div>
<span style={s.headerTitle}>RAMINO POKERATO</span>
<span style={s.headerMano}>MANO {room.mano}</span>
</div>
<div style={{ display: ‘flex’, gap: 8 }}>
<button onClick={() => setShowTable(!showTable)} style={s.headerBtn}>
{showTable ? ‘NASCONDI’ : ‘TAVOLO’}
</button>
<button onClick={() => setShowAperture(!showAperture)} style={s.headerBtn}>
APERTURE
</button>
</div>
</div>

```
  <div style={Object.assign({}, s.turnBanner, {
    background: isMyTurn
      ? 'linear-gradient(90deg, rgba(240,192,64,0.15), rgba(240,192,64,0.05))'
      : 'rgba(0,0,0,0.2)',
    borderBottom: '2px solid ' + (isMyTurn ? '#f0c040' : 'transparent'),
  })}>
    <span style={{ color: isMyTurn ? '#f0c040' : '#4a6a7a', fontWeight: 800, letterSpacing: 2 }}>
      {isMyTurn ? 'TOCCA A TE!' : 'TURNO DI ' + ((players[currentPid] && players[currentPid].name) || '...').toUpperCase()}
    </span>
  </div>

  {msg.text && (
    <div style={Object.assign({}, s.msgBar, {
      background: msg.type === 'success' ? '#1a6a3a' : '#6a1a1a',
      borderColor: msg.type === 'success' ? '#2ecc71' : '#e74c3c',
    })}>
      {msg.text}
    </div>
  )}

  <div style={s.playersRow}>
    {sortedPlayers.map(p => (
      <div key={p.id} style={Object.assign({}, s.playerChip, {
        borderColor: p.id === currentPid ? p.color : 'rgba(255,255,255,0.06)',
        boxShadow: p.id === currentPid ? '0 0 12px ' + p.color + '44' : 'none',
      })}>
        <div style={Object.assign({}, s.playerColorDot, { background: p.color })} />
        <div>
          <div style={{ color: p.color, fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>
            {p.name && p.name.toUpperCase()}
          </div>
          <div style={{ color: '#f0c040', fontSize: 16, fontWeight: 900 }}>{p.score}pt</div>
          <div style={{ color: '#4a6a7a', fontSize: 10 }}>{p.handCount} carte</div>
          {p.aperta && <div style={{ color: p.color, fontSize: 9, letterSpacing: 1 }}>APERTO</div>}
        </div>
      </div>
    ))}
  </div>

  {showAperture && (
    <div style={s.aperturePanel}>
      <div style={s.sectionTitle}>APERTURE DI TUTTI</div>
      {sortedPlayers.map(p => (
        <div key={p.id} style={s.aperturePlayerRow}>
          <span style={{ color: p.color, fontWeight: 800, fontSize: 11, minWidth: 70 }}>
            {p.name && p.name.toUpperCase()}
          </span>
          <div style={s.apertureBadges}>
            {APERTURE_TYPES.map(a => {
              const used = p.apertureUsate && !!p.apertureUsate[a.id];
              return (
                <div key={a.id} style={Object.assign({}, s.apertureBadge, {
                  background: used ? 'rgba(255,255,255,0.03)' : p.color + '18',
                  color: used ? '#3a4a5a' : p.color,
                  border: '1px solid ' + (used ? 'rgba(255,255,255,0.04)' : p.color + '44'),
                  textDecoration: used ? 'line-through' : 'none',
                })}>
                  {used && <span style={{ marginRight: 2, color: '#e74c3c' }}>x</span>}
                  {a.label}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  )}

  {showTable && (
    <div style={s.table}>
      <div style={s.sectionTitle}>TAVOLO</div>
      {(!room.table || room.table.length === 0) ? (
        <div style={{ color: '#2a4a5a', fontSize: 12, padding: '4px 0' }}>Nessuna combinazione</div>
      ) : (
        <div style={s.tableCombos}>
          {room.table.map(combo => (
            <div key={combo.id} style={Object.assign({}, s.tableCombo, { borderColor: combo.color + '44' })}>
              <div style={{ color: combo.color, fontSize: 9, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>
                {combo.playerName && combo.playerName.toUpperCase()} - {APERTURE_TYPES.find(a => a.id === combo.type) && APERTURE_TYPES.find(a => a.id === combo.type).label}
              </div>
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {combo.cards.map((card, idx) => (
                  <div key={card.id} onClick={() => card.isJoker ? swapJoker(combo.id, idx) : null}
                    style={{ cursor: card.isJoker ? 'pointer' : 'default' }}>
                    <Card card={card} small />
                  </div>
                ))}
              </div>
              {isMyTurn && me.aperta && selected.length > 0 && (
                <button onClick={() => addToCombo(combo.id)} style={s.addToComboBtn}>
                  + AGGIUNGI
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <div style={s.sectionTitle}>SCARTI</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {room.topDiscard ? (
            <div onClick={drawFromDiscard}
              style={{ cursor: isMyTurn && !room.drawnThisTurn ? 'pointer' : 'default' }}>
              <Card card={room.topDiscard} />
            </div>
          ) : (
            <div style={s.emptyDiscard}>VUOTO</div>
          )}
          {isMyTurn && !room.drawnThisTurn && room.topDiscard && (
            <div style={{ color: '#4a8fa6', fontSize: 11 }}>Tocca per prendere</div>
          )}
        </div>
      </div>
    </div>
  )}

  <div style={s.handArea}>
    <div style={s.handHeader}>
      <div>
        <span style={{ color: myColor, fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>
          {playerName && playerName.toUpperCase()}
        </span>
        <span style={{ color: '#4a6a7a', fontSize: 11, marginLeft: 8 }}>
          {myHand.length} CARTE
        </span>
        <span style={{
          color: myPoints > 50 ? '#e74c3c' : myPoints > 25 ? '#f39c12' : '#2ecc71',
          fontSize: 13, marginLeft: 8, fontWeight: 800,
        }}>
          {myPoints}PT
        </span>
      </div>
      {selected.length > 0 && (
        <button onClick={() => setSelected([])} style={s.clearBtn}>
          DESELEZIONA ({selected.length})
        </button>
      )}
    </div>

    {selected.length > 0 && detectedApertura && !(me.apertureUsate && me.apertureUsate[detectedApertura]) && (
      <div style={s.aperturaHint}>
        APERTURA RILEVATA: {APERTURE_TYPES.find(a => a.id === detectedApertura) && APERTURE_TYPES.find(a => a.id === detectedApertura).label}
      </div>
    )}

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
              marginLeft: idx === 0 ? 0 : -28,
              zIndex: isSelected ? 100 : idx,
              position: 'relative',
              transition: 'margin 0.1s',
              opacity: dragIndex === idx ? 0.5 : 1,
            }}
          >
            <Card card={card} selected={isSelected} dragging={dragIndex === idx} />
          </div>
        );
      })}
    </div>

    <div style={s.myAperture}>
      {APERTURE_TYPES.map(a => {
        const used = me.apertureUsate && !!me.apertureUsate[a.id];
        return (
          <div key={a.id} style={Object.assign({}, s.apertureBadge, {
            background: used ? 'rgba(255,255,255,0.03)' : myColor + '18',
            color: used ? '#2a3a4a' : myColor,
            border: '1px solid ' + (used ? 'rgba(255,255,255,0.04)' : myColor + '44'),
            textDecoration: used ? 'line-through' : 'none',
            fontSize: 9,
          })}>
            {used && <span style={{ color: '#e74c3c', marginRight: 2 }}>x</span>}
            {a.label}
          </div>
        );
      })}
    </div>
  </div>

  {isMyTurn && (
    <div style={s.actions}>
      {!room.drawnThisTurn ? (
        <button onClick={drawFromDeck} style={s.actionBtn('#3498db', null)}>
          PESCA DAL MAZZO
        </button>
      ) : (
        <React.Fragment>
          {selected.length > 0 && detectedApertura && !(me.apertureUsate && me.apertureUsate[detectedApertura]) && (
            <button onClick={handleApertura} style={s.actionBtn('#9b59b6', null)}>
              APRI: {APERTURE_TYPES.find(a => a.id === detectedApertura) && APERTURE_TYPES.find(a => a.id === detectedApertura).label}
            </button>
          )}
          {selected.length > 0 && selected.length === myHand.length - 1 && (
            <button onClick={handleChiusura} style={s.actionBtn('#f0c040', '#061a26')}>
              CHIUDI IN MANO
            </button>
          )}
          <button onClick={discardCard} style={s.actionBtn('#e74c3c', null)}>
            SCARTA
          </button>
        </React.Fragment>
      )}
    </div>
  )}

  <div ref={logRef} style={s.log}>
    {(room.log || []).map((l, i) => (
      <span key={i} style={{ marginRight: 4 }}>{l} - </span>
    ))}
  </div>

  {showScores && room.status === 'handEnd' && (
    <div style={s.modalOverlay}>
      <div style={s.modal}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 48 }}>{'🏆'}</div>
          <h3 style={s.modalTitle}>
            {players[room.handWinner] && players[room.handWinner].name && players[room.handWinner].name.toUpperCase()} CHIUDE!
          </h3>
          <p style={{ color: '#4a6a7a', fontSize: 12, letterSpacing: 2 }}>MANO {room.mano}</p>
        </div>
        {sortedPlayers.map(p => (
          <div key={p.id} style={s.scoreRow}>
            <span style={{ color: p.color, fontWeight: 800 }}>{p.name && p.name.toUpperCase()}</span>
            <span>
              {room.handScores && room.handScores[p.id] > 0
                ? <span style={{ color: '#e74c3c', fontWeight: 800 }}>+{room.handScores[p.id]}</span>
                : <span style={{ color: '#2ecc71', fontWeight: 800 }}>0 ok</span>}
              <span style={{ color: '#4a6a7a', fontSize: 12 }}> TOT: {p.score}</span>
            </span>
          </div>
        ))}
        {room.host === playerId && (
          <button onClick={startNewHand} style={Object.assign({}, s.actionBtn('#f0c040', '#061a26'), { width: '100%', marginTop: 24 })}>
            PROSSIMA MANO
          </button>
        )}
        {room.host !== playerId && (
          <p style={{ color: '#4a6a7a', textAlign: 'center', fontSize: 12, marginTop: 16, letterSpacing: 1 }}>
            IN ATTESA DELL HOST...
          </p>
        )}
      </div>
    </div>
  )}
</div>
```

);
}

const s = {
root: {
minHeight: ‘100vh’,
background: ‘linear-gradient(180deg, #061a26 0%, #0a2e3d 40%, #061a26 100%)’,
fontFamily: ‘Georgia, serif’,
color: ‘#e0eaf4’,
display: ‘flex’, flexDirection: ‘column’,
userSelect: ‘none’,
},
loading: {
minHeight: ‘100vh’, display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’,
background: ‘#061a26’, color: ‘#f0c040’, fontSize: 18, letterSpacing: 3, fontFamily: ‘Georgia, serif’,
},
header: {
background: ‘rgba(0,0,0,0.5)’,
borderBottom: ‘1px solid rgba(255,255,255,0.05)’,
padding: ‘10px 14px’,
display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘center’,
},
headerTitle: { color: ‘#f0c040’, fontWeight: 900, fontSize: 14, letterSpacing: 3 },
headerMano: { color: ‘#2a4a5a’, fontSize: 11, marginLeft: 10, letterSpacing: 2 },
headerBtn: {
background: ‘rgba(255,255,255,0.05)’, border: ‘1px solid rgba(255,255,255,0.08)’,
color: ‘#4a8fa6’, borderRadius: 6, padding: ‘5px 10px’, fontSize: 9,
cursor: ‘pointer’, letterSpacing: 1, fontFamily: ‘Georgia, serif’,
},
turnBanner: { padding: ‘8px 14px’, textAlign: ‘center’, fontSize: 12 },
msgBar: {
padding: ‘8px 14px’, textAlign: ‘center’, fontSize: 12,
border: ‘1px solid’, letterSpacing: 1, fontWeight: 700,
},
playersRow: {
display: ‘flex’, gap: 8, padding: ‘10px 12px’, overflowX: ‘auto’,
background: ‘rgba(0,0,0,0.2)’, borderBottom: ‘1px solid rgba(255,255,255,0.04)’,
},
playerChip: {
flexShrink: 0, background: ‘rgba(255,255,255,0.04)’,
border: ‘1px solid’, borderRadius: 10, padding: ‘8px 12px’,
display: ‘flex’, alignItems: ‘center’, gap: 8, minWidth: 80,
},
playerColorDot: { width: 8, height: 8, borderRadius: ‘50%’, flexShrink: 0 },
aperturePanel: {
background: ‘rgba(0,0,0,0.3)’, borderBottom: ‘1px solid rgba(255,255,255,0.04)’,
padding: ‘10px 12px’, maxHeight: 200, overflowY: ‘auto’,
},
sectionTitle: { color: ‘#4a8fa6’, fontSize: 9, letterSpacing: 3, fontWeight: 800, marginBottom: 8 },
aperturePlayerRow: { display: ‘flex’, alignItems: ‘flex-start’, gap: 8, marginBottom: 8 },
apertureBadges: { display: ‘flex’, flexWrap: ‘wrap’, gap: 4, flex: 1 },
apertureBadge: { padding: ‘2px 7px’, borderRadius: 5, fontSize: 9, fontWeight: 700, letterSpacing: 0.5 },
table: {
background: ‘linear-gradient(180deg, #0d3a4a 0%, #0a2e3a 100%)’,
borderBottom: ‘2px solid rgba(255,255,255,0.06)’,
padding: ‘10px 12px’, minHeight: 80,
},
tableCombos: { display: ‘flex’, flexWrap: ‘wrap’, gap: 10, marginBottom: 10 },
tableCombo: {
background: ‘rgba(0,0,0,0.3)’, border: ‘1px solid’, borderRadius: 10, padding: 8,
},
addToComboBtn: {
marginTop: 6, padding: ‘3px 8px’, borderRadius: 5,
background: ‘rgba(240,192,64,0.1)’, border: ‘1px solid rgba(240,192,64,0.3)’,
color: ‘#f0c040’, fontSize: 9, cursor: ‘pointer’, width: ‘100%’, letterSpacing: 1,
fontFamily: ‘Georgia, serif’,
},
emptyDiscard: {
width: 62, height: 88, borderRadius: 8,
border: ‘2px dashed rgba(255,255,255,0.1)’,
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’,
color: ‘#2a4a5a’, fontSize: 9, letterSpacing: 1,
},
handArea: {
flex: 1, background: ‘linear-gradient(180deg, #061a26 0%, #051520 100%)’,
padding: ‘12px 12px 0’, borderTop: ‘2px solid rgba(255,255,255,0.06)’,
},
handHeader: { display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘center’, marginBottom: 8 },
aperturaHint: {
background: ‘rgba(155,89,182,0.15)’, border: ‘1px solid rgba(155,89,182,0.4)’,
borderRadius: 6, padding: ‘5px 10px’, color: ‘#9b59b6’,
fontSize: 10, letterSpacing: 2, fontWeight: 800, marginBottom: 8,
},
handCards: {
display: ‘flex’, flexWrap: ‘nowrap’, overflowX: ‘auto’,
paddingBottom: 16, paddingTop: 8, minHeight: 110,
},
myAperture: { display: ‘flex’, flexWrap: ‘wrap’, gap: 4, paddingBottom: 10 },
clearBtn: {
background: ‘transparent’, border: ‘1px solid rgba(255,255,255,0.1)’,
color: ‘#4a6a7a’, borderRadius: 6, padding: ‘4px 8px’,
fontSize: 9, cursor: ‘pointer’, letterSpacing: 1, fontFamily: ‘Georgia, serif’,
},
actions: {
padding: ‘10px 12px 12px’, background: ‘rgba(0,0,0,0.4)’,
borderTop: ‘1px solid rgba(255,255,255,0.05)’,
display: ‘flex’, gap: 8, flexWrap: ‘wrap’,
},
actionBtn: (color, textColor) => ({
flex: 1, padding: ‘12px 8px’, borderRadius: 10,
border: textColor ? ‘none’ : ’1px solid ’ + color + ‘44’,
background: textColor ? ’linear-gradient(135deg, ’ + color + ’, ’ + color + ‘cc)’ : color + ‘18’,
color: textColor || color,
fontWeight: 900, fontSize: 12, cursor: ‘pointer’,
letterSpacing: 1, fontFamily: ‘Georgia, serif’,
boxShadow: textColor ? ’0 4px 16px ’ + color + ‘44’ : ‘none’,
}),
log: {
height: 30, overflowY: ‘hidden’, padding: ‘6px 12px’,
background: ‘rgba(0,0,0,0.5)’, borderTop: ‘1px solid rgba(255,255,255,0.04)’,
color: ‘#2a4a5a’, fontSize: 10, whiteSpace: ‘nowrap’, overflowX: ‘auto’,
},
modalOverlay: {
position: ‘fixed’, inset: 0, background: ‘rgba(0,0,0,0.9)’,
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’,
zIndex: 200, padding: 16, fontFamily: ‘Georgia, serif’,
},
modal: {
background: ‘linear-gradient(135deg, #061a26, #0a2e3d)’,
border: ‘1px solid rgba(240,192,64,0.2)’,
borderRadius: 20, padding: 28,
width: ‘100%’, maxWidth: 380, maxHeight: ‘85vh’, overflowY: ‘auto’,
},
modalTitle: { color: ‘#f0c040’, margin: ‘8px 0 4px’, fontSize: 20, letterSpacing: 3, fontFamily: ‘Georgia, serif’ },
scoreRow: {
display: ‘flex’, justifyContent: ‘space-between’, padding: ‘8px 0’,
borderBottom: ‘1px solid rgba(255,255,255,0.05)’, letterSpacing: 1,
},
};