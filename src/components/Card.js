import React from 'react';

const SUIT_COLORS = {
  '\u2660': '#1a1a2e',
  '\u2663': '#1a1a2e',
  '\u2665': '#c0392b',
  '\u2666': '#c0392b',
};

export default function Card({ card, selected, onClick, small, faceDown, disabled }) {
  if (!card) return null;

  const w = small ? 36 : 58;
  const h = small ? 52 : 84;
  const rankSize = small ? 12 : 19;
  const suitSize = small ? 10 : 14;
  const centerSize = small ? 16 : 26;

  const baseStyle = {
    width: w, height: h, borderRadius: 7,
    background: selected
      ? 'linear-gradient(135deg, #fffbe6, #fff3cc)'
      : 'linear-gradient(160deg, #fff 0%, #f5f5f5 100%)',
    border: selected ? '2.5px solid #f0c040' : '1.5px solid rgba(0,0,0,0.15)',
    boxShadow: selected
      ? '0 0 0 2px rgba(240,192,64,0.4), 0 8px 20px rgba(0,0,0,0.4)'
      : '2px 4px 10px rgba(0,0,0,0.3)',
    cursor: onClick && !disabled ? 'pointer' : 'default',
    flexShrink: 0,
    transform: selected ? 'translateY(-14px) scale(1.05)' : 'none',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    userSelect: 'none',
    opacity: disabled ? 0.45 : 1,
    position: 'relative',
    overflow: 'hidden',
  };

  if (faceDown) {
    return (
      <div style={{
        width: w, height: h, borderRadius: 7,
        background: 'linear-gradient(135deg, #0d3a5c, #071f3a)',
        border: '1.5px solid rgba(255,255,255,0.12)',
        flexShrink: 0,
        boxShadow: '2px 3px 8px rgba(0,0,0,0.6)',
        backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 8px)',
      }} />
    );
  }

  if (card.isJoker) {
    return (
      <div onClick={!disabled ? onClick : undefined} style={Object.assign({}, baseStyle, {
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '2px 0',
      })}>
        <div style={{
          fontSize: small ? 7 : 9, fontWeight: 900,
          color: '#c0392b', letterSpacing: 0.5, lineHeight: 1,
        }}>JOKER</div>
        <div style={{ fontSize: small ? 18 : 26, lineHeight: 1.1 }}>&#x1F0CF;</div>
        {card.declaredAs && (
          <div style={{ fontSize: small ? 7 : 9, color: '#2980b9', fontWeight: 800 }}>
            {card.declaredAs}
          </div>
        )}
        <div style={{
          position: 'absolute', bottom: 2, right: 3,
          fontSize: small ? 7 : 9, fontWeight: 900,
          color: '#c0392b', transform: 'rotate(180deg)', lineHeight: 1,
        }}>JOKER</div>
      </div>
    );
  }

  const color = SUIT_COLORS[card.suit] || '#1a1a2e';

  return (
    <div onClick={!disabled ? onClick : undefined} style={Object.assign({}, baseStyle, {
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: '3px 4px',
    })}>
      <div style={{ color, lineHeight: 1 }}>
        <div style={{ fontSize: rankSize, fontWeight: 900, fontFamily: 'Georgia, serif' }}>{card.rank}</div>
        <div style={{ fontSize: suitSize }}>{card.suit}</div>
      </div>
      <div style={{ color, fontSize: centerSize, textAlign: 'center', lineHeight: 1 }}>{card.suit}</div>
      <div style={{ color, lineHeight: 1, transform: 'rotate(180deg)', alignSelf: 'flex-end' }}>
        <div style={{ fontSize: rankSize, fontWeight: 900, fontFamily: 'Georgia, serif' }}>{card.rank}</div>
        <div style={{ fontSize: suitSize }}>{card.suit}</div>
      </div>
    </div>
  );
}
