// generate.js — turn listing text (room names + sizes, beds/baths) into an approximate floor plan.
// Pure JS (no DOM), so it runs in the builder and from the command line (tools/make-listing.mjs).
// Room SIZES come from the listing; room POSITIONS are estimated, so listings are marked `approximate`.
import { uid, defaultFloorFor, computeWalls, wallRectsFrom, openingZones, autoPlace, makeItem, catalogItem } from './model.js';

// ---------------- parsing ----------------
const LEVEL_WORDS = [
  [/\b(basement|lower level|lower)\b/i, 0],
  [/\b(main|first|1st|ground|entry)\b/i, 1],
  [/\b(upper|second|2nd)\b/i, 2],
  [/\b(third|3rd)\b/i, 3],
];
const levelOf = s => { for (const [re, n] of LEVEL_WORDS) if (re.test(s)) return n; return null; };

// one dimension: 14 | 14.5 | 14' | 14'2" | 14' 2 | 14ft
// (inches are only read after an explicit feet mark, so "Bedroom 4 10 x 12" isn't read as 4'10")
const DIM = String.raw`(\d{1,2}(?:\.\d+)?)(?:\s*(?:'|′|ft\.?|feet)\s*(?:(\d{1,2})\s*(?:"|″|in\.?)?)?)?`;
const PAIR = new RegExp(DIM + String.raw`\s*[x×X*]\s*` + DIM);
const toFt = (f, i) => +f + (i ? +i / 12 : 0);

const ROOM_WORD = /(bed|bath|living|family|great|kitchen|dining|breakfast|nook|foyer|entry|office|den|study|laundry|utility|mud|closet|bonus|loft|media|game|rec|sun|florida|keeping|pantry|garage|primary|master|owner|guest|flex|library|gym|exercise|sitting|powder|play)/i;

/** Parse pasted listing text → { details, rooms:[{name,w,d,level}] }. */
export function parseListingText(text) {
  const details = {};
  const t = String(text || '');
  const m = (re) => t.match(re)?.[1];
  const beds = m(/(\d+)\s*(?:bd|bds|beds?|bedrooms?)\b/i);
  const baths = m(/(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)\b/i);
  const full = m(/(\d+)\s*full\s*bath/i), half = m(/(\d+)\s*half\s*bath/i);
  const sqft = m(/([\d,]{3,6})\s*(?:sq\.?\s*ft|sqft|square\s*feet)/i);
  const price = m(/(\$\s?[\d,]{5,})/);
  if (beds) details.beds = +beds;
  if (full || half) details.baths = (+full || 0) + 0.5 * (+half || 0);
  else if (baths) details.baths = +baths;
  if (sqft) details.sqft = +sqft.replace(/,/g, '');
  if (price) details.price = price.replace(/\s/g, '');

  const rooms = [];
  let level = 1, lastName = '';
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const pm = line.match(PAIR);
    if (!pm) {
      // headers like "Upper Level" / "Main Level Rooms" switch the current level
      const lv = levelOf(line);
      if (lv != null && line.length < 40 && /level|floor|story/i.test(line)) level = lv;
      else if (/^level\s*:/i.test(line) && lv != null) { level = lv; if (rooms.length && rooms[rooms.length - 1]._needLevel) rooms[rooms.length - 1].level = lv; }
      if (ROOM_WORD.test(line) && line.length < 40 && !/level\s*:/i.test(line)) lastName = line.replace(/[:\-–—]+$/, '').trim();
      continue;
    }
    let name = line.slice(0, pm.index).replace(/\b(dimensions?|dims?|size)\b\s*:?/gi, '').replace(/[:\-–—|,(]+\s*$/, '').trim();
    if (!name || !ROOM_WORD.test(name)) name = lastName || name;
    if (!name) continue;
    const a = toFt(pm[1], pm[2]), b = toFt(pm[3], pm[4]);
    if (!(a >= 3 && b >= 3 && a <= 60 && b <= 60)) continue;
    const lvLine = levelOf(line.slice(pm.index + pm[0].length)) ?? levelOf(name.replace(/primary|master/i, ''));
    rooms.push({ name: tidy(name), w: round(a), d: round(b), level: lvLine ?? level, _needLevel: lvLine == null && name === lastName });
    lastName = '';
  }
  rooms.forEach(r => delete r._needLevel);
  return { details, rooms };
}
const round = v => Math.round(v * 12) / 12;
const tidy = s => s.replace(/\s+/g, ' ').replace(/\bmaster\b/i, 'Primary').replace(/^\w/, c => c.toUpperCase()).replace(/\s*level\s*:?.*$/i, '').trim();

