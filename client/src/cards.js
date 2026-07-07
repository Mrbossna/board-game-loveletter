// Card metadata (client side) + self-contained SVG illustrations.
// Art style: a gold "royal crest" medallion with a distinct emblem per card.

export const CARD_META = {
  1: { key: 'guard',    name: 'Guard',    nameTh: 'ทหาร',     count: 5, needsTarget: true,  needsGuess: true,
       textTh: 'ทายการ์ดในมือของผู้เล่นอื่น (ห้ามทายทหาร) ถ้าถูก ผู้นั้นตกรอบ' },
  2: { key: 'priest',   name: 'Priest',   nameTh: 'บาทหลวง',  count: 2, needsTarget: true,  needsGuess: false,
       textTh: 'แอบดูการ์ดในมือของผู้เล่นอื่น 1 คน' },
  3: { key: 'baron',    name: 'Baron',    nameTh: 'ขุนนาง',   count: 2, needsTarget: true,  needsGuess: false,
       textTh: 'เทียบการ์ดกับผู้เล่นอื่น คนที่แต้มน้อยกว่าตกรอบ' },
  4: { key: 'handmaid', name: 'Handmaid', nameTh: 'สาวใช้',   count: 2, needsTarget: false, needsGuess: false,
       textTh: 'ได้รับการป้องกันจนถึงเทิร์นถัดไปของคุณ' },
  5: { key: 'prince',   name: 'Prince',   nameTh: 'เจ้าชาย',  count: 2, needsTarget: true,  needsGuess: false, canTargetSelf: true,
       textTh: 'เลือกผู้เล่น (รวมตัวเอง) ให้ทิ้งการ์ดแล้วจั่วใหม่' },
  6: { key: 'king',     name: 'King',     nameTh: 'ราชา',     count: 1, needsTarget: true,  needsGuess: false,
       textTh: 'สลับการ์ดในมือกับผู้เล่นอื่น' },
  7: { key: 'countess', name: 'Countess', nameTh: 'เคาน์เตส', count: 1, needsTarget: false, needsGuess: false,
       textTh: 'ต้องทิ้งทันทีถ้าถือคู่กับราชาหรือเจ้าชาย' },
  8: { key: 'princess', name: 'Princess', nameTh: 'เจ้าหญิง', count: 1, needsTarget: false, needsGuess: false,
       textTh: 'ถ้าทิ้งการ์ดนี้ไม่ว่าด้วยเหตุใด คุณตกรอบทันที' },
};

export const CARD_ORDER = [1, 2, 3, 4, 5, 6, 7, 8];

const INK = '#4a2f1a';
const GOLD = '#b8862f';
const WINE = '#8a1f3a';

