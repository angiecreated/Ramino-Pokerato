import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { ref, set, onValue, update } from 'firebase/database';
import { generateRoomCode, createDeck } from '../utils/gameLogic';

export default function Lobby({ onGameStart }) {
  const [mode, setMode] = useState(null);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(null);
  const [playerId] = useState(() => Math.random().toString(36).slice(2));

  useEffect(() => {
    if (!waiting) return;
    const unsub = onValue(ref(db, 'rooms/' + waiting.roomCode), (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.status === 'playing') {
        onGameStart({ roomCode: waiting.roomCode, playerId, playerName: waiting.name, room: data });
      }
    });
    return () => unsub();
  }, [waiting]);

  const handleCreate = async () => {
    if (!name.trim()) { setError('Inserisci il tuo nome'); return; }
    const code = generateRoomCode();
    await set(ref(db, 'rooms/' + code), {
      code, status: 'waiting', host: playerId,
      players: { [playerId]: { name: name.trim(), id: playerId, score: 0, apertureUsate: {}, aperta: false, order: 0 } },
      createdAt: Date.now(),
    });
    setWaiting({ roomCode: code, name: name.trim() });
  };

  const handleJoin = async () => {
    if (!name.trim()) { setError('Inserisci il tuo nome'); return; }
    if (!roomCode.trim()) { setError('Inserisci il codice stanza'); return; }
    const code = roomCode.toUpperCase().trim();
    onValue(ref(db, 'rooms/' + code), async (snap) => {
      const data = snap.val();
      if (!data) { setError('Stanza non trovata'); return; }
      if (data.status === 'playing') { setError('Partita gia iniziata'); return; }
      const playerCount = Object.keys(data.players || {}).length;
      if (playerCount >= 6) { setError('Stanza piena'); return; }
      await update(ref(db, 'rooms/' + code + '/players/' + playerId), {
        name: name.trim(), id: playerId, score: 0, apertureUsate: {}, aperta: false, order: playerCount,
      });
      setWaiting({ roomCode: code, name: name.trim() });
    }, { onlyOnce: true });
  };

  const handleStartGame = async () => {
    const code = waiting.roomCode;
    const snap = await new Promise(res => onValue(ref(db, 'rooms/' + code), res, { onlyOnce: true }));
    const room = snap.val();
    const playerIds = Object.keys(room.players || {});
    const deck = createDeck();
    const hands = {};
    playerIds.forEach(pid => { hands[pid] = deck.splice(0, 13); });
    // First card face up - only first player can take it
    const firstCard = deck.splice(0, 1)[0];
    await update(ref(db, 'rooms/' + code), {
      status: 'playing', deck, discardPile: [], topDiscard: firstCard,
      table: [], currentPlayerIndex: 0, playerOrder: playerIds,
      mano: 1, hands, drawnThisTurn: false, chatMessages: [],
      firstManoCard: true, manoCardTaken: false,
      log: ['Partita iniziata!'],
    });
  };

  if (waiting) {
    return <WaitingRoom roomCode={waiting.roomCode} playerId={playerId} onStart={handleStartGame} />;
  }

  return (
    <div style={s.screen}>
      <div style={s.hero}>
        <img src="/logo.jpeg" alt="Pokerami" style={{ width: 180, height: 180, objectFit: 'contain', marginBottom: 8 }} />
        <p style={s.subtitle2}>RAMINO POKERATO</p>
        <p style={s.subtitle}>La variante pazza</p>
      </div>

      {!mode ? (
        <div style={s.btnGroup}>
          <button onClick={() => setMode('create')} style={s.btnPrimary}>CREA PARTITA</button>
          <button onClick={() => setMode('join')} style={s.btnSecondary}>ENTRA IN UNA PARTITA</button>
        </div>
      ) : (
        <div style={s.card}>
          <h2 style={s.cardTitle}>{mode === 'create' ? 'CREA PARTITA' : 'ENTRA IN PARTITA'}</h2>
          <label style={s.label}>IL TUO NOME</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder='Come ti chiami?'
            style={s.input} autoComplete='off' autoCorrect='off' autoCapitalize='off' spellCheck='false' />
          {mode === 'join' && (
            <div>
              <label style={Object.assign({}, s.label, { marginTop: 16 })}>CODICE STANZA</label>
              <input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder='ES. ABC123'
                style={Object.assign({}, s.input, { letterSpacing: 6, fontWeight: 800, textAlign: 'center' })}
                autoComplete='off' autoCorrect='off' autoCapitalize='characters' spellCheck='false' />
            </div>
          )}
          {error && <p style={s.error}>{error}</p>}
          <button onClick={mode === 'create' ? handleCreate : handleJoin}
            style={Object.assign({}, s.btnPrimary, { width: '100%', marginTop: 24 })}>
            {mode === 'create' ? 'CREA STANZA' : 'ENTRA'}
          </button>
          <button onClick={() => { setMode(null); setError(''); }} style={s.btnBack}>INDIETRO</button>
        </div>
      )}
    </div>
  );
}

