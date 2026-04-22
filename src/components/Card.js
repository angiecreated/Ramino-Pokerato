import React from “react”;

const SUIT_COLORS = {
“♠”: “#1a1a2e”,
“♣”: “#1a1a2e”,
“♥”: “#c0392b”,
“♦”: “#c0392b”,
“🃏”: “#e8a020”
};

export default function Card({ card, selected, onClick, small, faceDown, disabled, dragging }) {
if (!card) return null;

const color = SUIT_COLORS[card.suit] || “#1a1a2e”;

if (faceDown) {
return (
<div onClick={onClick} style={{
width: small ? 38 : 62,
height: small ? 54 : 88,
borderRadius: 8,
background: “linear-gradient(135deg, #0a3d5c, #062a40)”,
border: “2px solid rgba(255,255,255,0.15)”,
cursor: onClick ? “pointer” : “default”,
flexShrink: 0,
boxShadow: “2px 3px 8px rgba(0,0,0,0.5)”,
backgroundImage: `repeating-linear-gradient( 45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 2px, transparent 2px, transparent 8px )`,
}} />
);
}

const w = small ? 38 : 62;
const h = small ? 54 : 88;
const rankSize = small ? 13 : 20;
const suitSize = small ? 11 : 16;
const centerSize = small ? 18 : 28;

return (
<div
onClick={!disabled ? onClick : undefined}
style={{
width: w,
height: h,
borderRadius: 8,
background: selected
? “linear-gradient(135deg, #fffbe6, #fff8d0)”
: “linear-gradient(160deg, #ffffff 0%, #f0f0f0 100%)”,
border: selected
? “2.5px solid #f0c040”
: “1.5px solid rgba(0,0,0,0.18)”,
boxShadow: selected
? “0 0 0 2px #f0c04066, 0 8px 20px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)”
: dragging
? “0 16px 32px rgba(0,0,0,0.5)”
: “2px 4px 10px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.2)”,
cursor: onClick && !disabled ? “pointer” : “default”,
flexShrink: 0,
display: “flex”,
flexDirection: “column”,
justifyContent: “space-between”,
padding: “3px 4px”,
transform: selected
? “translateY(-12px) scale(1.05)”
: dragging
? “scale(1.08) rotate(2deg)”
: “none”,
transition: “transform 0.15s ease, box-shadow 0.15s ease”,
userSelect: “none”,
opacity: disabled ? 0.45 : 1,
position: “relative”,
perspective: “500px”,
}}
>
{card.isJoker ? (
<div style={{
display: “flex”,
flexDirection: “column”,
alignItems: “center”,
justifyContent: “center”,
height: “100%”,
fontSize: centerSize,
}}>🃏</div>
) : (
<>
{/* Top left */}
<div style={{
color,
lineHeight: 1,
fontFamily: “‘Georgia’, serif”,
}}>
<div style={{ fontSize: rankSize, fontWeight: 900 }}>{card.rank}</div>
<div style={{ fontSize: suitSize, marginTop: -2 }}>{card.suit}</div>
</div>

```
      {/* Center suit */}
      <div style={{
        color,
        fontSize: centerSize,
        textAlign: "center",
        lineHeight: 1,
      }}>{card.suit}</div>

      {/* Bottom right (rotated) */}
      <div style={{
        color,
        lineHeight: 1,
        transform: "rotate(180deg)",
        alignSelf: "flex-end",
        fontFamily: "'Georgia', serif",
      }}>
        <div style={{ fontSize: rankSize, fontWeight: 900 }}>{card.rank}</div>
        <div style={{ fontSize: suitSize, marginTop: -2 }}>{card.suit}</div>
      </div>
    </>
  )}
</div>
```

);
}