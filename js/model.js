// model.js — pure data + geometry helpers (no three.js). All plan units are FEET.
// Plan coordinates: x grows right, y grows "down" the floor plan image (becomes +z in 3D).

export const WALL_H = 8.5;   // wall height
export const WALL_T = 0.42;  // wall thickness (~5")
export const DOOR_H = 6.75;  // doorway height (81")
export const EYE_H = 5.4;    // walkthrough eye height

export const FLOORS = {
  wood: 'Wood', 'light-wood': 'Light wood', tile: 'Tile', stone: 'Stone tile', carpet: 'Carpet', concrete: 'Concrete',
};

export const uid = (p = 'id') => p + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function defaultFloorFor(name = '') {
  const n = name.toLowerCase();
  if (/bath|laundry|powder|mud|utility/.test(n)) return 'tile';
  if (/kitchen/.test(n)) return 'stone';
  if (/bed|closet|nursery|bonus/.test(n)) return 'carpet';
  if (/garage|basement/.test(n)) return 'concrete';
  return 'wood';
}

// ---------- units ----------
export function fmtFt(ft) {
  if (!isFinite(ft)) return '—';
  const neg = ft < 0; const total = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(total / 12), i = total - f * 12;
  const s = i ? (f ? `${f}' ${i}"` : `${i}"`) : `${f}'`;
  return neg ? '-' + s : s;
}
export const fmtIn = (inches) => `${Math.round(inches)}"`;

/** Parse "12'6", 12' 6", 12.5, 150in, 150" → feet */
export function parseFt(s) {
  if (typeof s === 'number') return s;
  s = String(s ?? '').trim().toLowerCase().replace(/[″”“]/g, '"').replace(/[′’‘]/g, "'");
  if (!s) return NaN;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/);
  if (m) return +m[1] + (m[2] ? +m[2] / 12 : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inches)$/);
  if (m) return +m[1] / 12;
  m = s.match(/^(\d+)\s*[- ]\s*(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] + +m[2] / 12;
  const n = Number(s); return isNaN(n) ? NaN : n;
}
/** Parse inches: bare numbers are inches; anything with ' is feet */
export function parseIn(s) {
  const str = String(s ?? '').trim();
  if (/^\d+(\.\d+)?\s*("|in)?$/i.test(str)) return parseFloat(str);
  const ft = parseFt(str); return isNaN(ft) ? NaN : ft * 12;
}

// ---------- walls ----------
/** Merge every room edge into unique wall segments, cut out doors/openings. */
export function computeWalls(rooms, T = WALL_T) {
  const TOL = 0.3;
  const lines = { h: [], v: [] };
  const lineFor = (o, c, create) => {
    let L = lines[o].find(l => Math.abs(l.c - c) < TOL);
    if (!L && create) { L = { o, c, ivs: [], cuts: [] }; lines[o].push(L); }
    return L;
  };
  for (const r of rooms) {
    lineFor('h', r.y, true).ivs.push([r.x, r.x + r.w]);
    lineFor('h', r.y + r.d, true).ivs.push([r.x, r.x + r.w]);
    lineFor('v', r.x, true).ivs.push([r.y, r.y + r.d]);
    lineFor('v', r.x + r.w, true).ivs.push([r.y, r.y + r.d]);
  }
  const openings = [];
  for (const r of rooms) for (const dr of r.doors || []) {
    const o = dr.wall === 'n' || dr.wall === 's' ? 'h' : 'v';
    const c = dr.wall === 'n' ? r.y : dr.wall === 's' ? r.y + r.d : dr.wall === 'w' ? r.x : r.x + r.w;
    const len = o === 'h' ? r.w : r.d;
    const width = clamp(dr.width || 2.67, 0.5, len);
    const off = clamp(dr.offset || 0, 0, len - width);
    const a = (o === 'h' ? r.x : r.y) + off;
    const L = lineFor(o, c, false);
    const op = { o, c: L ? L.c : c, a, b: a + width, type: dr.type || 'door', roomId: r.id };
    openings.push(op);
    if (L) L.cuts.push([op.a, op.b]);
  }
  const segments = [];
  for (const o of ['h', 'v']) for (const L of lines[o]) {
    const merged = [];
    for (const iv of L.ivs.sort((p, q) => p[0] - q[0])) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 0.05) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    let segs = merged.map(([a, b]) => ({ a, b, openA: false, openB: false }));
    for (const [ca, cb] of L.cuts) {
      const next = [];
      for (const s of segs) {
        if (cb <= s.a || ca >= s.b) { next.push(s); continue; }
        if (ca > s.a) next.push({ a: s.a, b: ca, openA: s.openA, openB: true });
        if (cb < s.b) next.push({ a: cb, b: s.b, openA: true, openB: s.openB });
      }
      segs = next;
    }
    for (const s of segs) {
      const a = s.a - (s.openA ? 0 : T / 2), b = s.b + (s.openB ? 0 : T / 2);
      if (b - a > 0.02) segments.push({ o, c: L.c, a, b });
    }
  }
  return { segments, openings };
}

export const wallRectsFrom = (segments, T = WALL_T) => segments.map(s => s.o === 'h'
  ? { x0: s.a, x1: s.b, z0: s.c - T / 2, z1: s.c + T / 2 }
  : { x0: s.c - T / 2, x1: s.c + T / 2, z0: s.a, z1: s.b });

/** Keep-clear zones in front of every doorway (used by auto-placement). */
export const openingZones = (openings, depth = 2.5) => openings.map(o => o.o === 'h'
  ? { x0: o.a, x1: o.b, z0: o.c - depth, z1: o.c + depth }
  : { x0: o.c - depth, x1: o.c + depth, z0: o.a, z1: o.b });

export const roomAt = (rooms, x, y) =>
  [...rooms].sort((a, b) => a.w * a.d - b.w * b.d).find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d) || null;

