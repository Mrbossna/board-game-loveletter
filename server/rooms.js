import { customAlphabet } from 'nanoid';
import { LoveLetterGame } from './game/LoveLetterGame.js';
import { CARDS, CARD_VALUE } from './game/cards.js';

const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);
const makeId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

export class Room {
  constructor(code, { discordInstanceId = null } = {}) {
    this.code = code;
    this.discordInstanceId = discordInstanceId;
    this.players = []; // { id, name, socketId, connected }
    this.hostId = null;
    this.game = null;
    this.createdAt = Date.now();
    this.turnTimer = null;
  }

  get inGame() {
    return this.game && (this.game.phase === 'playing' || this.game.phase === 'roundEnd');
  }

  seated() {
    return this.players.filter((p) => !p.spectator);
  }

  addPlayer({ id, name, socketId, avatar }) {
    let player = this.players.find((p) => p.id === id);
    if (player) {
      player.socketId = socketId;
      player.connected = true;
      if (name) player.name = name;
      if (avatar) player.avatar = String(avatar).slice(0, 300);
    } else {
      // If a match is running, new arrivals are spectators until the match ends.
      const spectator = !!this.inGame && this.seated().length >= MIN_PLAYERS;
      player = {
        id: id || makeId(),
        name: (name || 'Player').slice(0, 16),
        socketId,
        connected: true,
        spectator,
        avatar: avatar ? String(avatar).slice(0, 300) : null,
      };
      this.players.push(player);
    }
    if (!this.hostId || !this.players.find((p) => p.id === this.hostId && p.connected)) {
      this.hostId = this.firstConnectedId() || player.id;
    }
    return player;
  }

  firstConnectedId() {
    const c = this.players.find((p) => p.connected);
    return c ? c.id : null;
  }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    if (this.hostId === id) this.hostId = this.firstConnectedId();
  }

  markDisconnected(socketId) {
    const p = this.players.find((x) => x.socketId === socketId);
    if (p) p.connected = false;
    // Hand host to another connected player if needed.
    if (p && this.hostId === p.id) {
      this.hostId = this.firstConnectedId() || this.hostId;
    }
    return p;
  }

  canStart() {
    const active = this.players.filter((p) => p.connected && !p.spectator);
    return !this.inGame && active.length >= MIN_PLAYERS && active.length <= MAX_PLAYERS;
  }

  startMatch() {
    const seat = this.players.filter((p) => p.connected).slice(0, MAX_PLAYERS);
    seat.forEach((p) => (p.spectator = false));
    // Everyone else becomes a spectator for this match.
    this.players.forEach((p) => { if (!seat.includes(p)) p.spectator = true; });
    this.game = new LoveLetterGame(seat.map((p) => ({ id: p.id, name: p.name })));
    this.game.startMatch();
  }

  nextRound() {
    if (this.game && this.game.phase === 'roundEnd') {
      this.game.startRound();
      return true;
    }
    return false;
  }

  isSeated(playerId) {
    return this.game && this.game.players.some((p) => p.id === playerId);
  }

  // Build the state view for a specific viewer.
  stateFor(viewerId) {
    const game = this.game ? this.game.serializeFor(viewerId) : null;
    // Overlay avatars (known to the room, not the engine) onto game players.
    if (game) {
      const byId = new Map(this.players.map((p) => [p.id, p]));
      for (const gp of game.players) {
        const rp = byId.get(gp.id);
        gp.avatar = rp ? rp.avatar || null : null;
      }
    }
    return {
      room: {
        code: this.code,
        hostId: this.hostId,
        maxPlayers: MAX_PLAYERS,
        minPlayers: MIN_PLAYERS,
        canStart: this.canStart(),
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.connected,
          isHost: p.id === this.hostId,
          spectator: !!p.spectator,
          avatar: p.avatar || null,
        })),
      },
      you: viewerId,
      isSpectator: !this.isSeated(viewerId),
      game,
    };
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();          // code -> Room
    this.byDiscordInstance = new Map(); // instanceId -> code
  }

  create({ discordInstanceId = null } = {}) {
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new Room(code, { discordInstanceId });
    this.rooms.set(code, room);
    if (discordInstanceId) this.byDiscordInstance.set(discordInstanceId, code);
    return room;
  }

  get(code) {
    return this.rooms.get((code || '').toUpperCase());
  }

  getOrCreateForDiscord(instanceId) {
    const existing = this.byDiscordInstance.get(instanceId);
    if (existing && this.rooms.has(existing)) return this.rooms.get(existing);
    return this.create({ discordInstanceId: instanceId });
  }

  destroy(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.discordInstanceId) this.byDiscordInstance.delete(room.discordInstanceId);
    this.rooms.delete(code);
  }

  // Remove empty rooms (no connected players) older than a grace period.
  sweep(graceMs = 5 * 60 * 1000) {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const anyConnected = room.players.some((p) => p.connected);
      if (!anyConnected && now - room.createdAt > graceMs) this.destroy(code);
    }
  }
}

// ---- Auto-play (fallback when a player is idle/disconnected) ----
// Chooses a legal move so the game never permanently stalls.
export function chooseAutoMove(game) {
  const actor = game.currentPlayer();
  if (!actor) return null;
  const hand = actor.hand;
  const holdsCountess = hand.includes(CARD_VALUE.COUNTESS);
  const holdsRoyalty = hand.includes(CARD_VALUE.KING) || hand.includes(CARD_VALUE.PRINCE);

  let card;
  if (holdsCountess && holdsRoyalty) {
    card = CARD_VALUE.COUNTESS; // forced
  } else {
    // Prefer not to self-destruct with the Princess; otherwise play the lower card.
    const options = hand.filter((c) => c !== CARD_VALUE.PRINCESS);
    const pool = options.length ? options : hand.slice();
    card = pool.sort((a, b) => a - b)[0];
  }

  const meta = CARDS[card];
  const move = { card };
  if (meta.needsTarget) {
    const targets = game.validTargets(meta, actor).filter((t) => t.id !== actor.id);
    const list = targets.length ? targets : game.validTargets(meta, actor);
    if (list.length) move.targetId = list[Math.floor(Math.random() * list.length)].id;
  }
  if (meta.needsGuess) {
    const guesses = [2, 3, 4, 5, 6, 7, 8];
    move.guess = guesses[Math.floor(Math.random() * guesses.length)];
  }
  return move;
}