// ---------------- classification ----------------
const kind = name => {
  const n = name.toLowerCase();
  if (/stair/.test(n)) return 'stairs';
  if (/hallway|^hall\b|corridor|landing|gallery/.test(n)) return 'hall';
  if (/(primary|master|owner).*(bath)/.test(n)) return 'pbath';
  if (/(primary|master|owner).*(closet|wic)|walk.?in/.test(n)) return 'pcloset';
  if (/(primary|master|owner)/.test(n)) return 'primary';
  if (/powder|half/.test(n)) return 'half';
  if (/bath/.test(n)) return 'bath';
  if (/bed|guest|nursery/.test(n)) return 'bed';
  if (/foyer|entry/.test(n)) return 'foyer';
  if (/living|family|great|keeping|media|sun|florida|rec|game|play/.test(n)) return 'living';
  if (/kitchen/.test(n)) return 'kitchen';
  if (/dining|breakfast|nook/.test(n)) return 'dining';
  if (/office|den|study|library|flex|loft|bonus|sitting|gym|exercise/.test(n)) return 'flex';
  if (/laundry|utility|mud/.test(n)) return 'laundry';
  if (/closet|pantry/.test(n)) return 'closet';
  if (/garage/.test(n)) return 'garage';
  return 'flex';
};
const PUBLIC = ['foyer', 'living', 'dining', 'kitchen'];

// ---------------- fill in rooms the listing didn't size ----------------
function completeRooms(rooms, details) {
  const out = rooms.map(r => ({ ...r, k: kind(r.name) }));
  const main = Math.min(...out.map(r => r.level), 1);
  const has = k => out.some(r => r.k === k);
  const add = (name, w, d, level) => out.push({ name, w, d, level, k: kind(name), est: true });
  const primary = out.find(r => r.k === 'primary');
  const bedCount = out.filter(r => r.k === 'bed' || r.k === 'primary').length;
  for (let i = bedCount; i < (details.beds || 0); i++) add(`Bedroom ${i + 1}`, 11, 12, primary?.level ?? main);
  if (!has('living')) add('Living Room', 16, 14, main);
  if (!has('kitchen')) add('Kitchen', 12, 12, main);
  const fullBaths = Math.floor(details.baths || 0), halfBaths = Math.round(((details.baths || 0) % 1) * 2);
  let haveFull = out.filter(r => r.k === 'bath' || r.k === 'pbath').length;
  if (primary && !has('pbath') && haveFull < Math.max(1, fullBaths)) { add('Primary Bath', 9, 10, primary.level); haveFull++; }
  for (let i = haveFull; i < fullBaths; i++) add(i === 0 ? 'Bath' : `Bath ${i + 1}`, 8, 9, (out.find(r => r.k === 'bed' && !r.est) || primary)?.level ?? main);
  for (let i = out.filter(r => r.k === 'half').length; i < halfBaths; i++) add('Half Bath', 5, 6, main);
  if (primary && !has('pcloset')) add('Walk-in Closet', 6, 7, primary.level);
  if (!has('laundry')) add('Laundry', 6, 7, main);
  return out;
}

