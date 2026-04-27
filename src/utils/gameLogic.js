// ============================================================
// POKERAMI - Game Logic
// ============================================================

export const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663']; // spade, cuori, quadri, fiori
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Card point values (in hand at end)
export const RANK_VALUES = {
  A: 11, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
  8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10, JOKER: 25
};

// Card order for sequences
export const RANK_ORDER = {
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
  8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13
};

// Figurate cards (for coppia/doppia coppia)
export const FIGURATE = ['A', 'K', 'Q', 'J'];

// The 8 aperture types
export const APERTURE_TYPES = [
  { id: 'coppia', label: 'COPPIA', desc: '2 carte figurate (A K Q J) semi diversi' },
  { id: 'doppia_coppia', label: 'DOPPIA COPPIA', desc: 'Una coppia figurata + una coppia qualsiasi' },
  { id: 'tris', label: 'TRIS', desc: '3 carte stesso valore semi diversi' },
  { id: 'full', label: 'FULL', desc: 'Tris + Coppia (coppia qualsiasi)' },
  { id: 'poker', label: 'POKER', desc: '4 carte stesso valore semi diversi' },
  { id: 'reale', label: 'REALE', desc: '5 carte in ordine dello stesso seme' },
  { id: 'quaranta', label: 'SCALA 40', desc: 'Combinazioni che raggiungono 40 punti' },
  { id: 'chiusura', label: 'CHIUSURA', desc: 'Chiudi in mano con tutte le carte' },
];

// ============================================================
// DECK
// ============================================================

export function createDeck() {
  const deck = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          id: rank + suit + '_' + d,
          rank, suit,
          value: RANK_VALUES[rank],
          isJoker: false
        });
      }
    }
    deck.push({ id: 'JOKER_' + d, rank: 'JOKER', suit: 'JK', value: 25, isJoker: true });
  }
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// POINTS
// ============================================================

// Points remaining in hand (asso always 11 in hand)
export function handPoints(cards) {
  if (!cards || cards.length === 0) return 0;
  return cards.reduce((s, c) => {
    if (c.isJoker) return s + 25;
    return s + (RANK_VALUES[c.rank] || 0);
  }, 0);
}

// Points for 40 calculation (asso: 1 in low sequence A-2-3, 11 otherwise)
export function comboPoints(cards) {
  if (!cards || cards.length === 0) return 0;
  const nonJokers = cards.filter(c => !c.isJoker);
  const orders = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  const isLowSequence = orders[0] === 1 && orders[1] === 2; // A-2-...

  return cards.reduce((s, c) => {
    if (c.isJoker) return s + (c.declaredValue || 0);
    if (c.rank === 'A') return s + (isLowSequence ? 1 : 11);
    return s + (RANK_VALUES[c.rank] || 0);
  }, 0);
}

// ============================================================
// SORT HELPERS
// ============================================================

export function sortBySuit(cards) {
  const suitOrder = { '\u2660': 0, '\u2665': 1, '\u2666': 2, '\u2663': 3, 'JK': 4 };
  return [...cards].sort((a, b) => {
    const sd = (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0);
    if (sd !== 0) return sd;
    return (RANK_ORDER[a.rank] || 0) - (RANK_ORDER[b.rank] || 0);
  });
}

export function sortByValue(cards) {
  const suitOrder = { '\u2660': 0, '\u2665': 1, '\u2666': 2, '\u2663': 3, 'JK': 4 };
  return [...cards].sort((a, b) => {
    const rd = (RANK_ORDER[a.rank] || 0) - (RANK_ORDER[b.rank] || 0);
    if (rd !== 0) return rd;
    return (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0);
  });
}

