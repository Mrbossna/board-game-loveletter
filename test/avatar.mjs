// Headless check: avatars supplied on join appear in both room.players and
// game.players in the broadcast state. Requires a server at URL (default :4123).
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:4123';
const AV_A = 'https://cdn.discordapp.com/avatars/1/a.png?size=128';
const AV_B = 'https://cdn.discordapp.com/embed/avatars/3.png';

function client() {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => res(s));
  });
}
const emitP = (s, ev, p) => new Promise((r) => s.emit(ev, p, (x) => r(x || {})));

async function main() {
  const a = await client();
  const b = await client();

  let latestA = null;
  a.on('state', (p) => { latestA = p; });

  const created = await emitP(a, 'room:create', { name: 'Alice', avatar: AV_A });
  if (!created.ok) throw new Error('create failed');
  const code = created.code;
  const jb = await emitP(b, 'room:join', { code, name: 'Bob', avatar: AV_B });
  if (!jb.ok) throw new Error('join failed');

  await emitP(a, 'game:start');
  await new Promise((r) => setTimeout(r, 300)); // let state broadcast

  const roomPlayers = latestA.room.players;
  const gamePlayers = latestA.game.players;
  const roomA = roomPlayers.find((p) => p.name === 'Alice');
  const roomB = roomPlayers.find((p) => p.name === 'Bob');
  const gameA = gamePlayers.find((p) => p.name === 'Alice');
  const gameB = gamePlayers.find((p) => p.name === 'Bob');

  const checks = [
    ['room Alice avatar', roomA && roomA.avatar === AV_A],
    ['room Bob avatar', roomB && roomB.avatar === AV_B],
    ['game Alice avatar (overlaid)', gameA && gameA.avatar === AV_A],
    ['game Bob avatar (overlaid)', gameB && gameB.avatar === AV_B],
  ];
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? '✔' : '�’✗'} ${label}`);
    if (!pass) ok = false;
  }
  a.close(); b.close();
  if (!ok) { console.error('❌ avatar plumbing FAILED'); process.exit(1); }
  console.log('\nAVATAR PLUMBING OK ✅');
  process.exit(0);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