export function bounds(rooms) {
  if (!rooms.length) return { x0: 0, z0: 0, x1: 30, z1: 20 };
  return {
    x0: Math.min(...rooms.map(r => r.x)), z0: Math.min(...rooms.map(r => r.y)),
    x1: Math.max(...rooms.map(r => r.x + r.w)), z1: Math.max(...rooms.map(r => r.y + r.d)),
  };
}

// ---------- furniture ----------
// Catalog sizes are INCHES (w = side-to-side, d = front-to-back, h = height). Back of item = against the wall.
export const CATALOG = [
  { group: 'Beds', key: 'bed-twin', label: 'Twin bed', kind: 'bed', w: 41, d: 80, h: 42, moveDims: [38, 75, 10], moveLabel: 'The mattress', moveNote: 'Bed frames come apart, so the mattress is what has to fit.' },
  { group: 'Beds', key: 'bed-full', label: 'Full bed', kind: 'bed', w: 57, d: 80, h: 44, moveDims: [54, 75, 11], moveLabel: 'The mattress', moveNote: 'Bed frames come apart, so the mattress is what has to fit.' },
  { group: 'Beds', key: 'bed-queen', label: 'Queen bed', kind: 'bed', w: 64, d: 86, h: 48, moveDims: [60, 80, 12], moveLabel: 'The mattress', moveNote: 'Bed frames come apart, so the mattress is what has to fit.' },
  { group: 'Beds', key: 'bed-king', label: 'King bed', kind: 'bed', w: 80, d: 86, h: 48, moveDims: [76, 80, 12], moveLabel: 'The mattress', moveNote: 'Bed frames come apart, so the mattress is what has to fit.' },
  { group: 'Beds', key: 'bed-calking', label: 'Cal king bed', kind: 'bed', w: 76, d: 90, h: 48, moveDims: [72, 84, 12], moveLabel: 'The mattress', moveNote: 'Bed frames come apart, so the mattress is what has to fit.' },
  { group: 'Seating', key: 'sofa-3', label: 'Sofa (3-seat)', kind: 'sofa', w: 84, d: 38, h: 34 },
  { group: 'Seating', key: 'sofa-love', label: 'Loveseat', kind: 'sofa', w: 64, d: 38, h: 34 },
  { group: 'Seating', key: 'sofa-sleeper', label: 'Sleeper sofa', kind: 'sofa', w: 88, d: 40, h: 36 },
  { group: 'Seating', key: 'sectional', label: 'L-sectional', kind: 'sectional', w: 112, d: 86, h: 34, moveDims: [86, 38, 34], moveLabel: 'The largest section', moveNote: 'Sectionals split into sections, so we checked the biggest one.' },
  { group: 'Seating', key: 'armchair', label: 'Armchair', kind: 'chair', w: 34, d: 36, h: 34 },
  { group: 'Seating', key: 'recliner', label: 'Recliner', kind: 'chair', w: 38, d: 40, h: 40 },
  { group: 'Tables', key: 'dining-4', label: 'Dining table (4)', kind: 'dining', w: 48, d: 36, h: 30 },
  { group: 'Tables', key: 'dining-6', label: 'Dining table (6)', kind: 'dining', w: 72, d: 40, h: 30 },
  { group: 'Tables', key: 'dining-8', label: 'Dining table (8)', kind: 'dining', w: 96, d: 42, h: 30 },
  { group: 'Tables', key: 'dining-round', label: 'Round table 48"', kind: 'dining', shape: 'round', w: 48, d: 48, h: 30 },
  { group: 'Tables', key: 'coffee', label: 'Coffee table', kind: 'coffee', w: 48, d: 24, h: 18 },
  { group: 'Tables', key: 'desk', label: 'Desk', kind: 'desk', w: 60, d: 30, h: 30 },
  { group: 'Storage', key: 'dresser', label: 'Dresser', kind: 'storage', w: 60, d: 20, h: 34 },
  { group: 'Storage', key: 'nightstand', label: 'Nightstand', kind: 'storage', w: 24, d: 18, h: 26 },
  { group: 'Storage', key: 'bookshelf', label: 'Bookshelf', kind: 'shelf', w: 36, d: 14, h: 72 },
  { group: 'Storage', key: 'tv-stand', label: 'TV + stand', kind: 'tv', w: 70, d: 18, h: 22 },
  { group: 'Kitchen & bath', key: 'counter', label: 'Counter run 9\'', kind: 'counter', w: 108, d: 25, h: 36 },
  { group: 'Kitchen & bath', key: 'island', label: 'Kitchen island', kind: 'counter', w: 72, d: 36, h: 36 },
  { group: 'Kitchen & bath', key: 'fridge', label: 'Refrigerator', kind: 'fridge', w: 36, d: 30, h: 70 },
  { group: 'Kitchen & bath', key: 'washer-dryer', label: 'Washer + dryer', kind: 'laundry', w: 56, d: 30, h: 38 },
  { group: 'Kitchen & bath', key: 'vanity', label: 'Vanity 48"', kind: 'vanity', w: 48, d: 22, h: 34 },
  { group: 'Kitchen & bath', key: 'vanity-24', label: 'Vanity 24"', kind: 'vanity', w: 24, d: 20, h: 34 },
  { group: 'Kitchen & bath', key: 'tub', label: 'Bathtub', kind: 'tub', w: 60, d: 30, h: 20 },
  { group: 'Kitchen & bath', key: 'toilet', label: 'Toilet', kind: 'toilet', w: 20, d: 28, h: 30 },
  { group: 'Other', key: 'piano', label: 'Upright piano', kind: 'piano', w: 58, d: 25, h: 48 },
  { group: 'Other', key: 'rug-8x10', label: 'Rug 8×10', kind: 'rug', w: 96, d: 120, h: 0.5 },
  { group: 'Other', key: 'rug-5x8', label: 'Rug 5×8', kind: 'rug', w: 60, d: 96, h: 0.5 },
  { group: 'Other', key: 'plant', label: 'Floor plant', kind: 'plant', w: 20, d: 20, h: 54 },
];
export const catalogItem = key => CATALOG.find(c => c.key === key);