function WaitingRoom({ roomCode, playerId, onStart }) {
  const [players, setPlayers] = useState({});
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, 'rooms/' + roomCode), snap => {
      const data = snap.val();
      if (!data) return;
      setPlayers(data.players || {});
      setIsHost(data.host === playerId);
    });
    return () => unsub();
  }, [roomCode, playerId]);

  const playerList = Object.values(players).sort((a, b) => a.order - b.order);
  const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

  return (
    <div style={s.screen}>
      <div style={s.hero}>
        <h1 style={s.title}>POKERAMI</h1>
        <p style={s.subtitle2}>RAMINO POKERATO</p>
      </div>
      <div style={s.roomCodeBox}>
        <div style={s.roomCodeLabel}>CODICE STANZA</div>
        <div style={s.roomCode}>{roomCode}</div>
        <div style={s.roomCodeHint}>Condividi con i tuoi amici</div>
      </div>
      <div style={s.card}>
        <div style={s.label}>GIOCATORI ({playerList.length}/6)</div>
        {playerList.map((p, i) => (
          <div key={p.id} style={s.playerRow}>
            <div style={Object.assign({}, s.playerDot, { background: COLORS[i] })} />
            <span style={s.playerName}>{p.name}</span>
            {p.id === playerId && <span style={s.youBadge}>TU</span>}
          </div>
        ))}
      </div>
      {isHost ? (
        <button onClick={onStart} disabled={playerList.length < 2}
          style={playerList.length >= 2 ? s.btnPrimary : s.btnDisabled}>
          {playerList.length < 2 ? 'ASPETTA ALTRI...' : 'INIZIA PARTITA'}
        </button>
      ) : (
        <p style={s.waitText}>In attesa che l host inizi...</p>
      )}
    </div>
  );
}

const s = {
  screen: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #061a26 0%, #0a2e3d 50%, #061a26 100%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 24, fontFamily: 'Georgia, serif',
  },
  hero: { textAlign: 'center', marginBottom: 36 },
  title: {
    fontSize: 48, fontWeight: 900, margin: 0, letterSpacing: 6,
    background: 'linear-gradient(135deg, #f0c040 0%, #e8a020 50%, #f0c040 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    fontFamily: 'Georgia, serif',
  },
  subtitle2: { color: '#c0a030', marginTop: 6, fontSize: 13, letterSpacing: 4, fontFamily: 'Georgia, serif', fontWeight: 700 },
  subtitle: { color: '#4a8fa6', marginTop: 4, fontSize: 11, letterSpacing: 4, fontFamily: 'Georgia, serif' },
  btnGroup: { display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 340 },
  btnPrimary: {
    padding: '16px 28px', borderRadius: 12, border: 'none',
    background: 'linear-gradient(135deg, #f0c040, #c8860a)',
    color: '#061a26', fontWeight: 900, fontSize: 15, cursor: 'pointer', letterSpacing: 2,
    boxShadow: '0 4px 20px rgba(240,192,64,0.35)', fontFamily: 'Georgia, serif',
  },
  btnSecondary: {
    padding: '16px 28px', borderRadius: 12, border: '2px solid rgba(240,192,64,0.5)',
    background: 'transparent', color: '#f0c040', fontWeight: 900, fontSize: 15,
    cursor: 'pointer', letterSpacing: 2, fontFamily: 'Georgia, serif',
  },
  btnDisabled: {
    padding: '16px 28px', borderRadius: 12, border: 'none',
    background: 'rgba(255,255,255,0.1)', color: '#4a5a6a', fontWeight: 900,
    fontSize: 15, cursor: 'not-allowed', letterSpacing: 2, fontFamily: 'Georgia, serif',
  },
  btnBack: {
    background: 'transparent', border: 'none', color: '#4a6a7a', width: '100%',
    marginTop: 12, padding: 10, cursor: 'pointer', fontSize: 13, letterSpacing: 2, fontFamily: 'Georgia, serif',
  },
  card: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, marginBottom: 20,
  },
  cardTitle: { color: '#f0c040', margin: '0 0 20px', fontSize: 18, letterSpacing: 3, fontFamily: 'Georgia, serif' },
  label: { display: 'block', color: '#4a8fa6', fontWeight: 700, fontSize: 11, letterSpacing: 2, marginBottom: 8, fontFamily: 'Georgia, serif' },
  input: {
    width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 16, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'Georgia, serif',
  },
  error: { color: '#e74c3c', fontSize: 13, marginTop: 10, fontFamily: 'Georgia, serif' },
  roomCodeBox: {
    background: 'rgba(240,192,64,0.08)', border: '2px solid rgba(240,192,64,0.3)',
    borderRadius: 16, padding: '16px 32px', textAlign: 'center', marginBottom: 24,
  },
  roomCodeLabel: { color: '#4a8fa6', fontSize: 11, letterSpacing: 3, fontFamily: 'Georgia, serif' },
  roomCode: { color: '#f0c040', fontSize: 40, fontWeight: 900, letterSpacing: 8, fontFamily: 'Georgia, serif' },
  roomCodeHint: { color: '#4a6a7a', fontSize: 12, fontFamily: 'Georgia, serif' },
  playerRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  playerDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  playerName: { color: '#e0eaf4', fontWeight: 600, flex: 1, fontSize: 15, fontFamily: 'Georgia, serif' },
  youBadge: { color: '#f0c040', fontSize: 10, letterSpacing: 1, fontFamily: 'Georgia, serif' },
  waitText: { color: '#4a6a7a', fontSize: 14, fontFamily: 'Georgia, serif' },
};