// Sort cards for display on table
export function sortForTable(cards) {
  const nonJokers = cards.filter(c => !c.isJoker);
  const jokers = cards.filter(c => c.isJoker);
  if (nonJokers.length === 0) return cards;

  const allSameSuit = nonJokers.every(c => c.suit === nonJokers[0].suit);
  const allSameRank = nonJokers.every(c => c.rank === nonJokers[0].rank);

  if (allSameSuit) {
    // Scala - sort by rank, insert joker in gap
    const sorted = [...nonJokers].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    if (jokers.length > 0) return insertJokerInGap(sorted, jokers[0]);
    return sorted;
  } else if (allSameRank) {
    // Tris/Poker - sort by suit
    const suitOrder = { '\u2660': 0, '\u2665': 1, '\u2666': 2, '\u2663': 3 };
    const sorted = [...nonJokers].sort((a, b) => (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0));
    return [...sorted, ...jokers];
  } else {
    // Mixed combo (full, doppia coppia) - group by rank
    const rankGroups = {};
    nonJokers.forEach(c => {
      if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
      rankGroups[c.rank].push(c);
    });
    // Sort ranks: larger groups first (tris before coppia), then by rank value descending
    const suitOrder = { '\u2660': 0, '\u2665': 1, '\u2666': 2, '\u2663': 3 };
    const sortedRanks = Object.keys(rankGroups).sort((a, b) => {
      // Larger group first
      if (rankGroups[b].length !== rankGroups[a].length) {
        return rankGroups[b].length - rankGroups[a].length;
      }
      // Same size: higher rank first
      return (RANK_ORDER[b] || 0) - (RANK_ORDER[a] || 0);
    });
    const sorted = [];
    sortedRanks.forEach(rank => {
      const group = [...rankGroups[rank]].sort((a, b) => (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0));
      sorted.push(...group);
    });
    return [...sorted, ...jokers];
  }
}

function insertJokerInGap(sortedCards, joker) {
  if (sortedCards.length < 2) return [...sortedCards, joker];
  for (let i = 0; i < sortedCards.length - 1; i++) {
    const curr = RANK_ORDER[sortedCards[i].rank];
    const next = RANK_ORDER[sortedCards[i + 1].rank];
    if (next - curr === 2) {
      // Gap found - insert joker here
      const result = [...sortedCards];
      result.splice(i + 1, 0, joker);
      return result;
    }
  }
  // No gap in middle - joker goes at end
  return [...sortedCards, joker];
}

// ============================================================
// JOKER DECLARATION
// ============================================================

// Find what card a joker represents in a sorted scala
export function getJokerDeclaration(sortedCards, joker) {
  const idx = sortedCards.findIndex(c => c.id === joker.id);
  if (idx === -1) return null;
  const prev = sortedCards[idx - 1];
  const next = sortedCards[idx + 1];
  if (prev && next) {
    const prevOrder = RANK_ORDER[prev.rank];
    const nextOrder = RANK_ORDER[next.rank];
    if (nextOrder - prevOrder === 2) {
      const missingOrder = prevOrder + 1;
      const rankEntry = Object.entries(RANK_ORDER).find(([r, o]) => o === missingOrder);
      if (rankEntry) return rankEntry[0] + prev.suit;
    }
  }
  if (!prev && next) {
    const nextOrder = RANK_ORDER[next.rank];
    if (nextOrder > 1) {
      const rankEntry = Object.entries(RANK_ORDER).find(([r, o]) => o === nextOrder - 1);
      if (rankEntry) return rankEntry[0] + next.suit;
    }
  }
  if (prev && !next) {
    const prevOrder = RANK_ORDER[prev.rank];
    if (prevOrder < 13) {
      const rankEntry = Object.entries(RANK_ORDER).find(([r, o]) => o === prevOrder + 1);
      if (rankEntry) return rankEntry[0] + prev.suit;
    }
  }
  return null;
}

// Get missing suits for tris joker declaration
export function getMissingTrisSuits(nonJokerCards) {
  const usedSuits = nonJokerCards.map(c => c.suit);
  return SUITS.filter(s => !usedSuits.includes(s));
}

// ============================================================
// APERTURA VALIDATION (no jokers allowed)
// ============================================================

