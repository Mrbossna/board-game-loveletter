import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { RoomManager, chooseAutoMove, MIN_PLAYERS } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Load .env from the project root if present (Node >=20.6).
try {
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(ROOT, '.env'))) {
    process.loadEnvFile(path.join(ROOT, '.env'));
  }
} catch (err) {
  console.warn('could not load .env:', err.message);
}

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';

// Turn limits (ms). Auto-play kicks in so a match never stalls on an
// idle or disconnected player.
const TURN_MS_CONNECTED = 120_000;
const TURN_MS_DISCONNECTED = 8_000;

const app = express();
app.use(express.json());

// ---- Discord config for the client (client id is public) ----
app.get('/api/config', (_req, res) => {
  res.json({ discordClientId: DISCORD_CLIENT_ID });
});

// ---- Discord OAuth2 code -> access_token exchange ----
// Discord Activity flow: client authorize() -> code -> this endpoint -> token.
app.post('/api/token', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'missing code' });
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      return res.status(500).json({ error: 'server missing Discord credentials' });
    }
    const resp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('token exchange failed', err);
    res.status(500).json({ error: 'token exchange failed' });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: mgr.rooms.size }));

// ---- Proxy Discord CDN avatar images ----
// Inside a Discord Activity the strict CSP blocks direct
// <img src="https://cdn.discordapp.com/...">, so avatars silently fail to load.
// The client points avatars at this same-origin route instead (works in the
// Activity and on the standalone web). Only known avatar image paths are
// allowed — this is NOT an open proxy (guards against SSRF).
const AVATAR_PATH = /^(avatars\/\d{1,32}\/[A-Za-z0-9_]{1,64}\.(png|gif|webp|jpg)|embed\/avatars\/[0-9]{1,2}\.png)$/;
app.get('/dcdn/*', async (req, res) => {
  const rest = req.params[0] || '';
  if (!AVATAR_PATH.test(rest)) return res.status(404).end();
  const size = /^\d{1,4}$/.test(String(req.query.size || '')) ? `?size=${req.query.size}` : '';
  try {
    const upstream = await fetch(`https://cdn.discordapp.com/${rest}${size}`);
    if (!upstream.ok) return res.status(upstream.status).end();
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('avatar proxy failed:', err.message);
    res.status(502).end();
  }
});

// ---- Serve the built client (if present) ----
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.send('<h1>Love Letter</h1><p>Client not built yet. Run <code>npm run build</code>.</p>')
  );
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }, // just-for-fun; loosen CORS
  // Discord proxies the connection; default path /socket.io works through it.
});

const mgr = new RoomManager();
setInterval(() => mgr.sweep(), 60_000);

// ---- helpers ----
function socketByPlayer(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  return p && p.connected ? io.sockets.sockets.get(p.socketId) : null;
}

function broadcast(room) {
  for (const p of room.players) {
    if (!p.connected) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (!s) continue;
    const payload = room.stateFor(p.id);
    payload.turnDeadline = room.turnDeadline || null;
    s.emit('state', payload);
  }
}

function sendReveals(room, reveals = []) {
  for (const r of reveals) {
    const s = socketByPlayer(room, r.to);
    if (s) s.emit('reveal', r);
  }
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = null;
}

function scheduleTurn(room) {
  clearTurnTimer(room);
  const game = room.game;
  if (!game || game.phase !== 'playing') return;
  const current = game.currentPlayer();
  if (!current) return;
  const seat = room.players.find((p) => p.id === current.id);
  const connected = seat && seat.connected;
  const delay = connected ? TURN_MS_CONNECTED : TURN_MS_DISCONNECTED;
  room.turnDeadline = Date.now() + delay;
  room.turnTimer = setTimeout(() => autoPlay(room), delay);
}

function autoPlay(room) {
  const game = room.game;
  if (!game || game.phase !== 'playing') return;
  try {
    const move = chooseAutoMove(game);
    if (move) {
      const result = game.playCard(game.currentPlayer().id, move);
      if (result.ok) sendReveals(room, result.reveals);
    }
  } catch (err) {
    console.error('autoPlay error', err);
  }
  broadcast(room);
  scheduleTurn(room);
}

function afterAction(room, result) {
  if (result && result.reveals) sendReveals(room, result.reveals);
  broadcast(room);
  scheduleTurn(room);
}

