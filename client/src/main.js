import './styles.css';
import { CARD_META, CARD_ORDER, cardElement } from './cards.js';
import { connectSocket, emit } from './net.js';
import { initDiscord, isInsideDiscord, discordDisplayName, discordAvatarUrl, urlInstanceId } from './discord.js';
import { sfx, unlock as soundUnlock, isMuted, toggleMuted } from './sound.js';
import { groupEventsIntoTurns, describeTurn } from './fx.js';

const app = document.getElementById('app');
const GUESSABLE = [2, 3, 4, 5, 6, 7, 8];

// ---------------- client state ----------------
const S = {
  socket: null,
  playerId: sessionStorage.getItem('ll_pid') || null,
  name: localStorage.getItem('ll_name') || '',
  roomCode: sessionStorage.getItem('ll_room') || null,
  hasJoined: false,
  discord: null,
  discordInstanceId: null,
  avatar: '',           // Discord avatar URL (empty for standalone web)
  connecting: isInsideDiscord(),
  state: null,          // latest server 'state' payload
  pending: null,        // { card, target, guess }
  reveal: null,         // one-off private reveal
  logOpen: false,
  helpOpen: false,
  joinMode: false,
  lastCurrent: undefined,
  lastDeadline: null,
  turnWindow: 0,
  // sound bookkeeping
  sfxInit: false,
  sfxRound: 0,
  sfxLogLen: 0,
  sfxPhase: null,
  sfxCurrent: null,
  // action-animation queue
  fxQueue: [],
  fxRunning: false,
  // game-over celebration: while true, the winner fanfare plays full-screen and
  // the restart modal is withheld until it finishes.
  celebrating: false,
};

// Re-arm the sound baseline so the NEXT observed state is treated as a fresh
// start (no history replay). Call on every (re)join and on leaving a room.
function resetSfx() {
  S.sfxInit = false;
  S.sfxRound = 0;
  S.sfxLogLen = 0;
  S.sfxPhase = null;
  S.sfxCurrent = null;
  S.fxQueue = [];
  S.celebrating = false;
  removeGameOverCelebration();
}

// Trigger sound effects from server state transitions (no sound on the first
// observed state, so joining an in-progress game / reconnecting doesn't replay
// history).
function handleSounds(cur) {
  const g = cur && cur.game;
  if (!g) { S.sfxInit = false; return; }
  if (!S.sfxInit) {
    S.sfxInit = true;
    S.sfxRound = g.round;
    S.sfxLogLen = g.log.length;
    S.sfxPhase = g.phase;
    S.sfxCurrent = g.currentPlayerId;
    if (g.phase === 'playing') sfx.deal();
    return;
  }
  if (g.round !== S.sfxRound) { S.sfxRound = g.round; S.sfxLogLen = 0; sfx.deal(); }
  const newEvents = [];
  for (let i = S.sfxLogLen; i < g.log.length; i++) {
    const e = g.log[i];
    newEvents.push(e);
    if (e.t === 'play' || e.t === 'noTarget') sfx.play();
    else if (e.t === 'out') sfx.eliminate();
  }
  S.sfxLogLen = g.log.length;
  if (newEvents.length) enqueueTurnFx(newEvents);
  if (g.phase === 'playing' && g.currentPlayerId === S.playerId && S.sfxCurrent !== S.playerId) sfx.yourTurn();
  S.sfxCurrent = g.currentPlayerId;
  if (g.phase === 'roundEnd' && S.sfxPhase !== 'roundEnd') {
    const won = g.roundResult && g.roundResult.winnerIds.includes(S.playerId);
    if (won) sfx.roundWin();
  }
  if (g.phase === 'gameOver' && S.sfxPhase !== 'gameOver') {
    const seated = g.players.some((p) => p.id === S.playerId);
    // Winners and spectators hear the fanfare; only a seated loser hears "lose".
    if (g.winnerId === S.playerId || !seated) sfx.gameWin(); else sfx.lose();
    startGameOverCelebration(g); // long full-screen "who won" moment before restart
  }
  S.sfxPhase = g.phase;
}

// ---------------- action animations (FX) ----------------
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureFxLayer() {
  let l = document.getElementById('fxlayer');
  if (!l) { l = document.createElement('div'); l.id = 'fxlayer'; document.body.appendChild(l); }
  return l;
}

// Turn new log events into queued animations (one per turn).
function enqueueTurnFx(events) {
  const turns = groupEventsIntoTurns(events);
  for (const t of turns) {
    const desc = describeTurn(t, { nameOf, cardName });
    if (desc) S.fxQueue.push(desc);
  }
  // Coalesce backlog (fast auto-play): keep only the two most recent.
  if (S.fxQueue.length > 2) S.fxQueue = S.fxQueue.slice(-2);
  // flushFx() is invoked by the state handler after render().
}