// Emblem inner-SVG per card key (drawn inside a 100x100 medallion).
const EMBLEMS = {
  guard: `
    <path d="M50 20 L72 28 V50 C72 65 62 76 50 81 C38 76 28 65 28 50 V28 Z" fill="${INK}"/>
    <path d="M50 27 L66 33 V50 C66 61 58 70 50 74 C42 70 34 61 34 50 V33 Z" fill="#f7ecd2"/>
    <g fill="${GOLD}">
      <path d="M50 33 l4 5 h-8 z"/>
      <rect x="47.6" y="37" width="4.8" height="27" rx="1.2"/>
      <rect x="40" y="45" width="20" height="4.6" rx="2"/>
      <circle cx="50" cy="66" r="3.2"/>
    </g>`,
  priest: `
    <g stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round">
      <line x1="50" y1="18" x2="50" y2="26"/><line x1="50" y1="74" x2="50" y2="82"/>
      <line x1="18" y1="50" x2="26" y2="50"/><line x1="74" y1="50" x2="82" y2="50"/>
      <line x1="28" y1="28" x2="33" y2="33"/><line x1="67" y1="67" x2="72" y2="72"/>
      <line x1="72" y1="28" x2="67" y2="33"/><line x1="33" y1="67" x2="28" y2="72"/>
    </g>
    <path d="M26 50 Q50 31 74 50 Q50 69 26 50 Z" fill="#f7ecd2" stroke="${INK}" stroke-width="3"/>
    <circle cx="50" cy="50" r="9.5" fill="${INK}"/>
    <circle cx="50" cy="50" r="4.2" fill="${GOLD}"/>
    <circle cx="53" cy="47" r="1.6" fill="#fff"/>`,
  baron: `
    <g stroke="${INK}" stroke-width="3" stroke-linecap="round">
      <line x1="50" y1="24" x2="50" y2="66"/>
      <line x1="28" y1="34" x2="72" y2="34"/>
      <line x1="28" y1="34" x2="22" y2="47"/><line x1="28" y1="34" x2="34" y2="47"/>
      <line x1="72" y1="34" x2="66" y2="47"/><line x1="72" y1="34" x2="78" y2="47"/>
    </g>
    <path d="M20 47 a8 6 0 0 0 16 0 z" fill="${GOLD}"/>
    <path d="M64 47 a8 6 0 0 0 16 0 z" fill="${GOLD}"/>
    <circle cx="50" cy="24" r="4.2" fill="${GOLD}"/>
    <rect x="38" y="66" width="24" height="6" rx="2.5" fill="${INK}"/>`,
  handmaid: `
    <path d="M50 72 L24 40 A32 32 0 0 1 76 40 Z" fill="#f7ecd2" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <g stroke="${GOLD}" stroke-width="2.2" stroke-linecap="round">
      <line x1="50" y1="72" x2="27" y2="42"/><line x1="50" y1="72" x2="39" y2="34"/>
      <line x1="50" y1="72" x2="50" y2="32"/><line x1="50" y1="72" x2="61" y2="34"/>
      <line x1="50" y1="72" x2="73" y2="42"/>
    </g>
    <circle cx="50" cy="72" r="4.5" fill="${INK}"/>`,
  prince: `
    <line x1="38" y1="76" x2="60" y2="34" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="62" cy="30" r="10" fill="${GOLD}" stroke="${INK}" stroke-width="2.6"/>
    <path d="M62 22 v9 M57.5 26.5 h9" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M34 74 l-5 6 m5 -6 l6 5" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>`,
  king: `
    <path d="M22 64 L18 36 L34 50 L42 31 L50 46 L58 31 L66 50 L82 36 L78 64 Z"
          fill="${GOLD}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <rect x="22" y="62" width="56" height="9" rx="2.5" fill="${INK}"/>
    <circle cx="18" cy="36" r="3.4" fill="${INK}"/><circle cx="42" cy="31" r="3.4" fill="${INK}"/>
    <circle cx="58" cy="31" r="3.4" fill="${INK}"/><circle cx="82" cy="36" r="3.4" fill="${INK}"/>
    <circle cx="50" cy="58" r="3.6" fill="${WINE}"/>`,
  countess: `
    <path d="M22 44 Q50 33 78 44 Q79 61 62 63 Q54 63 50 56 Q46 63 38 63 Q21 61 22 44 Z" fill="${INK}"/>
    <ellipse cx="38" cy="49" rx="7.5" ry="5" fill="#f7ecd2"/>
    <ellipse cx="62" cy="49" rx="7.5" ry="5" fill="#f7ecd2"/>
    <path d="M70 41 Q80 24 88 20 Q85 34 76 46 Z" fill="${GOLD}"/>
    <path d="M30 41 Q20 24 12 20 Q15 34 24 46 Z" fill="${GOLD}"/>
    <circle cx="50" cy="45" r="2.6" fill="${GOLD}"/>`,
  princess: `
    <path d="M50 76 V60" stroke="#3f6b3a" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M50 70 Q36 68 30 58 Q44 57 50 64 Z" fill="#3f6b3a"/>
    <path d="M50 66 Q64 64 70 54 Q56 53 50 60 Z" fill="#3f6b3a"/>
    <circle cx="50" cy="45" r="18" fill="${WINE}"/>
    <path d="M50 33 a12 12 0 1 1 -0.1 0 M50 39 a6 6 0 1 0 0.1 0"
          fill="none" stroke="#f7ecd2" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="50" cy="45" r="3" fill="#f7ecd2"/>`,
};

export function illustration(key) {
  return `<svg class="emblem" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <circle cx="50" cy="50" r="47" fill="rgba(255,251,242,0.9)"/>
    <circle cx="50" cy="50" r="47" fill="none" stroke="${GOLD}" stroke-width="3"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${INK}" stroke-width="1" stroke-opacity="0.35"/>
    ${EMBLEMS[key] || ''}
  </svg>`;
}

// The reverse side of every card (deck / opponents' hidden hands).
export function cardBackSVG() {
  return `<svg class="cardback-svg" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="4" y="4" width="92" height="132" rx="10" fill="none" stroke="${GOLD}" stroke-width="2" stroke-opacity="0.7"/>
    <path d="M20 26 h60 M20 114 h60" stroke="${GOLD}" stroke-width="1.5" stroke-opacity="0.5"/>
    <g transform="translate(50,70)">
      <circle r="26" fill="none" stroke="${GOLD}" stroke-width="2" stroke-opacity="0.7"/>
      <path d="M0 -12 C -10 -24 -28 -12 0 12 C 28 -12 10 -24 0 -12 Z" fill="${GOLD}" fill-opacity="0.85"/>
    </g>
  </svg>`;
}

/**
 * Build a full card element (frame + art + labels).
 * @param {number} value 1..8
 * @param {object} opts { small, faceDown, selectable }
 */
export function cardElement(value, opts = {}) {
  const meta = CARD_META[value];
  const el = document.createElement('div');
  el.className = 'card';
  if (opts.small) el.classList.add('card--sm');
  if (opts.faceDown || !meta) {
    el.classList.add('card--back');
    el.innerHTML = cardBackSVG();
    return el;
  }
  el.classList.add(`card--${meta.key}`);
  el.dataset.value = String(value);
  el.innerHTML = `
    <span class="card__corner card__corner--tl">${value}</span>
    <div class="card__art">${illustration(meta.key)}</div>
    <div class="card__name">
      <span class="card__name-th">${meta.nameTh}</span>
      <span class="card__name-en">${meta.name}</span>
    </div>
    <span class="card__corner card__corner--br">${value}</span>`;
  return el;
}
