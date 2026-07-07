// A simple bot that joins a room by code and auto-plays legal moves.
// Usage: CODE=ABCD NAME=Bot node test/bot.mjs
import { io } from 'socket.io-client';
import { CARD_META } from '../client/src/cards.js';

const URL = process.env.URL || 'http://localhost:3000';
const CODE = process.env.CODE;
const NAME = process.env.NAME || 'Botto';

function legalMove(game, myId) {
  const meP = game.players.find((p) => p.id === myId);
  const hand = meP.hand;
  const holdsCountess = hand.includes(7);
  const holdsRoyalty = hand.includes(6) || hand.includes(5);
  let card;
  if (holdsCountess && holdsRoyalty) card = 7;
  else { const opts = hand.filter((c) => c !== 8); card = (opts.length ? opts : hand).slice().sort((a, b) => a - b)[0]; }
  const meta = CARD_META[card];
  const move = { card };
  if (meta.needsTarget) {
    let targets = game.players.filter((p) => p.alive && !p.protected && p.id !== myId).map((p) => p.id);
    if (card === 5) targets = [myId, ...targets];
    if (targets.length) move.targetId = targets[0];
  }
  if (meta.needsGuess) move.guess = [2, 3, 4, 5, 6, 7, 8][Math.floor(Math.random() * 7)];
  return move;
}

const socket = io(URL, { transports: ['websocket'], forceNew: true });
let pid = null;

socket.on('connect', () => {
  socket.emit('room:join', { code: CODE, name: NAME }, (r) => {
    if (!r.ok) { console.error('join failed', r.error); process.exit(1); }
    pid = r.playerId;
    console.log(`bot ${NAME} joined ${CODE} as ${pid}`);
  });
});

socket.on('state', (payload) => {
  const g = payload.game;
  if (!g || g.phase !== 'playing') return;
  if (g.currentPlayerId !== pid) return;
  setTimeout(() => {
    const mv = legalMove(g, pid);
    socket.emit('game:play', mv, (r) => { if (!r.ok) console.error('bot move rejected', r.error); });
  }, 600);
});
