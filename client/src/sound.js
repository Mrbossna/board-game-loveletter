// Self-contained sound effects via the Web Audio API.
// Tones are synthesised at runtime — no audio files, so it works inside the
// Discord Activity sandbox (which blocks external requests) with zero assets.

let ctx = null;
let master = null;
let muted = localStorage.getItem('ll_muted') === '1';
const VOLUME = 0.4;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  // Browsers start the context suspended until a user gesture.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Call from within a user gesture (e.g. first click) to satisfy autoplay policy.
export function unlock() { ensure(); }
export function isMuted() { return muted; }
export function setMuted(m) {
  muted = !!m;
  localStorage.setItem('ll_muted', muted ? '1' : '0');
  if (master) master.gain.value = muted ? 0 : VOLUME;
}
export function toggleMuted() { setMuted(!muted); return muted; }

function tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.25, attack = 0.006, when = 0, glideTo = null }) {
  const c = ensure();
  if (!c || muted) return;
  try {
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  } catch { /* audio must never break gameplay */ }
}

function noise({ dur = 0.3, gain = 0.12, freq = 1000, type = 'highpass' }) {
  const c = ensure();
  if (!c || muted) return;
  try {
    const t0 = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  } catch { /* audio must never break gameplay */ }
}

function fanfare(freqs, step = 0.13) {
  freqs.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.28, gain: 0.2, when: i * step }));
}

export const sfx = {
  ui: () => tone({ freq: 520, type: 'triangle', dur: 0.05, gain: 0.1 }),
  select: () => tone({ freq: 700, type: 'triangle', dur: 0.08, gain: 0.14 }),
  play: () => {
    tone({ freq: 440, type: 'sine', dur: 0.12, gain: 0.2 });
    tone({ freq: 660, type: 'sine', dur: 0.14, gain: 0.12, when: 0.05 });
  },
  deal: () => noise({ dur: 0.4, gain: 0.11, freq: 1400 }),
  reveal: () => {
    tone({ freq: 392, type: 'sine', dur: 0.18, gain: 0.18 });
    tone({ freq: 587, type: 'sine', dur: 0.24, gain: 0.15, when: 0.12 });
  },
  eliminate: () => tone({ freq: 320, type: 'sawtooth', dur: 0.35, gain: 0.18, glideTo: 110 }),
  yourTurn: () => {
    tone({ freq: 659, type: 'sine', dur: 0.14, gain: 0.2 });
    tone({ freq: 988, type: 'sine', dur: 0.22, gain: 0.16, when: 0.12 });
  },
  roundWin: () => fanfare([523, 659, 784]),
  gameWin: () => fanfare([523, 659, 784, 1047], 0.15),
  lose: () => tone({ freq: 300, type: 'sine', dur: 0.4, gain: 0.18, glideTo: 150 }),
  error: () => tone({ freq: 150, type: 'square', dur: 0.16, gain: 0.12 }),
};