// Recommended free space (inches) around a piece, by kind.
export const CLEARANCE = {
  bed: { side: 24, front: 24, why: '24" walkway on both sides and at the foot' },
  sofa: { front: 30, why: '30" in front for legroom and a path' },
  sectional: { front: 30, why: '30" in front for legroom and a path' },
  chair: { front: 24, why: '24" in front to sit and stand' },
  dining: { side: 36, front: 36, back: 36, why: '36" all around to pull out chairs' },
  coffee: { why: 'no extra clearance needed' },
  desk: { front: 36, why: '36" for the desk chair' },
  storage: { front: 30, why: '30" to open drawers' },
  shelf: { front: 24, why: '24" to browse' },
  tv: { front: 48, why: '4\' of viewing distance' },
  counter: { front: 42, side: 0, why: '42" kitchen work aisle' },
  fridge: { front: 36, why: '36" to open the doors' },
  laundry: { front: 36, why: '36" to load and unload' },
  vanity: { front: 30, why: '30" to stand at the sink' },
  tub: { front: 30, why: '30" to step in and out' },
  toilet: { side: 6, front: 21, why: '21" in front (code minimum)' },
  piano: { front: 36, why: '36" for the bench' },
  rug: { why: 'no extra clearance needed' },
  plant: { why: 'no extra clearance needed' },
};
export const isNoCollide = f => f.kind === 'rug';