// ---------------- layout ----------------
const HALL = 4;
const width = row => row.reduce((a, r) => a + r.w, 0);

function layoutLevel(rooms, { isMain, multi }) {
  // Primary suite stays together: bedroom, then bath, then closet.
  const byOrder = (order) => (a, b) => order.indexOf(a.k) - order.indexOf(b.k);
  let front = rooms.filter(r => PUBLIC.includes(r.k)).sort(byOrder(['foyer', 'living', 'dining', 'kitchen']));
  const suite = ['primary', 'pbath', 'pcloset'].map(k => rooms.filter(r => r.k === k)).flat();
  const beds = rooms.filter(r => r.k === 'bed'), baths = rooms.filter(r => r.k === 'bath');
  const back = [...suite];
  beds.forEach((b, i) => { back.push(b); if (i % 2 === 0 && baths.length) back.push(baths.shift()); });
  back.push(...baths, ...rooms.filter(r => ['half', 'laundry', 'closet'].includes(r.k)));
  const flex = rooms.filter(r => ['flex', 'garage'].includes(r.k));
  if (multi) flex.unshift({ name: 'Stairs', w: 4, d: 10, k: 'stairs', est: true, level: rooms[0]?.level ?? 1 });
  // Upstairs with no living spaces: split the private rooms over both sides of the hall,
  // keeping the primary suite together as one unit.
  if (!front.length) {
    const units = [];
    for (const r of back.splice(0)) {
      if ((r.k === 'pbath' || r.k === 'pcloset') && units.length && units[units.length - 1][0].k === 'primary') units[units.length - 1].push(r);
      else units.push([r]);
    }
    for (const u of units) (width(front) <= width(back) ? front : back).push(...u);
  }
  for (const r of flex) (width(front) <= width(back) ? front : back).push(r);

  const placed = [];
  let x = 0;
  for (const r of front) { placed.push({ ...r, x, y: -r.d, row: 'front' }); x += r.w; }
  x = 0;
  for (const r of back) { placed.push({ ...r, x, y: HALL, row: 'back' }); x += r.w; }
  const W = Math.max(width(front), width(back), 8);
  placed.push({ name: 'Hallway', k: 'hall', x: 0, y: 0, w: W, d: HALL, est: true, level: rooms[0]?.level ?? 1, row: 'hall' });

  // doors
  for (const r of placed) r.doors = [];
  const rowRooms = row => placed.filter(p => p.row === row).sort((a, b) => a.x - b.x);
  for (const row of ['front', 'back']) {
    const list = rowRooms(row);
    list.forEach((r, i) => {
      const toHall = row === 'front' ? 's' : 'n';
      const prev = list[i - 1];
      const suitePart = (r.k === 'pbath' || r.k === 'pcloset') && prev && ['primary', 'pbath', 'pcloset'].includes(prev.k);
      if (suitePart) {
        // door through the shared wall with the previous suite room
        const y0 = Math.max(r.y, prev.y), y1 = Math.min(r.y + r.d, prev.y + prev.d);
        if (y1 - y0 >= 2.5) prev.doors.push({ wall: 'e', offset: (y0 - prev.y) + (y1 - y0) / 2 - 1.25, width: 2.5, type: 'door' });
        return;
      }
      if (PUBLIC.includes(r.k) || r.k === 'stairs') {
        r.doors.push({ wall: toHall, offset: 0.5, width: Math.min(r.w - 1, r.k === 'stairs' ? 3.5 : 8), type: 'opening' });
        // open plan between neighbouring living spaces
        if (prev && (PUBLIC.includes(prev.k))) {
          const y0 = Math.max(r.y, prev.y), y1 = Math.min(r.y + r.d, prev.y + prev.d);
          if (y1 - y0 >= 3) prev.doors.push({ wall: 'e', offset: (y0 - prev.y) + 0.5, width: Math.min(y1 - y0 - 1, 10), type: 'opening' });
        }
      } else {
        const wdt = ['bath', 'half', 'pbath', 'closet', 'laundry', 'pcloset'].includes(r.k) ? 2.5 : 2.67;
        r.doors.push({ wall: toHall, offset: Math.min(1, Math.max(0, r.w - wdt)), width: Math.min(wdt, r.w), type: 'door' });
      }
    });
  }
  if (isMain) {
    const f = rowRooms('front')[0];
    if (f) f.doors.push({ wall: 'n', offset: Math.max(0, f.w / 2 - 1.5), width: Math.min(3, f.w), type: 'door' });
    else placed.find(p => p.k === 'hall').doors.push({ wall: 'w', offset: 0.5, width: 3, type: 'door' });
  }
  const minY = Math.min(...placed.map(p => p.y));
  for (const p of placed) p.y -= minY;
  return placed;
}

