// Pure helpers for action animations — no DOM/state coupling, so they can be
// unit-tested. main.js does the actual DOM animation using these descriptors.

// Split a run of new log events into per-turn groups. Each turn begins on a
// 'play' or 'noTarget' event; following effect/out events attach to it. Events
// before the first play (trailing bits from a prior turn) are dropped.
export function groupEventsIntoTurns(events) {
  const turns = [];
  let cur = null;
  for (const e of events) {
    if (e.t === 'play' || e.t === 'noTarget') { cur = [e]; turns.push(cur); }
    else if (cur) cur.push(e);
  }
  return turns;
}

const EFFECT_TYPES = ['guard', 'priest', 'baron', 'handmaid', 'prince', 'king', 'countess', 'princess'];

/**
 * Build a plain-data animation descriptor for one turn's events.
 * @param {Array} events one turn's log events (from groupEventsIntoTurns)
 * @param {{nameOf:(id)=>string, cardName:(v)=>string}} deps
 * @returns {null | {card, actorId, targetId, icon, caption, outs, self}}
 * `caption` is PLAIN TEXT (render with textContent, never innerHTML).
 */
export function describeTurn(events, { nameOf, cardName }) {
  const play = events.find((e) => e.t === 'play' || e.t === 'noTarget');
  if (!play) return null;
  const card = play.card;
  const actorId = play.a;
  const outs = events.filter((e) => e.t === 'out').map((e) => e.p);
  const eff = events.find((e) => EFFECT_TYPES.includes(e.t));
  const A = (id) => nameOf(id);
  let targetId = null;
  let icon = '';
  let caption = '';

  switch (card) {
    case 1: // Guard
      if (eff && eff.t === 'guard') {
        targetId = eff.target;
        icon = eff.hit ? '💥' : '🛡️';
        caption = `${A(actorId)} ทาย ${A(eff.target)} ถือ ${cardName(eff.guess)} — ${eff.hit ? 'ถูก!' : 'พลาด'}`;
      } else { caption = `${A(actorId)} เล่น ทหาร`; }
      break;
    case 2: // Priest
      if (eff && eff.t === 'priest') { targetId = eff.target; icon = '👁️'; caption = `${A(actorId)} แอบดูมือ ${A(eff.target)}`; }
      else { caption = `${A(actorId)} เล่น บาทหลวง`; }
      break;
    case 3: // Baron
      if (eff && eff.t === 'baron') {
        targetId = eff.target; icon = '⚔️';
        const r = eff.result === 'tie' ? 'เสมอ' : (eff.result === 'actor' ? `${A(eff.target)} แพ้` : `${A(actorId)} แพ้`);
        caption = `${A(actorId)} ดวลกับ ${A(eff.target)} — ${r}`;
      } else { caption = `${A(actorId)} เล่น ขุนนาง`; }
      break;
    case 4: icon = '🛡️'; caption = `${A(actorId)} ได้รับการป้องกัน`; break; // Handmaid (self)
    case 5: // Prince
      if (eff && eff.t === 'prince') { targetId = eff.target; icon = '🔄'; caption = `${A(actorId)} บังคับ ${A(eff.target)} ทิ้ง ${cardName(eff.discarded)}`; }
      else { caption = `${A(actorId)} เล่น เจ้าชาย`; }
      break;
    case 6: // King
      if (eff && eff.t === 'king') { targetId = eff.target; icon = '🔀'; caption = `${A(actorId)} สลับมือกับ ${A(eff.target)}`; }
      else { caption = `${A(actorId)} เล่น ราชา`; }
      break;
    case 7: icon = '🚫'; caption = `${A(actorId)} เล่น เคาน์เตส`; break; // Countess
    case 8: icon = '💔'; caption = `${A(actorId)} ทิ้ง เจ้าหญิง!`; break; // Princess
    default: caption = `${A(actorId)} เล่น ${cardName(card)}`;
  }
  return { card, actorId, targetId, icon, caption, outs, self: !targetId };
}