// Center of a player's on-screen area (opponent seat, or my own hand).
function areaRectFor(playerId) {
  let el = null;
  if (playerId === S.playerId) el = document.querySelector('.myhand') || document.querySelector('.myarea');
  else el = document.querySelector(`.seat[data-id="${playerId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function screenCenter() { return { x: window.innerWidth / 2, y: window.innerHeight / 2 }; }

async function flushFx() {
  if (S.fxRunning) return;
  S.fxRunning = true;
  try {
    while (S.fxQueue.length) {
      const desc = S.fxQueue.shift();
      await animateFx(desc);
    }
  } finally {
    S.fxRunning = false;
  }
}

async function animateFx(desc) {
  const layer = ensureFxLayer();
  const from = areaRectFor(desc.actorId) || screenCenter();
  const to = desc.targetId ? (areaRectFor(desc.targetId) || screenCenter()) : from;
  const dur = reducedMotion ? 650 : 1500;

  // Caption banner — icon is our own emoji constant; the caption is set via
  // textContent so player-chosen names can never inject markup.
  const cap = document.createElement('div');
  cap.className = 'fx-caption';
  const ico = document.createElement('span');
  ico.className = 'fx-ico';
  ico.textContent = desc.icon || '🃏';
  const txt = document.createElement('span');
  txt.textContent = ' ' + desc.caption;
  cap.appendChild(ico); cap.appendChild(txt);
  layer.appendChild(cap);

  // Flying card from actor -> target (or a small rise for self/no-target)
  const cardEl = document.createElement('div');
  cardEl.className = 'fx-card';
  cardEl.innerHTML = cardHTML(desc.card, { small: true });
  cardEl.style.left = `${from.x}px`;
  cardEl.style.top = `${from.y}px`;
  layer.appendChild(cardEl);

  // Target highlight ring (placed at captured coords so re-renders don't disturb it)
  const ring = document.createElement('div');
  ring.className = 'fx-ring';
  ring.style.left = `${to.x}px`;
  ring.style.top = `${to.y}px`;

  await wait(30); // let initial position paint
  if (!reducedMotion) {
    const dx = to.x - from.x, dy = to.y - from.y;
    cardEl.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.72)`;
    cardEl.style.opacity = '0.15';
  } else {
    cardEl.style.transform = 'translate(-50%, -50%) scale(0.9)';
  }

  const travel = reducedMotion ? 200 : 620;
  await wait(travel);

  // Impact: ring + effect icon land on the target
  layer.appendChild(ring);
  if (desc.icon) {
    const badge = document.createElement('div');
    badge.className = 'fx-badge';
    badge.textContent = desc.icon;
    badge.style.left = `${to.x}px`;
    badge.style.top = `${to.y}px`;
    layer.appendChild(badge);
    setTimeout(() => badge.remove(), dur);
  }
  const outs = desc.outs || [];

  // Big centred ❌ for a Guard MISS — a wrong guess has no other visible
  // consequence, so this is the key "you missed" signal. A correct guess always
  // eliminates, so its ✅ rides inside the death banner below (no overlap). The
  // hit-without-elimination branch can't happen in normal play, but is handled
  // so the ✅ is never silently dropped.
  let bigEl = null;
  if (desc.bigMark === 'miss' || (desc.bigMark === 'hit' && !outs.length)) {
    bigEl = document.createElement('div');
    bigEl.className = `fx-bigmark fx-bigmark--${desc.bigMark}`;
    bigEl.textContent = desc.bigMark === 'hit' ? '✅' : '❌';
    layer.appendChild(bigEl);
  }

  // Elimination: a long, unmissable death announcement so everyone sees who's
  // out. A skull pops on the player's own seat, plus a centred banner naming
  // them that lingers well past the normal turn animation.
  const deathHold = outs.length ? (reducedMotion ? 1200 : 2600) : 0;
  let deathBanner = null;
  for (const outId of outs) {
    const oc = areaRectFor(outId) || to;
    const skull = document.createElement('div');
    skull.className = 'fx-skull';
    skull.textContent = '☠️';
    skull.style.left = `${oc.x}px`;
    skull.style.top = `${oc.y}px`;
    layer.appendChild(skull);
    setTimeout(() => skull.remove(), deathHold || dur);
  }
  if (deathHold) {
    deathBanner = document.createElement('div');
    deathBanner.className = 'fx-death';
    // A correct Guard guess folds its ✅ into the banner so hit + death read as
    // one centred moment instead of two overlapping overlays.
    if (desc.bigMark === 'hit') {
      const correct = document.createElement('div');
      correct.className = 'fx-death-correct';
      correct.textContent = '✅ ทายถูก!';
      deathBanner.appendChild(correct);
    }
    const dSkull = document.createElement('div');
    dSkull.className = 'fx-death-skull';
    dSkull.textContent = '☠️';
    const dName = document.createElement('div');
    dName.className = 'fx-death-name';
    // textContent — player names are untrusted and must never be treated as HTML.
    dName.textContent = `${outs.map((id) => nameOf(id)).join(', ')} ตกรอบ!`;
    deathBanner.appendChild(dSkull);
    deathBanner.appendChild(dName);
    layer.appendChild(deathBanner);
  }

  // Hold long enough for both the normal impact and any death announcement.
  await wait(Math.max(dur - travel, deathHold));
  cap.remove(); cardEl.remove(); ring.remove();
  if (bigEl) bigEl.remove();
  if (deathBanner) deathBanner.remove();
}

// ---------------- game-over celebration ----------------
// A long, full-screen "who won" fanfare shown once when the match ends, before
// the restart modal appears. Lives outside #app so re-renders don't disturb it.
let goCleanup = null;
function removeGameOverCelebration() {
  if (goCleanup) { goCleanup(); goCleanup = null; }
}
function startGameOverCelebration(g) {
  if (S.celebrating) return;
  S.celebrating = true;
  render(); // withhold the restart modal while the celebration plays
  const overlay = document.createElement('div');
  overlay.className = 'fx-gameover';
  const winner = g.winnerId ? nameOf(g.winnerId) : 'ไม่มีผู้ชนะ';
  const iWon = g.winnerId && g.winnerId === S.playerId;
  const colors = ['#d9b45b', '#8a1f3a', '#46b17b', '#6a7fa0', '#c4552d', '#7d5ba6', '#f4e9d6'];
  let confetti = '';
  if (!reducedMotion) {
    for (let i = 0; i < 46; i++) {
      const left = Math.random() * 100;
      const delay = (Math.random() * 1.2).toFixed(2);
      const fall = (2.6 + Math.random() * 2).toFixed(2);
      const rot = Math.floor(Math.random() * 360);
      const w = 6 + Math.floor(Math.random() * 8);
      confetti += `<i class="cf" style="left:${left.toFixed(1)}%;background:${colors[i % colors.length]};`
        + `animation-delay:${delay}s;animation-duration:${fall}s;width:${w}px;height:${(w * 1.6).toFixed(0)}px;`
        + `--cf-rot:${rot}deg"></i>`;
    }
  }
  // Static markup + esc() on the only dynamic value (winner name).
  overlay.innerHTML = `
    <div class="fx-go-confetti">${confetti}</div>
    <div class="fx-go-card">
      <div class="fx-go-crown">👑</div>
      <div class="fx-go-title">${iWon ? 'คุณชนะเกม!' : 'จบเกมแล้ว'}</div>
      <div class="fx-go-winner">${esc(winner)}</div>
      <div class="fx-go-sub">ผู้ชนะ • สะสมครบ ${g.tokensToWin} ตราแห่งใจ</div>
    </div>`;
  document.body.appendChild(overlay);

  const life = reducedMotion ? 1700 : 4600;
  const outT = setTimeout(() => overlay.classList.add('fx-go-out'), life);
  const doneT = setTimeout(() => { overlay.remove(); goCleanup = null; S.celebrating = false; render(); }, life + 550);
  // Cleanup hook so a restart/leave mid-celebration tears it down immediately.
  goCleanup = () => { clearTimeout(outT); clearTimeout(doneT); overlay.remove(); };
}