export function detectApertura(cards) {
  if (!cards || cards.length === 0) return null;
  if (cards.some(c => c.isJoker)) return null; // no jokers in apertura

  if (isCoppia(cards)) return 'coppia';
  if (isDoppiaCoppia(cards)) return 'doppia_coppia';
  if (isTris(cards)) return 'tris';
  if (isFull(cards)) return 'full';
  if (isPoker(cards)) return 'poker';
  if (isReale(cards)) return 'reale';
  if (isQuaranta(cards)) return 'quaranta';
  return null;
}

// Coppia: exactly 2 figurate cards, same rank, different suits
export function isCoppia(cards) {
  if (cards.length !== 2) return false;
  if (!cards.every(c => FIGURATE.includes(c.rank))) return false;
  if (cards[0].rank !== cards[1].rank) return false;
  return cards[0].suit !== cards[1].suit;
}

// Doppia coppia: one figurate pair + one any pair, different suits within each pair
export function isDoppiaCoppia(cards) {
  if (cards.length !== 4) return false;
  const ranks = cards.map(c => c.rank);
  const unique = [...new Set(ranks)];
  if (unique.length !== 2) return false;
  const group0 = cards.filter(c => c.rank === unique[0]);
  const group1 = cards.filter(c => c.rank === unique[1]);
  if (group0.length !== 2 || group1.length !== 2) return false;
  // Each pair must have different suits
  if (group0[0].suit === group0[1].suit) return false;
  if (group1[0].suit === group1[1].suit) return false;
  // At least one pair must be figurata
  return FIGURATE.includes(unique[0]) || FIGURATE.includes(unique[1]);
}

// Tris: 3 cards same rank, all different suits
export function isTris(cards) {
  if (cards.length !== 3) return false;
  if (!cards.every(c => c.rank === cards[0].rank)) return false;
  const suits = cards.map(c => c.suit);
  return new Set(suits).size === 3;
}

// Full: tris (3 same rank different suits) + coppia (2 same rank different suits)
export function isFull(cards) {
  if (cards.length !== 5) return false;
  const ranks = cards.map(c => c.rank);
  const unique = [...new Set(ranks)];
  if (unique.length !== 2) return false;
  const group0 = cards.filter(c => c.rank === unique[0]);
  const group1 = cards.filter(c => c.rank === unique[1]);
  const trisGroup = group0.length === 3 ? group0 : group1;
  const coppiaGroup = group0.length === 2 ? group0 : group1;
  if (trisGroup.length !== 3 || coppiaGroup.length !== 2) return false;
  // Tris: all different suits
  if (new Set(trisGroup.map(c => c.suit)).size !== 3) return false;
  // Coppia: different suits
  return coppiaGroup[0].suit !== coppiaGroup[1].suit;
}

// Poker: 4 cards same rank, all different suits
export function isPoker(cards) {
  if (cards.length !== 4) return false;
  if (!cards.every(c => c.rank === cards[0].rank)) return false;
  const suits = cards.map(c => c.suit);
  return new Set(suits).size === 4;
}

// Reale: exactly 5 cards same suit in sequence
export function isReale(cards) {
  if (cards.length !== 5) return false;
  if (!cards.every(c => c.suit === cards[0].suit)) return false;
  return isSequential(cards);
}

// Check if cards form a valid sequence (handles A as high or low)
function isSequential(cards) {
  const nonJokers = cards.filter(c => !c.isJoker);
  const orders = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  // Check normal sequence
  let gaps = 0;
  for (let i = 1; i < orders.length; i++) gaps += orders[i] - orders[i-1] - 1;
  if (gaps === 0) return true;
  // Check A as high (14) - if A is present and lowest
  if (orders[0] === 1) {
    const highOrders = orders.slice(1).concat([14]);
    let highGaps = 0;
    for (let i = 1; i < highOrders.length; i++) highGaps += highOrders[i] - highOrders[i-1] - 1;
    if (highGaps === 0) return true;
  }
  return false;
}

