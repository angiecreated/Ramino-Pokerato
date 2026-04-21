import React from "react";

const SUIT_COLORS = { "♠": "#1a1a2e", "♣": "#1a1a2e", "♥": "#c0392b", "♦": "#c0392b", "🃏": "#f0c040" };

export default function Card({ card, selected, onClick, small, faceDown, disabled }) {
  if (!card) return null;

  const isRed = card.suit === "♥" || card.suit === "♦";
  const color = SUIT_COLORS[card.suit] || "#1a1a2e";

  const size = small ? { w: 36, h: 52, fontSize: 11, suitSize: 10 } : { w: 56, h: 80, fontSize: 15, suitSize: 14 };

  if (faceDown) {
    return (
      <div onClick={onClick} style={{
        width: size.w, height: size.h, borderRadius: 6,
        background: "linear-gradient(135deg, #1a3a6e, #0d1f3c)",
        border: "2px solid rgba(255,255,255,0.15)",
        cursor: onClick ? "pointer" : "default",
        flexShrink: 0,
        backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, transparent 2px, transparent 8px)",
      }} />
    );
  }

  return (
    <div onClick={!disabled ? onClick : undefined} style={{
      width: size.w, height: size.h, borderRadius: 7,
      background: selected
        ? "linear-gradient(135deg, #fff9e6, #fff3cc)"
        : "linear-gradient(135deg, #ffffff, #f5f5f5)",
      border: selected ? "2.5px solid #f0c040" : "1.5px solid rgba(0,0,0,0.15)",
      boxShadow: selected
        ? "0 0 12px rgba(240,192,64,0.6), 0 4px 12px rgba(0,0,0,0.3)"
        : "0 2px 8px rgba(0,0,0,0.25)",
      cursor: onClick && !disabled ? "pointer" : "default",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "3px 4px",
      transform: selected ? "translateY(-8px)" : "none",
      transition: "transform 0.15s, box-shadow 0.15s",
      userSelect: "none",
      opacity: disabled ? 0.5 : 1,
    }}>
      {card.isJoker ? (
        <div style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          height: "100%", fontSize: small ? 20 : 28,
        }}>🃏</div>
      ) : (
        <>
          <div style={{ color, fontSize: size.fontSize, fontWeight: 800, lineHeight: 1 }}>
            <div>{card.rank}</div>
            <div style={{ fontSize: size.suitSize }}>{card.suit}</div>
          </div>
          <div style={{
            color, fontSize: size.fontSize * 1.4, textAlign: "center",
            lineHeight: 1, fontWeight: 400,
          }}>{card.suit}</div>
          <div style={{
            color, fontSize: size.fontSize, fontWeight: 800,
            lineHeight: 1, transform: "rotate(180deg)", alignSelf: "flex-end",
          }}>
            <div>{card.rank}</div>
            <div style={{ fontSize: size.suitSize }}>{card.suit}</div>
          </div>
        </>
      )}
    </div>
  );
}