function persistIdentity() {
  if (S.playerId) sessionStorage.setItem('ll_pid', S.playerId);
  if (S.roomCode) sessionStorage.setItem('ll_room', S.roomCode);
  if (S.name) localStorage.setItem('ll_name', S.name);
}

// ---------------- helpers ----------------
const cardHTML = (v, opts) => cardElement(v, opts).outerHTML;
const cardName = (v) => (CARD_META[v] ? CARD_META[v].nameTh : '?');
const cardLabel = (v) => `${cardName(v)} (${v})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function me() {
  if (!S.state || !S.state.game) return null;
  return S.state.game.players.find((p) => p.id === S.playerId) || null;
}
function nameOf(id) {
  if (!S.state) return '??';
  const inGame = S.state.game && S.state.game.players.find((p) => p.id === id);
  if (inGame) return inGame.name;
  const inRoom = S.state.room.players.find((p) => p.id === id);
  return inRoom ? inRoom.name : '??';
}
function isMyTurn() {
  const g = S.state && S.state.game;
  return !!(g && g.phase === 'playing' && g.currentPlayerId === S.playerId && me());
}
function forcedCountess(hand) {
  return hand.includes(7) && (hand.includes(6) || hand.includes(5));
}
function validTargetIds(cardValue) {
  const g = S.state.game;
  const base = g.players.filter((p) => p.alive && !p.protected && p.id !== S.playerId).map((p) => p.id);
  if (cardValue === 5) return [S.playerId, ...base]; // Prince may target self
  return base;
}

function toast(msg, isErr = false) {
  if (isErr) sfx.error();
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------------- networking actions ----------------
async function afterJoin(res) {
  if (!res.ok) { toast(res.error || 'เข้าห้องไม่สำเร็จ', true); return false; }
  S.playerId = res.playerId;
  S.roomCode = res.code;
  S.hasJoined = true;
  persistIdentity();
  resetSfx(); // fresh baseline: the next state won't replay history sounds
  return true;
}
async function doCreate() { return afterJoin(await emit(S.socket, 'room:create', { name: S.name, playerId: S.playerId, avatar: S.avatar })); }
async function doJoin(code) { return afterJoin(await emit(S.socket, 'room:join', { code, name: S.name, playerId: S.playerId, avatar: S.avatar })); }
async function doJoinDiscord(instanceId) { return afterJoin(await emit(S.socket, 'room:joinDiscord', { instanceId, name: S.name, playerId: S.playerId, avatar: S.avatar })); }

async function doStart() { const r = await emit(S.socket, 'game:start'); if (!r.ok) toast(r.error, true); }
async function doNext() { const r = await emit(S.socket, 'game:next'); if (!r.ok) toast(r.error, true); }
async function doRestart() { const r = await emit(S.socket, 'game:restart'); if (!r.ok) toast(r.error, true); }
async function doLeave() {
  await emit(S.socket, 'room:leave');
  S.hasJoined = false; S.roomCode = null; S.state = null;
  sessionStorage.removeItem('ll_room');
  resetSfx();
  render();
}
async function doPlay() {
  if (!S.pending) return;
  const p = S.pending;
  const r = await emit(S.socket, 'game:play', { card: p.card, targetId: p.target || null, guess: p.guess || null });
  if (!r.ok) toast(r.error, true);
  S.pending = null;
}

// ---------------- render ----------------
function render() {
  if (!S.state) {
    app.innerHTML = S.connecting ? loadingScreen() : homeScreen();
    return;
  }
  if (!S.state.game) { app.innerHTML = lobbyScreen(); return; }
  app.innerHTML = tableScreen();
  const feed = document.querySelector('.logfeed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

function loadingScreen() {
  return `<div class="screen"><div class="brand"><div class="heart">💌</div><h1>Love Letter</h1>
    <div class="sub">กำลังเชื่อมต่อ Discord…</div></div></div>`;
}

function homeScreen() {
  return `<div class="screen">
    <div class="brand">
      <div class="heart">💌</div>
      <h1>Love Letter</h1>
      <div class="sub">A Game of Risk &amp; Deduction</div>
    </div>
    <div class="panel">
      <div class="field">
        <label>ชื่อของคุณ</label>
        <input id="nameInput" type="text" maxlength="16" placeholder="ใส่ชื่อเล่น" value="${esc(S.name)}" />
      </div>
      ${S.joinMode ? `
        <div class="field">
          <label>รหัสห้อง</label>
          <input id="codeInput" class="code-input" type="text" maxlength="4" placeholder="ABCD" />
        </div>
        <div class="row">
          <button class="btn btn--ghost" data-action="back-home">ย้อนกลับ</button>
          <button class="btn" data-action="join-submit">เข้าห้อง</button>
        </div>
      ` : `
        <button class="btn" data-action="create">สร้างห้องใหม่</button>
        <div class="divider">หรือ</div>
        <button class="btn btn--ghost" data-action="join-mode">เข้าร่วมด้วยรหัส</button>
      `}
      <div class="row" style="align-items:center;justify-content:center;gap:1.2rem">
        <button class="linkish" data-action="help-open">วิธีเล่น &amp; การ์ดทั้งหมด</button>
        <button class="linkish" data-action="toggle-sound">${isMuted() ? '🔇 เสียง: ปิด' : '🔊 เสียง: เปิด'}</button>
      </div>
    </div>
    <div class="footer-note">รองรับมือถือ &amp; คอม • เล่นเป็น Discord Activity ได้</div>
    ${S.helpOpen ? helpModal() : ''}
  </div>`;
}

function lobbyScreen() {
  const room = S.state.room;
  const isHost = room.hostId === S.playerId;
  const seated = room.players.filter((p) => !p.spectator);
  return `<div class="screen">
    <div class="brand"><h1>ห้องรอเล่น</h1></div>
    <div>แชร์รหัสนี้ให้เพื่อน</div>
    <div class="lobby-code">${esc(room.code)}</div>
    <div class="players-list">
      ${room.players.map((p) => playerRow(p, room.hostId)).join('')}
    </div>
    <div class="hint">ผู้เล่น ${seated.length}/${room.maxPlayers} • ต้องมีอย่างน้อย ${room.minPlayers} คน</div>
    <div class="row" style="width:min(440px,94vw)">
      <button class="btn btn--ghost" data-action="leave">ออกจากห้อง</button>
      ${isHost
        ? `<button class="btn" data-action="start" ${room.canStart ? '' : 'disabled'}>เริ่มเกม</button>`
        : `<button class="btn" disabled>รอหัวหน้าเริ่ม…</button>`}
    </div>
    <button class="linkish" data-action="help-open">วิธีเล่น &amp; การ์ดทั้งหมด</button>
    ${S.helpOpen ? helpModal() : ''}
  </div>`;
}

// Inner content for an .avatar circle: the Discord photo (with graceful
// fallback to the name initial if it fails to load / is blocked), else letter.
function avatarInner(p) {
  const initial = ((p && p.name) || '?').trim().charAt(0).toUpperCase() || '?';
  const letter = `<span class="av-letter">${esc(initial)}</span>`;
  if (p && p.avatar) {
    return `${letter}<img class="av-img" src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
  }
  return letter;
}