/** Catalog entry (inches) → placed item (feet). */
export function makeItem(cat, over = {}) {
  return {
    id: uid('f'), key: cat.key || 'custom', name: cat.label || cat.name || 'Item', kind: cat.kind || 'box',
    shape: cat.shape || undefined, w: cat.w / 12, d: cat.d / 12, h: (cat.h || 30) / 12,
    x: 0, y: 0, rot: 0, ...over,
  };
}

export function footprint(f) {
  const straight = ((f.rot || 0) % 180) === 0;
  return { hw: (straight ? f.w : f.d) / 2, hd: (straight ? f.d : f.w) / 2 };
}
export function rectOf(f) {
  const { hw, hd } = footprint(f);
  return { x0: f.x - hw, x1: f.x + hw, z0: f.y - hd, z1: f.y + hd };
}
export const overlap = (a, b, eps = 0.01) => a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps;

export function collides(f, wallRects, others) {
  if (isNoCollide(f)) return false;
  const r = rectOf(f);
  return wallRects.some(w => overlap(r, w)) || others.some(o => o.id !== f.id && !isNoCollide(o) && overlap(r, rectOf(o)));
}

/** Find a free spot for `item` in `room`, backed against a wall when possible. Returns {x,y,rot} or null. */
export function autoPlace(room, item, furniture, wallRects, zones) {
  const pad = WALL_T / 2 + 0.03;
  const ix0 = room.x + pad, ix1 = room.x + room.w - pad, iz0 = room.y + pad, iz1 = room.y + room.d - pad;
  const cx = room.x + room.w / 2, cz = room.y + room.d / 2;
  const free = isNoCollide(item);
  const blockers = free ? [] : [...furniture.filter(f => f.id !== item.id && !isNoCollide(f)).map(rectOf), ...zones];
  const ok = c => {
    const r = rectOf({ ...item, ...c });
    if (r.x0 < ix0 - 1e-6 || r.x1 > ix1 + 1e-6 || r.z0 < iz0 - 1e-6 || r.z1 > iz1 + 1e-6) return false;
    return free || (!blockers.some(b => overlap(r, b)) && !wallRects.some(w => overlap(r, w)));
  };
  const cands = [];
  const centerFirst = ['dining', 'coffee', 'rug', 'counter'].includes(item.kind) && item.key !== 'counter';
  const center = [0, 90].map(rot => ({ rot, x: cx, y: cz }));
  if (centerFirst) cands.push(...center);
  const offs = [0]; for (let s = 0.25; s < Math.max(room.w, room.d) / 2 + 1; s += 0.25) offs.push(s, -s);
  const rots = room.w >= room.d ? [0, 180, 90, 270] : [90, 270, 0, 180];
  for (const rot of rots) {
    const { hw, hd } = footprint({ ...item, rot });
    for (const o of offs) {
      if (rot === 0) cands.push({ rot, x: cx + o, y: iz0 + hd });
      if (rot === 180) cands.push({ rot, x: cx + o, y: iz1 - hd });
      if (rot === 90) cands.push({ rot, x: ix1 - hw, y: cz + o });
      if (rot === 270) cands.push({ rot, x: ix0 + hw, y: cz + o });
    }
  }
  if (!centerFirst) cands.push(...center);
  for (let z = iz0; z < iz1; z += 0.5) for (let x = ix0; x < ix1; x += 0.5) for (const rot of [0, 90]) {
    const { hw, hd } = footprint({ ...item, rot }); cands.push({ rot, x: x + hw, y: z + hd });
  }
  const snap = v => Math.round(v * 12) / 12;
  for (const c of cands) { const s = { rot: c.rot, x: snap(c.x), y: snap(c.y) }; if (ok(s)) return s; }
  return null;
}

