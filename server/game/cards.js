// Classic Love Letter — 16 card deck.
// Each card: value (also its strength), name, count, and short rule text.

export const CARD_VALUE = {
  GUARD: 1,
  PRIEST: 2,
  BARON: 3,
  HANDMAID: 4,
  PRINCE: 5,
  KING: 6,
  COUNTESS: 7,
  PRINCESS: 8,
};

// name is a stable key used by both server and client (for art + i18n).
export const CARDS = {
  1: { value: 1, key: 'guard',     name: 'Guard',     nameTh: 'ทหาร',     count: 5, needsTarget: true,  needsGuess: true,
       text: 'Guess another player\'s hand (not Guard). If correct, they are out.' },
  2: { value: 2, key: 'priest',    name: 'Priest',    nameTh: 'บาทหลวง',  count: 2, needsTarget: true,  needsGuess: false,
       text: 'Secretly look at another player\'s hand.' },
  3: { value: 3, key: 'baron',     name: 'Baron',     nameTh: 'ขุนนาง',   count: 2, needsTarget: true,  needsGuess: false,
       text: 'Compare hands with another player. Lower value is out.' },
  4: { value: 4, key: 'handmaid',  name: 'Handmaid',  nameTh: 'สาวใช้',   count: 2, needsTarget: false, needsGuess: false,
       text: 'You are protected until your next turn.' },
  5: { value: 5, key: 'prince',    name: 'Prince',    nameTh: 'เจ้าชาย',  count: 2, needsTarget: true,  needsGuess: false, canTargetSelf: true,
       text: 'Choose a player (or yourself). They discard and draw a new card.' },
  6: { value: 6, key: 'king',      name: 'King',      nameTh: 'ราชา',     count: 1, needsTarget: true,  needsGuess: false,
       text: 'Trade hands with another player.' },
  7: { value: 7, key: 'countess',  name: 'Countess',  nameTh: 'เคาน์เตส', count: 1, needsTarget: false, needsGuess: false,
       text: 'Must be discarded if you also hold the King or Prince.' },
  8: { value: 8, key: 'princess',  name: 'Princess',  nameTh: 'เจ้าหญิง', count: 1, needsTarget: false, needsGuess: false,
       text: 'If you discard this card for any reason, you are out.' },
};

export function buildDeck() {
  const deck = [];
  for (const v of Object.keys(CARDS)) {
    const c = CARDS[v];
    for (let i = 0; i < c.count; i++) deck.push(c.value);
  }
  return deck; // 16 cards
}

export function cardInfo(value) {
  return CARDS[value];
}