function playerRow(p, hostId) {
  return `<div class="player-row ${p.connected ? '' : 'disc'}">
    <div class="avatar">${avatarInner(p)}</div>
    <div class="nm">${esc(p.name)}${p.id === S.playerId ? ' <span style="color:var(--text-dim)">(คุณ)</span>' : ''}</div>
    ${p.id === hostId ? '<span class="tag tag--host">หัวหน้า</span>' : ''}
    ${p.spectator ? '<span class="tag tag--spec">ผู้ชม</span>' : ''}
  </div>`;
}

function tableScreen() {
  const g = S.state.game;
  const meP = me();
  const opponents = g.players.filter((p) => p.id !== S.playerId);
  const latest = g.log.length ? logText(g.log[g.log.length - 1], g.log.length - 1, g.log) : '';

  return `<div class="table">
    <div class="topbar">
      <span class="rcode">${esc(S.state.room.code)}</span>
      <span class="mid ticker">${latest}</span>
      <div class="topbar-actions">
        <button class="iconbtn" data-action="toggle-sound" title="เสียง">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="iconbtn" data-action="help-open" title="คำอธิบายการ์ด">ℹ️<span class="lbl"> การ์ด</span></button>
        <button class="iconbtn" data-action="toggle-log" title="บันทึกการเล่น">📜</button>
      </div>
    </div>

    <div class="opponents">
      ${opponents.map((p) => seatHTML(p)).join('')}
    </div>

    ${centerHTML()}

    ${meP ? myAreaHTML(meP) : `<div class="hint">คุณกำลังดูอยู่ (ผู้ชม) — รอบหน้าจะได้ร่วมเล่น</div>`}

    ${S.reveal ? revealModal() : ''}
    ${g.phase === 'roundEnd' ? roundEndModal() : ''}
    ${g.phase === 'gameOver' && !S.celebrating ? gameOverModal() : ''}
    ${logPanel()}
    ${S.helpOpen ? helpModal() : ''}
  </div>`;
}

function seatHTML(p) {
  const g = S.state.game;
  const canTarget = !!S.pending && CARD_META[S.pending.card]?.needsTarget && validTargetIds(S.pending.card).includes(p.id);
  const selected = S.pending && S.pending.target === p.id;
  const tokens = tokenPips(p.tokens);
  const showCard = p.hand && p.hand.length ? p.hand : null;
  const handMini = p.alive
    ? (showCard
        ? showCard.map((v) => cardHTML(v, { small: true })).join('')
        : Array.from({ length: p.handCount }).map(() => cardHTML(null, { small: true, faceDown: true })).join(''))
    : '';
  const lastDiscard = p.discard.length ? p.discard[p.discard.length - 1] : null;
  return `<div class="seat ${p.isCurrent ? 'current' : ''} ${p.alive ? '' : 'out'} ${canTarget ? 'selectable' : ''} ${selected ? 'selectable' : ''} ${p.protected ? 'shielded' : ''}"
       data-action="${canTarget ? 'select-seat' : ''}" data-id="${p.id}">
    ${p.protected ? '<div class="shield" title="ได้รับการป้องกัน (การ์ดสาวใช้)">🛡️</div>' : ''}
    <div class="avatar">${avatarInner(p)}</div>
    <div class="nm">${esc(p.name)}${p.connected ? '' : ' ⚠'}</div>
    <div class="tokens">${tokens}</div>
    <div class="hand-mini">${handMini || (p.alive ? '' : '☠')}</div>
    <div class="discard-mini">${lastDiscard ? cardHTML(lastDiscard, { small: true }) : ''}</div>
  </div>`;
}

function tokenPips(n) {
  const need = S.state.game.tokensToWin;
  let out = '';
  for (let i = 0; i < need; i++) out += `<span class="pip ${i < n ? '' : 'empty'}"></span>`;
  return out;
}