// ---- socket handlers ----
io.on('connection', (socket) => {
  const ack = (cb, payload) => { if (typeof cb === 'function') cb(payload); };

  function joinRoom(room, name, playerId, cb, avatar) {
    const player = room.addPlayer({ id: playerId, name, socketId: socket.id, avatar });
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    ack(cb, { ok: true, code: room.code, playerId: player.id });
    broadcast(room);
  }

  socket.on('room:create', ({ name, playerId, avatar } = {}, cb) => {
    const room = mgr.create();
    joinRoom(room, name, playerId, cb, avatar);
  });

  socket.on('room:join', ({ code, name, playerId, avatar } = {}, cb) => {
    const room = mgr.get(code);
    if (!room) return ack(cb, { ok: false, error: 'Room not found.' });
    joinRoom(room, name, playerId, cb, avatar);
  });

  socket.on('room:joinDiscord', ({ instanceId, name, playerId, avatar } = {}, cb) => {
    if (!instanceId) return ack(cb, { ok: false, error: 'missing instanceId' });
    const room = mgr.getOrCreateForDiscord(instanceId);
    joinRoom(room, name, playerId, cb, avatar);
  });

  socket.on('room:leave', (_p, cb) => {
    const room = mgr.get(socket.data.roomCode);
    if (room) {
      room.removePlayer(socket.data.playerId);
      socket.leave(room.code);
      broadcast(room);
    }
    socket.data.roomCode = null;
    ack(cb, { ok: true });
  });

  socket.on('game:start', (_p, cb) => {
    const room = mgr.get(socket.data.roomCode);
    if (!room) return ack(cb, { ok: false, error: 'No room.' });
    if (room.hostId !== socket.data.playerId) return ack(cb, { ok: false, error: 'Only the host can start.' });
    if (!room.canStart()) return ack(cb, { ok: false, error: `Need ${MIN_PLAYERS}-4 players.` });
    room.startMatch();
    ack(cb, { ok: true });
    broadcast(room);
    scheduleTurn(room);
  });

  socket.on('game:play', ({ card, targetId, guess } = {}, cb) => {
    const room = mgr.get(socket.data.roomCode);
    if (!room || !room.game) return ack(cb, { ok: false, error: 'No game.' });
    const result = room.game.playCard(socket.data.playerId, { card, targetId, guess });
    if (!result.ok) return ack(cb, result);
    ack(cb, { ok: true });
    afterAction(room, result);
  });

  socket.on('game:next', (_p, cb) => {
    const room = mgr.get(socket.data.roomCode);
    if (!room) return ack(cb, { ok: false, error: 'No room.' });
    if (room.nextRound()) {
      ack(cb, { ok: true });
      broadcast(room);
      scheduleTurn(room);
    } else {
      ack(cb, { ok: false, error: 'Cannot start next round.' });
    }
  });

  socket.on('game:restart', (_p, cb) => {
    const room = mgr.get(socket.data.roomCode);
    if (!room) return ack(cb, { ok: false, error: 'No room.' });
    if (room.hostId !== socket.data.playerId) return ack(cb, { ok: false, error: 'Only the host can restart.' });
    if (!room.canStart() && !(room.game && room.game.phase === 'gameOver')) {
      return ack(cb, { ok: false, error: 'Cannot restart yet.' });
    }
    room.startMatch();
    ack(cb, { ok: true });
    broadcast(room);
    scheduleTurn(room);
  });

  socket.on('chat', ({ text } = {}) => {
    const room = mgr.get(socket.data.roomCode);
    if (!room || !text) return;
    const p = room.players.find((x) => x.id === socket.data.playerId);
    io.to(room.code).emit('chat', { from: p ? p.name : '?', text: String(text).slice(0, 200), ts: Date.now() });
  });

  socket.on('disconnect', () => {
    const room = mgr.get(socket.data.roomCode);
    if (!room) return;
    const p = room.markDisconnected(socket.id);
    // If they were only in the lobby (no match running), free the seat.
    if (p && !room.inGame) room.removePlayer(p.id);
    broadcast(room);
    // If the disconnected player is the current turn, shorten the timer.
    scheduleTurn(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Love Letter server on http://localhost:${PORT}`);
  if (!DISCORD_CLIENT_ID) console.log('(Discord disabled: set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET to enable Activity mode)');
});
