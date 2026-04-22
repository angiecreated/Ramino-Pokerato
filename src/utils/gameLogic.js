export const SUITS = [“♠”, “♥”, “♦”, “♣”];
export const RANKS = [“A”, “2”, “3”, “4”, “5”, “6”, “7”, “8”, “9”, “10”, “J”, “Q”, “K”];

export const RANK_VALUES = {
A: 11, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10, JOKER: 25
};

export const RANK_ORDER = {
A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13
};

export const APERTURE_TYPES = [
{ id: “coppia”, label: “COPPIA”, emoji: “✌️”, desc: “2 carte dello stesso valore” },
{ id: “doppia_coppia”, label: “DOPPIA COPPIA”, emoji: “🂠”, desc: “2 coppie” },
{ id: “tris”, label: “TRIS”, emoji: “🔱”, desc: “3 carte dello stesso valore” },
{ id: “full”, label: “FULL”, emoji: “🏠”, desc: “Tris + Coppia” },
{ id: “poker”, label: “POKER”, emoji: “♠️”, desc: “4 carte dello stesso valore” },
{ id: “scala_colore”, label: “SCALA COLORE”, emoji: “🌈”, desc: “5 carte in sequenza stesso seme” },
{ id: “scala_40”, label: “SCALA 40”, emoji: “📏”, desc: “Sequenza >= 40 punti stesso seme” },
{ id: “chiusura”, label: “CHIUSURA”, emoji: “⚡”, desc: “Scendi e chiudi nello stesso turno” },
];

export function createDeck() {
const deck = [];
for (let d = 0; d < 2; d++) {
for (const suit of SUITS) {
for (const rank of RANKS) {
deck.push({
id: `${rank}${suit}_${d}`,
rank,
suit,
value: RANK_VALUES[rank],
isJoker: false
});
}
}
deck.push({ id: `JOKER_${d}`, rank: “JOKER”, suit: “🃏”, value: 25, isJoker: true });
}
return shuffle(deck);
}

export function shuffle(arr) {
const a = […arr];
for (let i = a.length - 1; i > 0; i–) {
const j = Math.floor(Math.random() * (i + 1));
[a[i], a[j]] = [a[j], a[i]];
}
return a;
}

// Asso vale 11 con altre carte, 1 se è l’ultima carta in mano
export function handPoints(cards) {
if (!cards || cards.length === 0) return 0;
const hasOtherCards = cards.length > 1;
return cards.reduce((s, c) => {
if (c.isJoker) return s + 25;
if (c.rank === “A”) return s + (hasOtherCards ? 11 : 1);
return s + (RANK_VALUES[c.rank] || 0);
}, 0);
}

export function cardPoints(card) {
if (!card) return 0;
if (card.isJoker) return 25;
return RANK_VALUES[card.rank] || 0;
}

// Auto-detect apertura type from cards (no jokers allowed)
export function detectApertura(cards) {
if (!cards || cards.length === 0) return null;
const hasJoker = cards.some(c => c.isJoker);
if (hasJoker) return null;

if (isCoppia(cards)) return “coppia”;
if (isDoppiaCoppia(cards)) return “doppia_coppia”;
if (isTris(cards)) return “tris”;
if (isFull(cards)) return “full”;
if (isPoker(cards)) return “poker”;
if (isScalaColore(cards)) return “scala_colore”;
if (isScala40(cards)) return “scala_40”;
return null;
}

export function isCoppia(cards) {
if (cards.length !== 2) return false;
return cards[0].rank === cards[1].rank;
}

export function isDoppiaCoppia(cards) {
if (cards.length !== 4) return false;
const ranks = cards.map(c => c.rank);
const unique = […new Set(ranks)];
if (unique.length !== 2) return false;
return (
ranks.filter(r => r === unique[0]).length === 2 &&
ranks.filter(r => r === unique[1]).length === 2
);
}

export function isTris(cards) {
if (cards.length !== 3) return false;
return cards.every(c => c.rank === cards[0].rank);
}

export function isFull(cards) {
if (cards.length !== 5) return false;
const ranks = cards.map(c => c.rank);
const unique = […new Set(ranks)];
if (unique.length !== 2) return false;
const c0 = ranks.filter(r => r === unique[0]).length;
const c1 = ranks.filter(r => r === unique[1]).length;
return (c0 === 3 && c1 === 2) || (c0 === 2 && c1 === 3);
}

export function isPoker(cards) {
if (cards.length !== 4) return false;
return cards.every(c => c.rank === cards[0].rank);
}

export function isScalaColore(cards) {
if (cards.length !== 5) return false;
if (!cards.every(c => c.suit === cards[0].suit)) return false;
const orders = cards.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
for (let i = 1; i < orders.length; i++) {
if (orders[i] !== orders[i - 1] + 1) return false;
}
return true;
}

export function isScala40(cards) {
if (cards.length < 3) return false;
if (!cards.every(c => c.suit === cards[0].suit)) return false;
const orders = cards.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
for (let i = 1; i < orders.length; i++) {
if (orders[i] !== orders[i - 1] + 1) return false;
}
// Use fixed values (not asso special rule) for scala 40 calculation
const total = cards.reduce((s, c) => s + (RANK_VALUES[c.rank] || 0), 0);
return total >= 40;
}

// Valid combination for table play (can include jokers)
export function isValidCombination(cards) {
if (!cards || cards.length < 2) return false;
const nonJokers = cards.filter(c => !c.isJoker);
const jokerCount = cards.filter(c => c.isJoker).length;

if (nonJokers.length === 0) return false;

// Same rank (tris/poker style)
const rank = nonJokers[0].rank;
if (nonJokers.every(c => c.rank === rank)) {
if (cards.length >= 2 && cards.length <= 4) return true;
}

// Sequential same suit (scala style)
const suit = nonJokers[0].suit;
if (nonJokers.every(c => c.suit === suit)) {
const orders = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
let gaps = 0;
for (let i = 1; i < orders.length; i++) {
gaps += orders[i] - orders[i - 1] - 1;
}
if (gaps <= jokerCount && cards.length >= 3) return true;
}

return false;
}

// Check if hand can be closed (all cards form valid combos, one card to discard)
export function canChiuderInMano(cardsToPlay) {
if (!cardsToPlay || cardsToPlay.length === 0) return false;
return tryGroupCards([…cardsToPlay]);
}

function tryGroupCards(cards) {
if (cards.length === 0) return true;
if (cards.length < 2) return false;

for (let size = 2; size <= Math.min(cards.length, 13); size++) {
const combos = getCombinations(cards, size);
for (const combo of combos) {
if (isValidCombination(combo)) {
const remaining = cards.filter(c => !combo.find(x => x.id === c.id));
if (remaining.length === 0 || tryGroupCards(remaining)) return true;
}
}
}
return false;
}

function getCombinations(arr, size) {
if (size > arr.length) return [];
if (size === arr.length) return [arr];
if (size === 1) return arr.map(x => [x]);
const result = [];
for (let i = 0; i <= arr.length - size; i++) {
const rest = getCombinations(arr.slice(i + 1), size - 1);
for (const combo of rest) result.push([arr[i], …combo]);
}
return result;
}

export function generateRoomCode() {
return Math.random().toString(36).substring(2, 8).toUpperCase();
}