function centerHTML() {
  const g = S.state.game;
  const turnName = g.currentPlayerId ? nameOf(g.currentPlayerId) : '';
  const mine = isMyTurn();
  const banner = g.phase === 'playing'
    ? (mine ? 'ถึงตาคุณ!' : `ถึงตา ${esc(turnName)}`)
    : '';
  const aside = g.asideOpen && g.asideOpen.length
    ? `<div class="aside">${g.asideOpen.map((v) => cardHTML(v, { small: true })).join('')}</div>` : '';
  return `<div class="center">
    <div class="turn-banner ${mine ? 'you' : ''}">${banner}</div>
    <div class="deck-area">
      <div class="deck-stack">
        ${cardHTML(null, { faceDown: true })}
        <div class="deck-count">${g.deckCount}</div>
      </div>
      ${aside}
      ${lastDiscardBlock(g.log)}
    </div>
    ${g.phase === 'playing' && S.state.turnDeadline ? `<div class="timer-bar"><div class="timer-fill" style="width:100%"></div></div>` : ''}
    <div class="hint">${escSafeHint()}</div>
  </div>`;
}

function escSafeHint() {
  if (!isMyTurn()) return `รอบที่ ${S.state.game.round} • เล่นให้ถึง ${S.state.game.tokensToWin} ตราเพื่อชนะ`;
  if (!S.pending) return 'แตะการ์ดที่ต้องการเล่น';
  const meta = CARD_META[S.pending.card];
  if (meta.needsTarget && validTargetIds(S.pending.card).length && !S.pending.target) return 'เลือกเป้าหมาย';
  if (meta.needsGuess && !S.pending.guess) return 'เลือกการ์ดที่จะทาย';
  return 'กด "เล่นการ์ด" เพื่อยืนยัน';
}

function myAreaHTML(meP) {
  const mine = isMyTurn();
  const forced = forcedCountess(meP.hand);
  const cards = meP.hand.map((v) => {
    const selected = S.pending && S.pending.card === v && mine;
    const disabled = mine && forced && v !== 7; // must play Countess
    return cardElementString(v, { selected, disabled, playable: mine });
  }).join('');

  return `<div class="myarea ${meP.protected ? 'shielded' : ''}">
    ${mine ? actionBar(meP) : ''}
    <div class="myhead">
      <span class="nm">${esc(meP.name)} (คุณ)</span>
      <div class="tokens">${tokenPips(meP.tokens)}</div>
      ${meP.protected ? '<span title="ป้องกันอยู่ (การ์ดสาวใช้)">🛡️ ป้องกันอยู่</span>' : ''}
      ${!meP.alive ? '<span>☠ ตกรอบแล้ว</span>' : ''}
    </div>
    <div class="myhand ${mine ? 'playable' : ''}">${cards}</div>
  </div>`;
}

function cardElementString(v, { selected, disabled, playable }) {
  const el = cardElement(v);
  if (selected) el.classList.add('selected');
  if (disabled) el.classList.add('disabled');
  if (playable && !disabled) { el.dataset.action = 'select-card'; el.dataset.value = String(v); }
  return el.outerHTML;
}

function targetButtonHTML(id) {
  const p = S.state.game.players.find((x) => x.id === id);
  const label = id === S.playerId ? 'ตัวเอง' : nameOf(id);
  const sel = S.pending.target === id ? 'sel' : '';
  return `<button class="target-btn ${sel}" data-action="select-seat" data-id="${id}">
    <span class="avatar av-xl">${avatarInner(p || { name: label })}</span>
    <span class="tb-name">${esc(label)}</span>
    ${sel ? '<span class="tb-check">✓</span>' : ''}
  </button>`;
}

// A one-line summary of the pending action, shown just above the confirm button
// so it's crystal-clear what "เล่นการ์ด" is about to do.
function playSummary(meta, targets) {
  const p = S.pending;
  if (meta.needsGuess && targets.length) {
    if (p.target && p.guess) return `จะทาย <b>${esc(nameOf(p.target))}</b> ถือ <b>${esc(cardName(p.guess))} (${p.guess})</b>`;
    return '';
  }
  if (meta.needsTarget && targets.length && p.target) {
    const who = p.target === S.playerId ? 'ตัวเอง' : nameOf(p.target);
    return `เป้าหมาย: <b>${esc(who)}</b>`;
  }
  return '';
}

function guessCardHTML(v) {
  const sel = S.pending.guess === v ? 'sel' : '';
  return `<button class="guess-card ${sel}" data-action="select-guess" data-value="${v}">
    ${cardHTML(v, { small: true })}
    <span class="gc-label"><b>${v}</b> ${cardName(v)}</span>
  </button>`;
}