// Quaranta: one or more combinations totaling >= 40 points
export function isQuaranta(cards) {
  if (cards.length < 2) return false;
  const total = comboPoints(cards);
  if (total < 40) return false;
  return canFormValidGroups(cards);
}

function canFormValidGroups(cards) {
  if (cards.length === 0) return true;
  // Try groups of min size 2 up to all cards
  for (let size = 2; size <= cards.length; size++) {
    const combos = getCombinations(cards, size);
    for (const combo of combos) {
      if (isValidSingleGroup(combo)) {
        const remaining = cards.filter(c => !combo.find(x => x.id === c.id));
        if (remaining.length === 0 || canFormValidGroups(remaining)) return true;
      }
    }
  }
  return false;
}

function isValidSingleGroup(cards) {
  if (cards.length < 2) return false;
  const nonJokers = cards.filter(c => !c.isJoker);
  if (nonJokers.length === 0) return false;

  // Coppia (2 same rank different suits) - valid as part of quaranta
  if (cards.length === 2 && nonJokers.every(c => c.rank === nonJokers[0].rank)) {
    return nonJokers[0].suit !== nonJokers[1].suit;
  }
  // Tris (3 same rank different suits)
  if (cards.length === 3 && nonJokers.every(c => c.rank === nonJokers[0].rank)) {
    return new Set(nonJokers.map(c => c.suit)).size === nonJokers.length;
  }
  // Poker (4 same rank different suits)
  if (cards.length === 4 && nonJokers.every(c => c.rank === nonJokers[0].rank)) {
    return new Set(nonJokers.map(c => c.suit)).size === nonJokers.length;
  }
  // Scala (3+ same suit sequential, handles A high and low)
  if (cards.length >= 3 && nonJokers.every(c => c.suit === nonJokers[0].suit)) {
    const orders = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    if (new Set(orders).size !== orders.length) return false;
    // Normal sequence
    let gaps = 0;
    for (let i = 1; i < orders.length; i++) gaps += orders[i] - orders[i - 1] - 1;
    if (gaps === 0) return true;
    // A as high (Q-K-A)
    if (orders[0] === 1) {
      const highOrders = orders.slice(1).concat([14]);
      let highGaps = 0;
      for (let i = 1; i < highOrders.length; i++) highGaps += highOrders[i] - highOrders[i-1] - 1;
      if (highGaps === 0) return true;
    }
  }
  return false;
}

// ============================================================
// TABLE COMBINATION VALIDATION
// ============================================================

// Validate a new combination to put on table (after opening, no jokers)
export function isValidTableCombination(cards) {
  if (!cards || cards.length < 3) return false;
  const nonJokers = cards.filter(c => !c.isJoker);
  const jokerCount = cards.filter(c => c.isJoker).length;
  if (jokerCount > 1) return false; // max 1 joker
  if (nonJokers.length === 0) return false;

  // Tris: 3 same rank, different suits, no jokers needed
  if (cards.length === 3 && nonJokers.length === 3) {
    if (nonJokers.every(c => c.rank === nonJokers[0].rank)) {
      return new Set(nonJokers.map(c => c.suit)).size === 3;
    }
  }

  // Poker: 4 same rank, different suits
  if (cards.length === 4 && nonJokers.length === 4) {
    if (nonJokers.every(c => c.rank === nonJokers[0].rank)) {
      return new Set(nonJokers.map(c => c.suit)).size === 4;
    }
  }

  // Scala: min 3 same suit sequential, max 1 joker in gap
  if (nonJokers.every(c => c.suit === nonJokers[0].suit)) {
    const orders = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    if (new Set(orders).size !== orders.length) return false;
    // Check normal sequence
    let gaps = 0;
    for (let i = 1; i < orders.length; i++) gaps += orders[i] - orders[i - 1] - 1;
    if (gaps <= jokerCount && cards.length >= 3) return true;
    // Check A as high (Q-K-A = 12-13-14)
    if (orders[0] === 1) {
      const highOrders = orders.slice(1).concat([14]);
      let highGaps = 0;
      for (let i = 1; i < highOrders.length; i++) highGaps += highOrders[i] - highOrders[i-1] - 1;
      if (highGaps <= jokerCount && cards.length >= 3) return true;
    }
  }

  // Tris with joker (2 cards + joker)
  if (cards.length === 3 && jokerCount === 1 && nonJokers.length === 2) {
    if (nonJokers[0].rank === nonJokers[1].rank && nonJokers[0].suit !== nonJokers[1].suit) return true;
  }

  return false;
}

