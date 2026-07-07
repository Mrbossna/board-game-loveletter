import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoveLetterGame } from './LoveLetterGame.js';
import { buildDeck, CARD_VALUE as V } from './cards.js';

function makeGame(n = 2) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: `p${i}`, name: `P${i}` });
  return new LoveLetterGame(players, { rng: () => 0 }); // deterministic-ish
}

// Force a controlled board: fixed hands, deck, current player.
function setBoard(g, { hands, deck = [], burn = 99, current = 0 }) {
  g.phase = 'playing';
  g.round = 1;
  g.log = [];
  g.roundResult = null;
  g.deck = deck.slice();
  g.burnCard = burn;
  g.asideOpen = [];
  g.currentIndex = current;
  hands.forEach((h, i) => {
    g.players[i].hand = h.slice();
    g.players[i].discard = [];
    g.players[i].alive = true;
    g.players[i].protected = false;
  });
}

test('deck has 16 cards with correct composition', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 16);
  const count = (v) => deck.filter((c) => c === v).length;
  assert.equal(count(V.GUARD), 5);
  assert.equal(count(V.PRIEST), 2);
  assert.equal(count(V.BARON), 2);
  assert.equal(count(V.HANDMAID), 2);
  assert.equal(count(V.PRINCE), 2);
  assert.equal(count(V.KING), 1);
  assert.equal(count(V.COUNTESS), 1);
  assert.equal(count(V.PRINCESS), 1);
});

test('2-player setup: burn 1, aside 3, deal 1 each -> deck 10', () => {
  const g = makeGame(2);
  g.startMatch();
  assert.equal(g.players.length, 2);
  assert.equal(g.asideOpen.length, 3);
  assert.equal(g.burnCard !== null, true);
  // current player has drawn -> 2 cards; other has 1
  const cur = g.currentPlayer();
  assert.equal(cur.hand.length, 2);
  // 16 - burn(1) - aside(3) - dealt(2) - drawn(1) = 9 left
  assert.equal(g.deck.length, 9);
  assert.equal(g.tokensToWin, 7);
});

test('4-player setup: burn 1, deal 1 each -> deck 11 (no aside)', () => {
  const g = makeGame(4);
  g.startMatch();
  assert.equal(g.asideOpen.length, 0);
  // 16 - burn(1) - dealt(4) - drawn(1) = 10
  assert.equal(g.deck.length, 10);
  assert.equal(g.tokensToWin, 4);
});

test('Countess must be played when holding King', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.COUNTESS, V.KING], [V.GUARD]] });
  const bad = g.playCard('p0', { card: V.KING, targetId: 'p1' });
  assert.equal(bad.ok, false);
  const good = g.playCard('p0', { card: V.COUNTESS });
  assert.equal(good.ok, true);
});

test('Countess must be played when holding Prince', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.COUNTESS, V.PRINCE], [V.GUARD]] });
  const bad = g.playCard('p0', { card: V.PRINCE, targetId: 'p1' });
  assert.equal(bad.ok, false);
});

test('Guard correct guess eliminates the target', () => {
  const g = makeGame(2);
  // p0 plays Guard guessing Priest; p1 holds Priest
  setBoard(g, { hands: [[V.GUARD, V.HANDMAID], [V.PRIEST]], deck: [V.BARON] });
  const r = g.playCard('p0', { card: V.GUARD, targetId: 'p1', guess: V.PRIEST });
  assert.equal(r.ok, true);
  assert.equal(g.players[1].alive, false);
  // only p0 left -> round won by survival
  assert.equal(g.roundResult.winnerIds[0], 'p0');
  assert.equal(g.players[0].tokens, 1);
});

test('Guard wrong guess does nothing', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.GUARD, V.HANDMAID], [V.PRIEST]], deck: [V.BARON, V.KING] });
  const r = g.playCard('p0', { card: V.GUARD, targetId: 'p1', guess: V.BARON });
  assert.equal(r.ok, true);
  assert.equal(g.players[1].alive, true);
});

test('Guard cannot guess Guard', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.GUARD, V.HANDMAID], [V.PRIEST]], deck: [V.BARON] });
  const r = g.playCard('p0', { card: V.GUARD, targetId: 'p1', guess: V.GUARD });
  assert.equal(r.ok, false);
});

test('Baron: lower card is eliminated', () => {
  const g = makeGame(2);
  // p0 keeps Priest(2), p1 has King(6) -> p0 loses
  setBoard(g, { hands: [[V.BARON, V.PRIEST], [V.KING]], deck: [V.GUARD] });
  const r = g.playCard('p0', { card: V.BARON, targetId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].alive, false);
  assert.equal(g.players[1].alive, true);
});

test('Baron tie: nobody eliminated', () => {
  const g = makeGame(3); // avoid instant round-end with 2p
  setBoard(g, { hands: [[V.BARON, V.PRIEST], [V.PRIEST], [V.GUARD]], deck: [V.GUARD, V.KING] });
  const r = g.playCard('p0', { card: V.BARON, targetId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].alive, true);
  assert.equal(g.players[1].alive, true);
});

