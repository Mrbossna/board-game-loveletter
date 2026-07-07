// End-to-end test: two socket.io clients play a full match against a running
// server (default http://localhost:3000). Verifies rooms, turns, play, reveals,
// round advancement and match completion over the real network layer.
import { io } from 'socket.io-client';
import { CARD_META } from '../client/src/cards.js';

const URL = process.env.URL || 'http://localhost:3000';
const N = Number(process.env.PLAYERS || 2);

function legalMove(game, myId) {
  const meP = game.players.find((p) => p.id === myId);
  const hand = meP.hand;
  const holdsCountess = hand.includes(7);
  const holdsRoyalty = hand.includes(6) || hand.includes(5);
  let card;
  if (holdsCountess && holdsRoyalty) card = 7;
  else {
    const opts = hand.filter((c) => c !== 8);
    card = (opts.length ? opts : hand).slice().sort((a, b) => a - b)[0];
  }
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

function makeClient(name) {
  return new Promise((resolve) => {
    const socket = io(URL, { transports: ['websocket'], forceNew: true });
    const c = { socket, name, pid: null, state: null, nextedRound: -1 };
    socket.on('connect', () => resolve(c));
  });
}

function emitP(socket, ev, payload) {
  return new Promise((res) => socket.emit(ev, payload, (r) => res(r || {})));
}

async function main() {
  const clients = [];
  for (let i = 0; i < N; i++) clients.push(await makeClient('Bot' + i));

  let done, fail;
  const finished = new Promise((res, rej) => { done = res; fail = rej; });
  let moveCount = 0;

  for (const c of clients) {
    c.socket.on('state', async (payload) => {
      c.state = payload;
      const g = payload.game;
      if (!g) return;
      if (g.phase === 'gameOver') { done(g); return; }
      if (g.phase === 'roundEnd') {
        // one client advances the round
        if (c === clients[0] && c.nextedRound !== g.round) {
          c.nextedRound = g.round;
          await emitP(c.socket, 'game:next');
        }
        return;
      }
      if (g.phase === 'playing' && g.currentPlayerId === c.pid) {
        moveCount++;
        if (moveCount > 2000) return fail(new Error('move cap exceeded'));
        const mv = legalMove(g, c.pid);
        const r = await emitP(c.socket, 'game:play', mv);
        if (!r.ok) return fail(new Error('illegal move rejected: ' + r.error + ' :: ' + JSON.stringify(mv)));
      }
    });
    c.socket.on('reveal', () => {});
  }

  // create + join
  const created = await emitP(clients[0].socket, 'room:create', { name: clients[0].name });
  if (!created.ok) throw new Error('create failed');
  clients[0].pid = created.playerId;
  const code = created.code;
  for (let i = 1; i < N; i++) {
    const j = await emitP(clients[i].socket, 'room:join', { code, name: clients[i].name });
    if (!j.ok) throw new Error('join failed: ' + j.error);
    clients[i].pid = j.playerId;
  }

  const startRes = await emitP(clients[0].socket, 'game:start');
  if (!startRes.ok) throw new Error('start failed: ' + startRes.error);

  const timeout = setTimeout(() => fail(new Error('timeout — game did not finish')), 30000);
  const g = await finished;
  clearTimeout(timeout);

  console.log(`✔ match finished in ${moveCount} moves`);
  console.log(`✔ winner: ${g.players.find((p) => p.id === g.winnerId)?.name}`);
  console.log(`✔ final tokens: ${g.players.map((p) => p.name + '=' + p.tokens).join(', ')}`);
  if (g.phase !== 'gameOver' || !g.winnerId) throw new Error('no winner at end');
  if (!g.players.some((p) => p.tokens >= g.tokensToWin)) throw new Error('winner below token target');

  clients.forEach((c) => c.socket.close());
  console.log('\nALL GOOD ✅');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