// Check if a card can be added to an existing table combination
// Returns: { valid: bool, reason: string, newCards: array }
export function canAddToCombo(existingCards, newCards) {
  if (!existingCards || !newCards || newCards.length === 0) {
    return { valid: false, reason: 'Nessuna carta selezionata' };
  }

  const allJokers = [...existingCards, ...newCards].filter(c => c.isJoker);
  if (allJokers.length > 1) {
    return { valid: false, reason: 'Una combinazione puo avere solo un jolly!' };
  }

  const existingNonJokers = existingCards.filter(c => !c.isJoker);
  const newNonJokers = newCards.filter(c => !c.isJoker);
  const allCards = [...existingCards, ...newCards];
  const allNonJokers = allCards.filter(c => !c.isJoker);
  const jokerCount = allJokers.length;

  // Determine combo type from existing cards
  const isScala = existingNonJokers.length >= 2 &&
    existingNonJokers.every(c => c.suit === existingNonJokers[0].suit);
  const isTrisPoker = existingNonJokers.length >= 2 &&
    existingNonJokers.every(c => c.rank === existingNonJokers[0].rank);

  if (isScala) {
    const scalaSuit = existingNonJokers[0].suit;
    // All new non-joker cards must be same suit as scala
    if (!newNonJokers.every(c => c.suit === scalaSuit)) {
      return { valid: false, reason: 'Le carte devono essere dello stesso seme della scala!' };
    }
    // No duplicate ranks in all non-jokers
    const orders = allNonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    if (new Set(orders).size !== orders.length) {
      return { valid: false, reason: 'Rank duplicato nella scala!' };
    }
    // Check sequential - handle A as high or low
    let gaps = 0;
    for (let i = 1; i < orders.length; i++) gaps += orders[i] - orders[i - 1] - 1;
    let isValid = gaps <= jokerCount;
    // Also try A as high (14)
    if (!isValid && orders[0] === 1) {
      const highOrders = orders.slice(1).concat([14]);
      let highGaps = 0;
      for (let i = 1; i < highOrders.length; i++) highGaps += highOrders[i] - highOrders[i-1] - 1;
      isValid = highGaps <= jokerCount;
    }
    if (!isValid) {
      return { valid: false, reason: 'Le carte non sono in sequenza!' };
    }
    // Max 2 cards added to existing scala
    const addedCount = newNonJokers.length + (newCards.some(c => c.isJoker) ? 1 : 0);
    if (addedCount > 2) {
      return { valid: false, reason: 'Puoi aggiungere massimo 2 carte a una scala!' };
    }
    const sorted = sortForTable(allCards);
    return { valid: true, newCards: sorted };
  }

  if (isTrisPoker) {
    const rank = existingNonJokers[0].rank;
    // All new non-joker cards must be same rank
    if (!newNonJokers.every(c => c.rank === rank)) {
      return { valid: false, reason: 'Le carte devono essere dello stesso valore!' };
    }
    // No duplicate suits
    const suits = allNonJokers.map(c => c.suit);
    if (new Set(suits).size !== suits.length) {
      return { valid: false, reason: 'Semi duplicati nel tris/poker!' };
    }
    // Max 4 cards (poker)
    if (allCards.length > 4) {
      return { valid: false, reason: 'Non puoi avere piu di 4 carte dello stesso valore!' };
    }
    // Only joker alone allowed if tris is complete
    if (newCards.length === 1 && newCards[0].isJoker) {
      // Check if adding joker makes sense (fills a missing suit)
      const missingSuits = SUITS.filter(s => !suits.includes(s));
      if (missingSuits.length === 0) {
        return { valid: false, reason: 'Gia tutte le 4 carte presenti!' };
      }
    }
    const sorted = sortForTable(allCards);
    return { valid: true, newCards: sorted };
  }

  // Mixed combo (full, doppia coppia) - check each new card fits a rank group
  const rankGroups = {};
  existingNonJokers.forEach(c => {
    if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
    rankGroups[c.rank].push(c);
  });

  for (const card of newNonJokers) {
    const group = rankGroups[card.rank];
    if (!group) return { valid: false, reason: card.rank + ' non corrisponde a nessun gruppo!' };
    const groupSuits = group.map(c => c.suit);
    if (groupSuits.includes(card.suit)) return { valid: false, reason: 'Seme duplicato nel gruppo!' };
    if (group.length >= 4) return { valid: false, reason: 'Gruppo gia completo!' };
  }

  // Joker alone on mixed combo
  if (newCards.length === 1 && newCards[0].isJoker && allJokers.length === 1) {
    return { valid: true, newCards: sortForTable(allCards) };
  }

  if (newNonJokers.length > 0) {
    return { valid: true, newCards: sortForTable(allCards) };
  }

  return { valid: false, reason: 'Combinazione non valida!' };
}