test('Handmaid protects from being targeted', () => {
  const g = makeGame(3);
  // p1 protected; p0 plays Guard -> can only target p2
  setBoard(g, { hands: [[V.GUARD, V.PRIEST], [V.GUARD], [V.PRIEST]], deck: [V.KING, V.BARON] });
  g.players[1].protected = true;
  const bad = g.playCard('p0', { card: V.GUARD, targetId: 'p1', guess: V.GUARD });
  assert.equal(bad.ok, false); // p1 is protected -> illegal target
  const ok = g.playCard('p0', { card: V.GUARD, targetId: 'p2', guess: V.PRIEST });
  assert.equal(ok.ok, true);
  assert.equal(g.players[2].alive, false);
});

test('All others protected: card plays with no effect', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.GUARD, V.PRIEST], [V.PRINCESS]], deck: [V.KING, V.BARON] });
  g.players[1].protected = true;
  const r = g.playCard('p0', { card: V.GUARD, targetId: null, guess: V.PRINCESS });
  assert.equal(r.ok, true);
  assert.equal(g.players[1].alive, true); // untouched
});

test('Prince forces target to discard and redraw', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.PRINCE, V.GUARD], [V.PRIEST]], deck: [V.BARON] });
  const r = g.playCard('p0', { card: V.PRINCE, targetId: 'p1' });
  assert.equal(r.ok, true);
  // p1 discarded Priest, drew Baron
  assert.deepEqual(g.players[1].discard, [V.PRIEST]);
  assert.deepEqual(g.players[1].hand, [V.BARON]);
  assert.equal(g.players[1].alive, true);
});

test('Prince forcing Princess discard eliminates target', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.PRINCE, V.GUARD], [V.PRINCESS]], deck: [V.BARON] });
  const r = g.playCard('p0', { card: V.PRINCE, targetId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(g.players[1].alive, false);
});

test('Prince on empty deck draws the burn card', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.PRINCE, V.GUARD], [V.PRIEST]], deck: [], burn: V.KING });
  const r = g.playCard('p0', { card: V.PRINCE, targetId: 'p1' });
  assert.equal(r.ok, true);
  assert.deepEqual(g.players[1].hand, [V.KING]);
  // deck empty after the turn -> showdown
  assert.equal(g.phase !== 'playing' || g.roundResult !== null, true);
});

test('Playing the Princess eliminates yourself', () => {
  const g = makeGame(3);
  setBoard(g, { hands: [[V.PRINCESS, V.GUARD], [V.PRIEST], [V.BARON]], deck: [V.KING, V.HANDMAID] });
  const r = g.playCard('p0', { card: V.PRINCESS });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].alive, false);
});

test('King swaps hands between players', () => {
  const g = makeGame(3);
  setBoard(g, { hands: [[V.KING, V.GUARD], [V.PRINCESS], [V.BARON]], deck: [V.PRIEST, V.HANDMAID] });
  const r = g.playCard('p0', { card: V.KING, targetId: 'p1' });
  assert.equal(r.ok, true);
  assert.equal(g.players[0].hand[0], V.PRINCESS); // got p1's card
  assert.equal(g.players[1].hand[0], V.GUARD);    // got p0's remaining card
});

test('Showdown at empty deck: highest card wins the token', () => {
  const g = makeGame(2);
  // p0 will play Guard (wrong guess), deck then empty -> showdown between remaining hands
  setBoard(g, { hands: [[V.GUARD, V.KING], [V.PRINCESS]], deck: [] });
  const r = g.playCard('p0', { card: V.GUARD, targetId: 'p1', guess: V.BARON });
  assert.equal(r.ok, true);
  assert.equal(g.roundResult.reason, 'showdown');
  // p0 keeps King(6), p1 has Princess(8) -> p1 wins
  assert.deepEqual(g.roundResult.winnerIds, ['p1']);
  assert.equal(g.players[1].tokens, 1);
});

test('Match ends when a player reaches the token target', () => {
  const g = makeGame(2);
  g.tokensToWin = 1; // shorten
  setBoard(g, { hands: [[V.GUARD, V.HANDMAID], [V.PRIEST]], deck: [V.BARON] });
  g.playCard('p0', { card: V.GUARD, targetId: 'p1', guess: V.PRIEST });
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winnerId, 'p0');
});

test('serializeFor hides other players\' hands during play', () => {
  const g = makeGame(2);
  setBoard(g, { hands: [[V.GUARD, V.KING], [V.PRINCESS]], deck: [V.BARON, V.PRIEST] });
  const view = g.serializeFor('p0');
  const me = view.players.find((p) => p.id === 'p0');
  const other = view.players.find((p) => p.id === 'p1');
  assert.notEqual(me.hand, null);
  assert.equal(other.hand, null);
  assert.equal(other.handCount, 1);
});
