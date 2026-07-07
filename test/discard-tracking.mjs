// Verifies the discard-tracking data the client relies on: server 'out'
// events carry a `revealed` array, and reconstructing per-value discard
// counts from the log never double-counts or exceeds the deck composition.
import { io } from 'socket.io-client';
import { CARD_META } from '../client/src/cards.js';

const URL = process.env.URL || 'http://localhost:3901';
const N = Number(process.env.PLAYERS || 4);

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

// Mirrors the client's discardsOfEvent() logic exactly.
function discardsOfEvent(e) {
  if (e.t === 'play') return [e.card];
  if (e.t === 'prince') return [e.discarded];
  if (e.t === 'out' && e.revealed && e.revealed.length) return e.revealed;
  return [];
}

function makeClient(name) {
  return new Promise((resolve) => {
    const socket = io(URL, { transports: ['websocket'], forceNew: true });
    const c = { socket, name, pid: null };
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
  let rounds = 0;
  let outEventsSeen = 0;
  let outEventsWithReveal = 0;
  let maxDiscardsSeen = 0;

  function auditLog(g) {
    // Reconstruct per-value discard totals purely from the log and compare
    // against the authoritative player.discard arrays (server ground truth).
    const fromLog = {};
    for (const e of g.log) {
      if (e.t === 'out') { outEventsSeen++; if (e.revealed && e.revealed.length) outEventsWithReveal++; }
      for (const v of discardsOfEvent(e)) fromLog[v] = (fromLog[v] || 0) + 1;
    }
    const fromPlayers = {};
    for (const p of g.players) for (const v of p.discard) fromPlayers[v] = (fromPlayers[v] || 0) + 1;

    for (let v = 1; v <= 8; v++) {
      const lg = fromLog[v] || 0;
      const pl = fromPlayers[v] || 0;
      maxDiscardsSeen = Math.max(maxDiscardsSeen, lg);
      if (lg !== pl) throw new Error(`MISMATCH value=${v}: log says ${lg} discarded, player.discard arrays say ${pl}`);
      if (lg > CARD_META[v].count) throw new Error(`OVERCOUNT value=${v}: log says ${lg} discarded but only ${CARD_META[v].count} exist`);
    }
  }

  for (const c of clients) {
    c.socket.on('state', async (payload) => {
      const g = payload.game;
      if (!g) return;
      if (g.phase === 'playing' || g.phase === 'roundEnd' || g.phase === 'gameOver') {
        try { auditLog(g); } catch (err) { fail(err); return; }
      }
      if (g.phase === 'gameOver') { done(g); return; }
      if (g.phase === 'roundEnd') {
        if (c === clients[0]) { rounds++; await emitP(c.socket, 'game:next'); }
        return;
      }
      if (g.phase === 'playing' && g.currentPlayerId === c.pid) {
        const mv = legalMove(g, c.pid);
        const r = await emitP(c.socket, 'game:play', mv);
        if (!r.ok) return fail(new Error('illegal move: ' + r.error));
      }
    });
  }

  const created = await emitP(clients[0].socket, 'room:create', { name: clients[0].name });
  clients[0].pid = created.playerId;
  const code = created.code;
  for (let i = 1; i < N; i++) {
    const j = await emitP(clients[i].socket, 'room:join', { code, name: clients[i].name });
    clients[i].pid = j.playerId;
  }
  const startRes = await emitP(clients[0].socket, 'game:start');
  if (!startRes.ok) throw new Error('start failed: ' + startRes.error);

  const timeout = setTimeout(() => fail(new Error('timeout')), 30000);
  const g = await finished;
  clearTimeout(timeout);

  console.log(`✔ match finished, ${rounds} round(s) played`);
  console.log(`✔ 'out' events: ${outEventsSeen} total, ${outEventsWithReveal} carried a revealed card`);
  console.log(`✔ max discards of any single value seen in one round: ${maxDiscardsSeen} (deck max is 5)`);
  console.log(`✔ per-value discard counts: log-reconstruction === player.discard arrays for every round, every value`);
  console.log(`✔ no value's discard count ever exceeded its deck composition`);

  clients.forEach((c) => c.socket.close());
  console.log('\nALL GOOD ✅');
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