// ============================================================
// CHIUSURA IN MANO
// ============================================================

export function canChiuderInMano(cards) {
  if (!cards || cards.length === 0) return false;
  return tryGroupCards([...cards]);
}

function tryGroupCards(cards) {
  if (cards.length === 0) return true;
  if (cards.length < 2) return false;

  for (let size = 2; size <= cards.length; size++) {
    const combos = getCombinations(cards, size);
    for (const combo of combos) {
      if (isValidSingleGroupWithJoker(combo)) {
        const remaining = cards.filter(c => !combo.find(x => x.id === c.id));
        if (remaining.length === 0 || tryGroupCards(remaining)) return true;
      }
    }
  }
  return false;
}

function isValidSingleGroupWithJoker(cards) {
  const nonJokers = cards.filter(c => !c.isJoker);
  const jokerCount = cards.filter(c => c.isJoker).length;
  if (jokerCount > 1) return false;
  if (nonJokers.length === 0) return false;

  // Tris (with or without joker)
  if (cards.length === 3 && nonJokers.every(c => c.rank === nonJokers[0].rank)) {
    const suits = nonJokers.map(c => c.suit);
    return new Set(suits).size === suits.length;
  }

  // Poker (with or without joker)
  if (cards.length === 4 && nonJokers.every(c => c.rank === nonJokers[0].rank)) {
    const suits = nonJokers.map(c => c.suit);
    return new Set(suits).size === suits.length;
  }

  // Scala (with or without joker)
  if (nonJokers.every(c => c.suit === nonJokers[0].suit) && cards.length >= 3) {
    const orders = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
    if (new Set(orders).size !== orders.length) return false;
    let gaps = 0;
    for (let i = 1; i < orders.length; i++) gaps += orders[i] - orders[i - 1] - 1;
    return gaps <= jokerCount;
  }

  return false;
}

// ============================================================
// UTILITIES
// ============================================================

function getCombinations(arr, size) {
  if (size > arr.length) return [];
  if (size === arr.length) return [arr];
  if (size === 1) return arr.map(x => [x]);
  const result = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1);
    for (const combo of rest) result.push([arr[i], ...combo]);
  }
  return result;
}

export function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function comboHasJoker(combo) {
  if (!combo || !combo.cards) return false;
  return combo.cards.some(c => c.isJoker);
}
