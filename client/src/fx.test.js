import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupEventsIntoTurns, describeTurn } from './fx.js';

const names = { a: 'Alice', b: 'Bob', c: 'Cara' };
const deps = {
  nameOf: (id) => names[id] || id,
  cardName: (v) => ({ 1: 'ทหาร', 2: 'บาทหลวง', 3: 'ขุนนาง', 4: 'สาวใช้', 5: 'เจ้าชาย', 6: 'ราชา', 7: 'เคาน์เตส', 8: 'เจ้าหญิง' }[v] || '?'),
};

test('groupEventsIntoTurns: splits multiple turns on play/noTarget', () => {
  const events = [
    { t: 'play', a: 'a', card: 1 }, { t: 'guard', a: 'a', target: 'b', guess: 2, hit: false },
    { t: 'play', a: 'b', card: 3 }, { t: 'baron', a: 'b', target: 'c', result: 'actor' }, { t: 'out', p: 'c' },
  ];
  const turns = groupEventsIntoTurns(events);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].length, 2);
  assert.equal(turns[1].length, 3);
});

test('groupEventsIntoTurns: drops events before the first play', () => {
  const events = [{ t: 'out', p: 'x' }, { t: 'play', a: 'a', card: 4 }, { t: 'handmaid', a: 'a' }];
  const turns = groupEventsIntoTurns(events);
  assert.equal(turns.length, 1);
  assert.equal(turns[0][0].t, 'play');
});

test('describeTurn Guard hit: target + 💥 + elimination', () => {
  const d = describeTurn([
    { t: 'play', a: 'a', card: 1 },
    { t: 'guard', a: 'a', target: 'b', guess: 8, hit: true },
    { t: 'out', p: 'b', by: 'a', revealed: [8] },
  ], deps);
  assert.equal(d.card, 1);
  assert.equal(d.actorId, 'a');
  assert.equal(d.targetId, 'b');
  assert.equal(d.icon, '💥');
  assert.deepEqual(d.outs, ['b']);
  assert.ok(d.caption.includes('Alice') && d.caption.includes('Bob') && d.caption.includes('ถูก!'));
});

test('describeTurn Guard miss: 🛡️ and no elimination', () => {
  const d = describeTurn([
    { t: 'play', a: 'a', card: 1 },
    { t: 'guard', a: 'a', target: 'b', guess: 5, hit: false },
  ], deps);
  assert.equal(d.icon, '🛡️');
  assert.deepEqual(d.outs, []);
  assert.ok(d.caption.includes('พลาด'));
});

test('describeTurn Baron: target loses', () => {
  const d = describeTurn([
    { t: 'play', a: 'a', card: 3 },
    { t: 'baron', a: 'a', target: 'c', result: 'actor' },
    { t: 'out', p: 'c' },
  ], deps);
  assert.equal(d.icon, '⚔️');
  assert.equal(d.targetId, 'c');
  assert.ok(d.caption.includes('Cara แพ้'));
});

test('describeTurn Prince: forces discard, target set', () => {
  const d = describeTurn([
    { t: 'play', a: 'b', card: 5 },
    { t: 'prince', a: 'b', target: 'a', discarded: 2 },
  ], deps);
  assert.equal(d.targetId, 'a');
  assert.equal(d.icon, '🔄');
  assert.ok(d.caption.includes('บาทหลวง'));
});

test('describeTurn Handmaid: self, no target', () => {
  const d = describeTurn([{ t: 'play', a: 'a', card: 4 }, { t: 'handmaid', a: 'a' }], deps);
  assert.equal(d.targetId, null);
  assert.equal(d.self, true);
  assert.equal(d.icon, '🛡️');
});

test('describeTurn Princess: self elimination', () => {
  const d = describeTurn([{ t: 'play', a: 'a', card: 8 }, { t: 'princess', a: 'a' }, { t: 'out', p: 'a' }], deps);
  assert.equal(d.icon, '💔');
  assert.deepEqual(d.outs, ['a']);
  assert.equal(d.self, true);
});

test('describeTurn noTarget: renders without effect event', () => {
  const d = describeTurn([{ t: 'noTarget', a: 'a', card: 1 }], deps);
  assert.equal(d.card, 1);
  assert.equal(d.targetId, null);
  assert.ok(d.caption.includes('Alice'));
});

test('describeTurn King: swap, target set', () => {
  const d = describeTurn([{ t: 'play', a: 'a', card: 6 }, { t: 'king', a: 'a', target: 'b' }], deps);
  assert.equal(d.icon, '🔀');
  assert.equal(d.targetId, 'b');
});