function actionBar(meP) {
  if (!S.pending) return '';
  const meta = CARD_META[S.pending.card];
  const targets = validTargetIds(S.pending.card);
  const twoStep = meta.needsGuess; // Guard: pick target, then guess

  let inner = `<div class="ability-head">
      <div class="ability-mini">${cardHTML(S.pending.card, { small: true })}</div>
      <div class="ability-text">
        <div class="ability-title">${cardName(S.pending.card)} <span class="ability-val">(${S.pending.card})</span></div>
        <div class="ability-desc">${meta.textTh}</div>
      </div>
    </div>`;

  if (meta.needsTarget && targets.length) {
    if (twoStep && S.pending.target) {
      // Guard, target already picked: collapse the picker into a compact chip
      // so the guess grid takes the spotlight. Tap "เปลี่ยน" to reselect.
      const tp = S.state.game.players.find((x) => x.id === S.pending.target);
      inner += `<div class="chosen-target">
          <span class="ct-check">✓</span>
          <span class="avatar av-sm">${avatarInner(tp || { name: nameOf(S.pending.target) })}</span>
          <span class="ct-name">สู้กับ <b>${esc(nameOf(S.pending.target))}</b></span>
          <button class="ct-change" data-action="clear-target">เปลี่ยน</button>
        </div>`;
    } else {
      const done = S.pending.target ? 'done' : '';
      inner += `<div class="step">
          <div class="step-label ${done}">${twoStep ? '<span class="step-no">1</span>' : ''}<span class="sl-text">เลือก${twoStep ? 'คนที่จะสู้ด้วย' : 'เป้าหมาย'}</span></div>
          <div class="target-row">${targets.map(targetButtonHTML).join('')}</div>
        </div>`;
    }
  }
  if (meta.needsGuess) {
    const done = S.pending.guess ? 'done' : '';
    const who = S.pending.target
      ? `เดาว่า <b>${esc(nameOf(S.pending.target))}</b> ถือการ์ดอะไร`
      : 'เดาว่าเขาถือการ์ดอะไร';
    inner += `<div class="step">
        <div class="step-label ${done}"><span class="step-no">2</span><span class="sl-text">${who} <span class="step-hint">(ห้ามทายทหาร)</span></span></div>
        <div class="guess-row">${GUESSABLE.map(guessCardHTML).join('')}</div>
      </div>`;
  }

  const ready = playReady(meta, targets);
  const summary = playSummary(meta, targets);
  // Summary + confirm live in a sticky footer so the main action stays reachable
  // even when the guess grid makes the panel scroll on short screens.
  inner += `<div class="action-footer">
      ${summary ? `<div class="play-summary">${summary}</div>` : ''}
      <div class="row action-confirm">
        <button class="btn btn--ghost btn--sm" data-action="cancel-play">ยกเลิก</button>
        <button class="btn" data-action="confirm-play" ${ready ? '' : 'disabled'}>เล่นการ์ด</button>
      </div>
    </div>`;
  return `<div class="panel action-panel">${inner}</div>`;
}

function playReady(meta, targets) {
  if (meta.needsTarget && targets.length && !S.pending.target) return false;
  if (meta.needsGuess && targets.length && !S.pending.guess) return false;
  return true;
}

// A small always-visible card next to the deck showing the most recent
// discard across all players (or an empty placeholder before anyone has).
function lastDiscardBlock(log) {
  const info = lastDiscardInfo(log);
  if (!info) {
    return `<div class="last-discard"><span class="cap">ล่าสุดทิ้ง</span><div class="ld-empty">—</div></div>`;
  }
  const who = info.mode === 'reveal' ? `เปิดจาก ${esc(nameOf(info.ownerId))}` : `โดย ${esc(nameOf(info.ownerId))}`;
  return `<div class="last-discard">
    <span class="cap">ล่าสุดทิ้ง</span>
    ${cardHTML(info.value, { small: true })}
    <span class="ld-who">${who}</span>
  </div>`;
}

// ---------------- modals ----------------
function revealModal() {
  const r = S.reveal;
  let body = '';
  if (r.kind === 'priest') {
    body = `<p>${esc(nameOf(r.target))} ถือการ์ด:</p><div class="reveal-cards">${cardHTML(r.card)}</div>`;
  } else if (r.kind === 'baron') {
    const res = r.result === 'tie' ? 'เสมอ — ไม่มีใครตกรอบ' : (r.result === 'actor' ? 'คุณชนะ! คู่ต่อสู้ตกรอบ' : 'คุณแพ้ — คุณตกรอบ');
    body = `<div class="reveal-cards">
      <div class="reveal-item"><span class="cap">คุณ</span>${cardHTML(r.yourCard)}</div>
      <div class="reveal-item"><span class="cap">${esc(nameOf(r.target))}</span>${cardHTML(r.theirCard)}</div>
    </div><p>${res}</p>`;
  } else if (r.kind === 'king') {
    body = `<p>คุณสลับการ์ดกับ ${esc(nameOf(r.target))} และได้รับ:</p><div class="reveal-cards">${cardHTML(r.card)}</div>`;
  }
  return `<div class="overlay"><div class="modal"><h2>👁️ ข้อมูลลับ</h2>${body}
    <button class="btn" data-action="close-reveal">รับทราบ</button></div></div>`;
}

function roundEndModal() {
  const g = S.state.game;
  const rr = g.roundResult || { winnerIds: [] };
  const winners = rr.winnerIds.map(nameOf).join(', ') || 'ไม่มีผู้ชนะ';
  const reveal = (rr.reveal || []).map((x) =>
    `<div class="reveal-item"><span class="cap">${esc(nameOf(x.id))}</span>${x.card ? cardHTML(x.card, { small: true }) : ''}</div>`).join('');
  return `<div class="overlay"><div class="modal">
    <h2>🏆 จบรอบที่ ${g.round}</h2>
    <p><b style="color:var(--gold)">${esc(winners)}</b> ได้รับตราแห่งใจ</p>
    ${rr.reason === 'showdown' && reveal ? `<div class="reveal-cards">${reveal}</div>` : ''}
    <button class="btn" data-action="next-round">รอบต่อไป</button>
  </div></div>`;
}

function gameOverModal() {
  const g = S.state.game;
  const isHost = S.state.room.hostId === S.playerId;
  return `<div class="overlay"><div class="modal">
    <div class="heart" style="font-size:3rem">👑</div>
    <h2>${esc(nameOf(g.winnerId))} ชนะเกม!</h2>
    <p>สะสมครบ ${g.tokensToWin} ตราแห่งใจ</p>
    ${isHost
      ? `<button class="btn" data-action="restart">เล่นอีกครั้ง</button>`
      : `<button class="btn" disabled>รอหัวหน้าเริ่มเกมใหม่…</button>`}
    <button class="btn btn--ghost btn--sm" data-action="leave">ออกจากห้อง</button>
  </div></div>`;
}

function logPanel() {
  const g = S.state.game;
  const lines = g.log.map((e, i) => {
    const big = e.t === 'roundWin' || e.t === 'gameOver';
    return `<div class="logline ${big ? 'big' : ''}">${logText(e, i, g.log)}</div>`;
  }).join('');
  return `<div class="logpanel ${S.logOpen ? 'open' : ''}">
    <header><h3>บันทึกการเล่น</h3><button class="iconbtn" data-action="close-log">✕</button></header>
    <div class="logfeed">${lines}</div>
  </div>`;
}