// ---------- "Will it fit?" ----------
/** Doors on the outside of the house (no room on the other side). */
export function exteriorDoors(rooms) {
  const out = [];
  for (const r of rooms) for (const d of r.doors || []) {
    const h = d.wall === 'n' || d.wall === 's';
    const mid = (h ? r.x : r.y) + (d.offset || 0) + d.width / 2;
    const px = h ? mid : d.wall === 'w' ? r.x - 1 : r.x + r.w + 1;
    const py = h ? (d.wall === 'n' ? r.y - 1 : r.y + r.d + 1) : mid;
    if (!rooms.some(q => q !== r && px > q.x && px < q.x + q.w && py > q.y && py < q.y + q.d)) out.push({ ...d, roomId: r.id });
  }
  return out;
}

/** room in feet, item in INCHES {w,d,h,kind,moveDims?}, entryDoors from exteriorDoors(). */
export function checkFit(room, item, entryDoors = []) {
  const RW = room.w * 12 - WALL_T * 12, RD = room.d * 12 - WALL_T * 12; // interior, inside the wall faces
  const c = { side: 0, front: 0, back: 0, why: '', ...(CLEARANCE[item.kind] || { front: 30, why: '30" in front' }) };
  const opts = [
    { rot: 0, along: [item.w, item.d], need: [item.w + 2 * c.side, item.d + c.front + c.back] },
    { rot: 90, along: [item.d, item.w], need: [item.d + c.front + c.back, item.w + 2 * c.side] },
  ].map(o => ({
    ...o,
    raw: o.along[0] <= RW && o.along[1] <= RD,
    comfy: o.need[0] <= RW && o.need[1] <= RD,
    spare: [RW - o.along[0], RD - o.along[1]],
    short: Math.max(0, o.need[0] - RW, o.need[1] - RD),
  }));
  const best = opts.find(o => o.comfy) || opts.find(o => o.raw) ||
    opts.reduce((a, b) => Math.min(...a.spare) > Math.min(...b.spare) ? a : b);

  // Doorway: the item has to get through the widest way into the house AND the widest way into the room.
  const dims = [...(item.moveDims || [item.w, item.d, item.h])].sort((a, b) => a - b);
  // Upholstered seating usually has 4–6" removable legs, which movers take off at the door.
  const legs = ['sofa', 'sectional', 'chair'].includes(item.kind) ? 5 : 0;
  const rank = { yes: 2, tight: 1, no: 0 };
  const judge = (dr, where) => {
    const isDoor = (dr.type || 'door') === 'door';
    const clearW = dr.width * 12 - (isDoor ? 2 : 0), clearH = isDoor ? 80 : DOOR_H * 12;
    const margin = clearW - dims[0], hOk = dims[1] <= clearH;
    const status = !hOk ? 'no' : margin >= 1 ? 'yes' : (margin + legs >= 0 || margin >= -1) ? 'tight' : 'no';
    return { width: dr.width * 12, clearW, type: dr.type || 'door', where, thinnest: dims[0], margin, status, legs, moveLabel: item.moveLabel, moveNote: item.moveNote };
  };
  const widest = list => list.length ? list.reduce((a, b) => (b.width > a.width ? b : a)) : null;
  const roomDoor = widest(room.doors || []), entryDoor = widest(entryDoors.filter(d => d.roomId !== room.id));
  const cands = [roomDoor && judge(roomDoor, 'room'), entryDoor && judge(entryDoor, 'entry')].filter(Boolean);
  const door = cands.length ? cands.reduce((a, b) => (rank[b.status] < rank[a.status] || (rank[b.status] === rank[a.status] && b.margin < a.margin) ? b : a)) : null;
  if (door && cands.length > 1) door.other = cands.find(c => c !== door);
  const verdict = !best.raw ? 'no' : !best.comfy ? 'fits' : (!door || door.status === 'yes') ? 'great' : 'door';
  return { RW, RD, c, best, opts, door, verdict };
}

// ---------- share-a-layout links ----------
export function encodeLayout(furn) {
  const arr = furn.map(f => [f.key || '', f.kind, f.name, +f.w.toFixed(3), +f.d.toFixed(3), +f.h.toFixed(3), +f.x.toFixed(2), +f.y.toFixed(2), f.rot || 0, f.shape || '', f.level ?? 1]);
  return btoa(unescape(encodeURIComponent(JSON.stringify(arr)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeLayout(s) {
  try {
    const json = decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
    return JSON.parse(json).map(([key, kind, name, w, d, h, x, y, rot, shape, level]) =>
      ({ id: uid('f'), key, kind, name, w, d, h, x, y, rot, shape: shape || undefined, ...(level != null && level !== 1 ? { level } : {}) }));
  } catch { return null; }
}