/** rooms (from parseListingText) + details → listing rooms[] with positions and doors. */
export function generateLayout(parsedRooms, details = {}) {
  const all = completeRooms(parsedRooms, details);
  const levels = [...new Set(all.map(r => r.level))].sort((a, b) => a - b);
  const main = levels.includes(1) ? 1 : levels[0];
  const out = [];
  for (const lv of levels) {
    const placed = layoutLevel(all.filter(r => r.level === lv), { isMain: lv === main, multi: levels.length > 1 });
    for (const p of placed) out.push({
      id: uid('r'), name: p.name, floor: p.k === 'stairs' ? 'wood' : defaultFloorFor(p.name), level: lv,
      x: p.x, y: p.y, w: p.w, d: p.d, doors: p.doors, ...(p.est ? { est: true } : {}),
    });
  }
  return out;
}

// ---------------- auto-staging ----------------
// Each entry is a list of alternatives, largest first: the first one that fits is used.
const STAGE = {
  primary: [['bed-king', 'bed-queen'], ['nightstand'], ['nightstand'], ['dresser']],
  bed: [['bed-queen', 'bed-full', 'bed-twin'], ['nightstand'], ['dresser']],
  living: [['rug-8x10', 'rug-5x8'], ['sofa-3', 'sofa-love'], ['tv-stand'], ['coffee'], ['armchair'], ['plant']],
  dining: [['dining-6', 'dining-4', 'dining-round']],
  kitchen: [['counter'], ['fridge'], ['island']],
  flex: [['desk'], ['bookshelf'], ['armchair']],
  bath: [['tub'], ['vanity', 'vanity-24'], ['toilet']],
  pbath: [['tub'], ['vanity', 'vanity-24'], ['toilet']],
  half: [['vanity-24'], ['toilet']],
  laundry: [['washer-dryer']],
};

/** Furnish generated rooms with typical pieces, placed so nothing blocks a doorway. */
export function autoStage(rooms) {
  const furniture = [];
  for (const lv of [...new Set(rooms.map(r => r.level ?? 1))]) {
    const here = rooms.filter(r => (r.level ?? 1) === lv);
    const { segments, openings } = computeWalls(here);
    const walls = wallRectsFrom(segments), zones = openingZones(openings);
    const placed = [];
    for (const room of here) {
      const k = kind(room.name);
      // a kitchen island needs a big kitchen; skip it in small ones
      for (const alts of STAGE[k] || []) {
        if (alts[0] === 'island' && room.w * room.d < 150) continue;
        for (const key of alts) {
          const item = makeItem(catalogItem(key));
          const spot = autoPlace(room, item, placed, walls, zones);
          if (spot) { const f = { ...item, ...spot, ...(lv !== 1 ? { level: lv } : {}) }; placed.push(f); break; }
        }
      }
    }
    furniture.push(...placed);
  }
  return furniture;
}

export const levelName = n => ({ 0: 'Basement', 1: 'Main floor', 2: 'Upper floor', 3: 'Third floor' }[n] || `Level ${n}`);