// ---------------- discard tracking (card counting) ----------------
// Card values a log entry actually removed from a hand into a discard pile,
// in the order they left. 'noTarget' is intentionally excluded: the very next
// 'play' entry already records that same discard, so counting both would
// double-count it.
function discardsOfEvent(e) {
  if (e.t === 'play') return [e.card];
  if (e.t === 'prince') return [e.discarded];
  if (e.t === 'out' && e.revealed && e.revealed.length) return e.revealed;
  return [];
}

function totalOfValue(value) {
  return CARD_META[value] ? CARD_META[value].count : 0;
}

// How many copies of `value` had been discarded by the time log[idx] resolved.
function discardedCountUpTo(log, idx, value) {
  let n = 0;
  for (let i = 0; i <= idx; i++) {
    for (const v of discardsOfEvent(log[i])) if (v === value) n++;
  }
  return n;
}

// How many of `value` are still unaccounted for (deck/burn/hands) as of log[idx].
function remainingAt(log, idx, value) {
  return totalOfValue(value) - discardedCountUpTo(log, idx, value);
}

// The single most recent discard across all players this round, or null.
function lastDiscardInfo(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const vals = discardsOfEvent(log[i]);
    if (!vals.length) continue;
    const value = vals[vals.length - 1];
    const e = log[i];
    if (e.t === 'play') return { value, idx: i, ownerId: e.a, mode: 'play' };
    if (e.t === 'prince') return { value, idx: i, ownerId: e.target, mode: 'prince' };
    if (e.t === 'out') return { value, idx: i, ownerId: e.p, mode: 'reveal' };
  }
  return null;
}

function logText(e, idx = 0, log = [e]) {
  const nm = (id) => `<span class="actor">${esc(nameOf(id))}</span>`;
  const remainTag = (v) => ` <span class="remain">(เหลือ ${remainingAt(log, idx, v)}/${totalOfValue(v)})</span>`;
  switch (e.t) {
    case 'play': return `${nm(e.a)} เล่น ${cardLabel(e.card)}${remainTag(e.card)}`;
    case 'noTarget': return `${nm(e.a)} เล่น ${cardLabel(e.card)} (ไม่มีเป้าหมาย)`;
    case 'guard': return `↳ ทายว่า ${nm(e.target)} ถือ ${cardLabel(e.guess)} — ${e.hit ? 'ถูก! ตกรอบ' : 'พลาด'}`;
    case 'priest': return `↳ แอบดูมือของ ${nm(e.target)}`;
    case 'baron': {
      const r = e.result === 'tie' ? 'เสมอ' : (e.result === 'actor' ? `${nameOf(e.target)} แพ้` : `${nameOf(e.a)} แพ้`);
      return `↳ ดวลการ์ดกับ ${nm(e.target)} — ${r}`;
    }
    case 'handmaid': return `↳ ได้รับการป้องกัน`;
    case 'prince': return `↳ บังคับ ${nm(e.target)} ทิ้ง ${cardLabel(e.discarded)} แล้วจั่วใหม่${remainTag(e.discarded)}`;
    case 'king': return `↳ สลับการ์ดกับ ${nm(e.target)}`;
    case 'countess': return `↳ (ไม่มีผล)`;
    case 'princess': return `↳ ทิ้งเจ้าหญิง!`;
    case 'out': {
      let s = `☠ ${nm(e.p)} ตกรอบ`;
      if (e.revealed && e.revealed.length) {
        const v = e.revealed[0];
        s += ` — เปิดไพ่ ${cardLabel(v)}${remainTag(v)}`;
      }
      return s;
    }
    case 'roundWin': return `🏆 จบรอบ — ${e.winners.map((w) => nameOf(w)).join(', ') || 'ไม่มีผู้ชนะ'} ได้รับตรา`;
    case 'gameOver': return `👑 ${nameOf(e.winner)} ชนะเกม!`;
    default: return '';
  }
}

function helpModal() {
  const rows = CARD_ORDER.map((v) => {
    const m = CARD_META[v];
    return `<div class="help-row">
      ${cardHTML(v, { small: true })}
      <div class="htxt"><b>${m.nameTh} · ${v}</b> <span class="cnt">(${m.count} ใบ)</span><br><span>${m.textTh}</span></div>
    </div>`;
  }).join('');
  return `<div class="overlay"><div class="modal">
    <h2>คำอธิบายการ์ด</h2>
    <p style="font-size:0.9rem;color:var(--text-dim)">แต่ละเทิร์นจั่ว 1 ใบ (มี 2 ใบ) แล้วเลือกทิ้ง 1 ใบทำตามผล — เป็นคนสุดท้ายที่เหลือ หรือถือแต้มสูงสุดตอนกองหมด = ชนะรอบ</p>
    <div class="help-list">${rows}</div>
    <button class="btn" data-action="help-close">ปิด</button>
  </div></div>`;
}

// ---------------- interactions (event delegation) ----------------
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  soundUnlock(); // this click is a user gesture -> allowed to start audio
  if (action) sfx[action === 'select-card' ? 'select' : 'ui']();
  const nameInput = document.getElementById('nameInput');
  if (nameInput) { S.name = nameInput.value.trim().slice(0, 16); persistIdentity(); }

  switch (action) {
    case 'toggle-sound': { const m = toggleMuted(); if (!m) sfx.ui(); render(); break; }
    case 'create': if (!requireName()) return; await doCreate(); break;
    case 'join-mode': S.joinMode = true; render(); break;
    case 'back-home': S.joinMode = false; render(); break;
    case 'join-submit': {
      if (!requireName()) return;
      const code = (document.getElementById('codeInput')?.value || '').trim().toUpperCase();
      if (code.length < 4) { toast('กรอกรหัสห้อง 4 ตัว', true); return; }
      await doJoin(code);
      break;
    }
    case 'leave': await doLeave(); break;
    case 'start': await doStart(); break;
    case 'next-round': await doNext(); break;
    case 'restart': await doRestart(); break;
    case 'toggle-log': S.logOpen = !S.logOpen; render(); break;
    case 'close-log': S.logOpen = false; render(); break;
    case 'help-open': S.helpOpen = true; render(); break;
    case 'help-close': S.helpOpen = false; render(); break;
    case 'close-reveal': S.reveal = null; render(); break;
    case 'select-card': {
      if (!isMyTurn()) return;
      const v = Number(t.dataset.value);
      if (forcedCountess(me().hand) && v !== 7) { toast('ต้องเล่นเคาน์เตสเมื่อถือราชา/เจ้าชาย', true); return; }
      S.pending = { card: v, target: null, guess: null };
      // Auto-pick the target when there's only one legal choice — for the Guard
      // too, so the player lands straight on the guess step.
      const meta = CARD_META[v];
      const tg = validTargetIds(v);
      if (meta.needsTarget && tg.length === 1) S.pending.target = tg[0];
      render();
      break;
    }
    case 'select-seat': {
      if (!S.pending) return;
      S.pending.target = t.dataset.id;
      render();
      break;
    }
    case 'clear-target': {
      if (S.pending) S.pending.target = null;
      render();
      break;
    }
    case 'select-guess': {
      if (!S.pending) return;
      S.pending.guess = Number(t.dataset.value);
      render();
      break;
    }
    case 'confirm-play': await doPlay(); break;
    case 'cancel-play': S.pending = null; render(); break;
  }
});

function requireName() {
  if (!S.name) { toast('กรุณาใส่ชื่อก่อน', true); return false; }
  return true;
}

// keep name in sync while typing (so it survives re-render)
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'nameInput') S.name = ev.target.value;
});

// ---------------- timer tick ----------------
setInterval(() => {
  const fill = document.querySelector('.timer-fill');
  if (!fill || !S.state || !S.state.turnDeadline) return;
  const remain = S.state.turnDeadline - Date.now();
  const frac = S.turnWindow > 0 ? Math.max(0, Math.min(1, remain / S.turnWindow)) : 0;
  fill.style.width = (frac * 100).toFixed(1) + '%';
}, 250);

// ---------------- boot ----------------
async function boot() {
  S.socket = connectSocket();

  S.socket.on('state', (payload) => {
    S.state = payload;
    // clear stale reveal once we leave the play phase
    if (payload.game && payload.game.phase !== 'playing') S.reveal = null;
    // reset pending when the turn changes
    const cur = payload.game ? payload.game.currentPlayerId : null;
    if (cur !== S.lastCurrent) { S.pending = null; S.lastCurrent = cur; }
    // Drop a pending target that's become illegal within the same turn (the
    // person left, or got protected) so the Guard flow re-prompts to re-pick
    // instead of failing with a confusing toast when you press confirm.
    if (S.pending && S.pending.target && payload.game) {
      const meta = CARD_META[S.pending.card];
      if (meta && meta.needsTarget) {
        const legal = validTargetIds(S.pending.card);
        if (!legal.includes(S.pending.target)) {
          S.pending.target = legal.length === 1 ? legal[0] : null;
        }
      }
    }
    // track the timer window
    if (payload.turnDeadline && payload.turnDeadline !== S.lastDeadline) {
      S.turnWindow = payload.turnDeadline - Date.now();
      S.lastDeadline = payload.turnDeadline;
    }
    try { handleSounds(payload); } catch (e) { /* never let audio block the UI */ }
    // If the match left the gameOver phase (restart / new round), drop any
    // lingering celebration overlay so it can't cover a fresh game.
    if (payload.game && payload.game.phase !== 'gameOver' && S.celebrating) {
      S.celebrating = false;
      removeGameOverCelebration();
    }
    render();
    // Start any queued action animations now that the fresh DOM is in place
    // (so seat coordinates are measured against the current layout).
    try { flushFx(); } catch (e) { /* animations must never block the UI */ }
  });

  S.socket.on('reveal', (r) => { S.reveal = r; sfx.reveal(); render(); });
  S.socket.on('chat', (m) => toast(`${m.from}: ${m.text}`));

  S.socket.on('connect', async () => {
    // (Re)join automatically after connecting/reconnecting — survives a full
    // page reload too, since the room code is kept in sessionStorage.
    if (S.discordInstanceId) { await doJoinDiscord(S.discordInstanceId); return; }
    if (isInsideDiscord()) return; // in Discord but not joined yet; boot() will join
    const storedRoom = S.roomCode || sessionStorage.getItem('ll_room');
    if (storedRoom) {
      S.roomCode = storedRoom;
      const ok = await doJoin(storedRoom);
      if (!ok) { sessionStorage.removeItem('ll_room'); S.roomCode = null; S.hasJoined = false; render(); }
    }
  });

  // Render immediately so we NEVER sit on a blank page while Discord connects.
  render();

  // Discord Activity mode: auto-join a room keyed by the activity instance.
  if (isInsideDiscord()) {
    try {
      // Hard timeout: if the SDK handshake stalls, don't hang forever.
      S.discord = await withTimeout(initDiscord(), 8000);
    } catch (err) {
      console.warn('Discord init failed/timed out:', err);
      S.discord = null;
    }
    const dn = discordDisplayName(S.discord && S.discord.user);
    if (dn) { S.name = dn; persistIdentity(); }
    if (!S.name) S.name = 'ผู้เล่น' + Math.floor(Math.random() * 900 + 100);
    S.avatar = discordAvatarUrl(S.discord && S.discord.user) || '';
    // Prefer the SDK instance id; fall back to the URL's instance_id so players
    // still auto-group into one room even if the SDK handshake failed.
    S.discordInstanceId = (S.discord && S.discord.instanceId) || urlInstanceId() || 'discord';
    try { await withTimeout(doJoinDiscord(S.discordInstanceId), 8000); }
    catch (err) { console.warn('room join stalled:', err); }
    S.connecting = false;
  }
  render();
}

// Resolve `promise`, but reject after `ms` so a stalled await can't hang boot().
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}

boot();
