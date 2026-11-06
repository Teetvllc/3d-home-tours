// 2D floor-plan editor on a <canvas>. Rooms are rectangles in feet drawn over the uploaded plan image.
// Tools: select (move/resize/pan), room (drag a new room), door (click a wall), calibrate (drag along a known length).
import { uid, fmtFt, parseFt, defaultFloorFor } from './model.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class PlanEditor extends EventTarget {
  constructor(canvas, getListing) {
    super();
    this.cv = canvas; this.g = canvas.getContext('2d'); this.getL = getListing;
    this.tool = 'select'; this.level = 1; this.zoom = 10; this.panX = -5; this.panY = -5; this.selId = null; this.img = null; this.act = null;
    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', () => { this.act = null; this.draw(); });
    canvas.addEventListener('wheel', e => this._wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this._ro = new ResizeObserver(() => this.draw()); this._ro.observe(canvas);
  }

  get L() { return this.getL(); }
  /** Rooms on the floor being edited. */
  rooms() { return (this.L?.rooms || []).filter(r => (r.level ?? 1) === this.level); }
  levels() { const s = [...new Set((this.L?.rooms || []).map(r => r.level ?? 1))]; if (!s.includes(this.level)) s.push(this.level); return s.sort((a, b) => a - b); }
  setLevel(n) { this.level = n; this.select(null); this.dispatchEvent(new CustomEvent('level', { detail: n })); this.fit(); }
  setTool(t) { this.tool = t; this.cv.style.cursor = t === 'select' ? 'default' : 'crosshair'; this.dispatchEvent(new CustomEvent('tool', { detail: t })); this.draw(); }
  select(id) { this.selId = id; this.dispatchEvent(new CustomEvent('select', { detail: id })); this.draw(); }
  _changed() { this.dispatchEvent(new CustomEvent('change')); this.draw(); }

  setImage(src) {
    if (!src) { this.img = null; this.draw(); return Promise.resolve(); }
    return new Promise(res => { const i = new Image(); i.onload = () => { this.img = i; this.draw(); res(); }; i.onerror = () => { this.img = null; this.draw(); res(); }; i.src = src; });
  }
  imgRect() {
    const p = this.L.plan; if (!this.img || !p) return null;
    return { x: p.offsetX || 0, y: p.offsetY || 0, w: this.img.naturalWidth / p.scale, h: this.img.naturalHeight / p.scale };
  }

  fit() {
    const rooms = this.rooms(); const ir = this.imgRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rooms) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.d); }
    if (ir) { x0 = Math.min(x0, ir.x); y0 = Math.min(y0, ir.y); x1 = Math.max(x1, ir.x + ir.w); y1 = Math.max(y1, ir.y + ir.h); }
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 40; y1 = 30; }
    const W = this.cv.clientWidth, H = this.cv.clientHeight, m = 3;
    this.zoom = Math.max(2, Math.min(W / (x1 - x0 + 2 * m), (H - 60) / (y1 - y0 + 2 * m)));
    this.panX = (x0 + x1) / 2 - W / 2 / this.zoom; this.panY = (y0 + y1) / 2 - (H + 20) / 2 / this.zoom;
    this.draw();
  }

  // ---------- coordinates ----------
  _pt(e) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / this.zoom + this.panX, y: (e.clientY - r.top) / this.zoom + this.panY }; }
  sx(x) { return (x - this.panX) * this.zoom; }
  sy(y) { return (y - this.panY) * this.zoom; }
  _snapAxis(v, axis, excludeId) {
    const tol = 8 / this.zoom;
    let best = null;
    for (const r of this.rooms()) {
      if (r.id === excludeId) continue;
      for (const c of axis === 'x' ? [r.x, r.x + r.w] : [r.y, r.y + r.d]) if (Math.abs(c - v) < tol && (!best || Math.abs(c - v) < Math.abs(best - v))) best = c;
    }
    return best;
  }
  _snap(v, axis, id) { const s = this._snapAxis(v, axis, id); return s ?? Math.round(v * 4) / 4; }

  _roomAt(p) { return [...this.rooms()].sort((a, b) => a.w * a.d - b.w * b.d).find(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.d); }
  _handleAt(p) {
    const r = this.L.rooms.find(q => q.id === this.selId); if (!r) return null;
    const tol = 8 / this.zoom;
    for (const h of HANDLES) {
      const hx = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
      const hy = h.includes('n') ? r.y : h.includes('s') ? r.y + r.d : r.y + r.d / 2;
      if (Math.abs(p.x - hx) < tol && Math.abs(p.y - hy) < tol) return h;
    }
    return null;
  }
  _nearestWall(p) {
    let best = null;
    for (const r of this.rooms()) for (const wall of ['n', 's', 'w', 'e']) {
      const h = wall === 'n' || wall === 's';
      const c = wall === 'n' ? r.y : wall === 's' ? r.y + r.d : wall === 'w' ? r.x : r.x + r.w;
      const a = h ? r.x : r.y, b = a + (h ? r.w : r.d), along = h ? p.x : p.y, perp = h ? p.y : p.x;
      if (along < a || along > b) continue;
      let dist = Math.abs(perp - c);
      if (r.id === this.selId) dist -= 0.01; // prefer the selected room on shared walls
      if (!best || dist < best.dist) best = { room: r, wall, dist, along: along - a, len: b - a };
    }
    return best && best.dist < Math.max(1, 14 / this.zoom) ? best : null;
  }

  // ---------- pointer ----------
  _down(e) {
    this.cv.setPointerCapture(e.pointerId);
    const p = this._pt(e);
    if (e.button === 1 || e.button === 2) { this.act = { type: 'pan', cx: e.clientX, cy: e.clientY, px: this.panX, py: this.panY }; return; }
    if (this.tool === 'room') { const x = this._snap(p.x, 'x'), y = this._snap(p.y, 'y'); this.act = { type: 'new', x0: x, y0: y, x1: x, y1: y }; return; }
    if (this.tool === 'calibrate') { this.act = { type: 'calib', a: p, b: p }; return; }
    if (this.tool === 'door') {
      const hit = this._nearestWall(p);
      if (hit) {
        const width = Math.min(2.67, hit.len);
        hit.room.doors = hit.room.doors || [];
        hit.room.doors.push({ wall: hit.wall, offset: Math.round(Math.max(0, Math.min(hit.len - width, hit.along - width / 2)) * 4) / 4, width, type: 'door' });
        this.select(hit.room.id); this._changed();
      }
      return;
    }
    const h = this._handleAt(p);
    if (h) { const r = this.L.rooms.find(q => q.id === this.selId); this.act = { type: 'resize', h, r, o: { ...r } }; return; }
    const r = this._roomAt(p);
    if (r) { this.select(r.id); this.act = { type: 'move', r, start: p, o: { x: r.x, y: r.y }, moved: false }; return; }
    this.select(null);
    this.act = { type: 'pan', cx: e.clientX, cy: e.clientY, px: this.panX, py: this.panY };
  }
  _move(e) {
    const p = this._pt(e), a = this.act;
    if (!a) {
      if (this.tool === 'select') { const h = this._handleAt(p); this.cv.style.cursor = h ? ({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' }[h] + '-resize') : this._roomAt(p) ? 'move' : 'grab'; }
      if (this.tool === 'door') { this._hover = this._nearestWall(p); this.draw(); }
      return;
    }
    if (a.type === 'pan') { this.panX = a.px - (e.clientX - a.cx) / this.zoom; this.panY = a.py - (e.clientY - a.cy) / this.zoom; }
    else if (a.type === 'new') { a.x1 = this._snap(p.x, 'x'); a.y1 = this._snap(p.y, 'y'); }
    else if (a.type === 'calib') { a.b = p; }
    else if (a.type === 'move') {
      const r = a.r; let nx = a.o.x + p.x - a.start.x, ny = a.o.y + p.y - a.start.y;
      const lx = this._snapAxis(nx, 'x', r.id), rx = this._snapAxis(nx + r.w, 'x', r.id);
      nx = lx ?? (rx != null ? rx - r.w : Math.round(nx * 4) / 4);
      const ty = this._snapAxis(ny, 'y', r.id), by = this._snapAxis(ny + r.d, 'y', r.id);
      ny = ty ?? (by != null ? by - r.d : Math.round(ny * 4) / 4);
      if (nx !== r.x || ny !== r.y) a.moved = true;
      // move furniture that sits in this room along with it
      const dx = nx - r.x, dy = ny - r.y;
      for (const f of this.L.furniture || []) if ((f.level ?? 1) === this.level && f.x > r.x && f.x < r.x + r.w && f.y > r.y && f.y < r.y + r.d) { f.x += dx; f.y += dy; }
      r.x = nx; r.y = ny;
    } else if (a.type === 'resize') {
      const r = a.r, o = a.o, h = a.h;
      if (h.includes('w')) { const x = Math.min(this._snap(p.x, 'x', r.id), o.x + o.w - 1); r.x = x; r.w = o.x + o.w - x; }
      if (h.includes('e')) { r.w = Math.max(1, this._snap(p.x, 'x', r.id) - o.x); }
      if (h.includes('n')) { const y = Math.min(this._snap(p.y, 'y', r.id), o.y + o.d - 1); r.y = y; r.d = o.y + o.d - y; }
      if (h.includes('s')) { r.d = Math.max(1, this._snap(p.y, 'y', r.id) - o.y); }
      this.dispatchEvent(new CustomEvent('live', { detail: r.id }));
    }
    this.draw();
  }
  _up() {
    const a = this.act; this.act = null; if (!a) return;
    if (a.type === 'new') {
      const x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1), w = Math.abs(a.x1 - a.x0), d = Math.abs(a.y1 - a.y0);
      if (w >= 2 && d >= 2) {
        const name = `Room ${this.L.rooms.length + 1}`;
        const r = { id: uid('r'), name, floor: defaultFloorFor(name), x, y, w, d, doors: [], ...(this.level !== 1 ? { level: this.level } : {}) };
        this.L.rooms.push(r); this.setTool('select'); this.select(r.id); this._changed();
        this.dispatchEvent(new CustomEvent('created', { detail: r.id }));
      }
    } else if (a.type === 'calib') {
      const len = Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y);
      this.draw();
      if (len * this.zoom > 15) {
        setTimeout(() => {
          const ans = prompt('How long is the line you just drew, in real life?\nExamples: 14\' 6"   or   14.5', '');
          const real = parseFt(ans);
          if (real > 0) this.calibrate(len, real);
          this.setTool('select');
        }, 30);
      }
    } else if (a.type === 'move' && a.moved) this._changed();
    else if (a.type === 'resize') this._changed();
    this.draw();
  }
  /** Rescale the plan image (and anything already traced on it) so `measured` ft becomes `real` ft. */
  calibrate(measured, real) {
    const L = this.L, p = L.plan; if (!p) return;
    const k = real / measured, ox = p.offsetX || 0, oy = p.offsetY || 0;
    p.scale /= k; p.calibrated = true;
    const r4 = v => Math.round(v * 4) / 4;
    for (const r of L.rooms) {
      r.x = r4(ox + (r.x - ox) * k); r.y = r4(oy + (r.y - oy) * k); r.w = r4(r.w * k); r.d = r4(r.d * k);
      for (const d of r.doors || []) d.offset = r4(d.offset * k);
    }
    for (const f of L.furniture || []) { f.x = ox + (f.x - ox) * k; f.y = oy + (f.y - oy) * k; }
    this._changed(); this.fit();
    this.dispatchEvent(new CustomEvent('calibrated', { detail: { k } }));
  }
  _wheel(e) {
    e.preventDefault();
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const fx = mx / this.zoom + this.panX, fy = my / this.zoom + this.panY;
    this.zoom = Math.max(1.5, Math.min(120, this.zoom * Math.exp(-e.deltaY * 0.0015)));
    this.panX = fx - mx / this.zoom; this.panY = fy - my / this.zoom; this.draw();
  }

  // ---------- drawing ----------
  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#f3f4f2'; g.fillRect(0, 0, W, H);
    const L = this.L; if (!L) return;
    const z = this.zoom;
    // grid
    const step = z > 14 ? 1 : z > 5 ? 2 : 5;
    g.lineWidth = 1;
    for (let x = Math.floor(this.panX / step) * step; this.sx(x) < W; x += step) { g.strokeStyle = x % 10 === 0 ? '#dcdfdc' : '#e8eae8'; g.beginPath(); g.moveTo(this.sx(x) + .5, 0); g.lineTo(this.sx(x) + .5, H); g.stroke(); }
    for (let y = Math.floor(this.panY / step) * step; this.sy(y) < H; y += step) { g.strokeStyle = y % 10 === 0 ? '#dcdfdc' : '#e8eae8'; g.beginPath(); g.moveTo(0, this.sy(y) + .5); g.lineTo(W, this.sy(y) + .5); g.stroke(); }
    // plan image
    const ir = this.imgRect();
    if (ir) { g.globalAlpha = L.plan.opacity ?? 0.8; g.drawImage(this.img, this.sx(ir.x), this.sy(ir.y), ir.w * z, ir.h * z); g.globalAlpha = 1; }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f6f5c';
    // rooms
    for (const r of this.rooms()) {
      const sel = r.id === this.selId;
      g.fillStyle = sel ? hexA(accent, 0.22) : hexA(accent, 0.10);
      g.fillRect(this.sx(r.x), this.sy(r.y), r.w * z, r.d * z);
      g.strokeStyle = sel ? accent : '#2b3a42'; g.lineWidth = sel ? 3 : 2;
      g.strokeRect(this.sx(r.x), this.sy(r.y), r.w * z, r.d * z);
    }
    // doors
    for (const r of this.rooms()) for (const d of r.doors || []) this._drawDoor(r, d, d.type === 'opening' ? '#3d8bd4' : '#e07b1a');
    if (this.tool === 'door' && this._hover) {
      const h = this._hover, width = Math.min(2.67, h.len);
      this._drawDoor(h.room, { wall: h.wall, offset: Math.max(0, Math.min(h.len - width, h.along - width / 2)), width }, 'rgba(224,123,26,.5)');
    }
    // labels
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const r of this.rooms()) {
      const cx = this.sx(r.x + r.w / 2), cy = this.sy(r.y + r.d / 2), fs = Math.max(9, Math.min(14, z * 0.9));
      if (r.w * z < 30 || r.d * z < 20) continue;
      g.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      const t1 = r.name, t2 = `${fmtFt(r.w)} × ${fmtFt(r.d)}`;
      const tw = Math.max(g.measureText(t1).width, g.measureText(t2).width) + 10;
      g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(cx - tw / 2, cy - fs - 2, tw, fs * 2 + 6);
      g.fillStyle = '#1d2327'; g.fillText(t1, cx, cy - fs / 2 + 1);
      g.font = `400 ${fs - 1}px Inter, system-ui, sans-serif`; g.fillStyle = '#4c565d'; g.fillText(t2, cx, cy + fs / 2 + 2);
    }
    // handles
    const s = L.rooms.find(r => r.id === this.selId);
    if (s && this.tool === 'select') for (const h of HANDLES) {
      const hx = h.includes('w') ? s.x : h.includes('e') ? s.x + s.w : s.x + s.w / 2;
      const hy = h.includes('n') ? s.y : h.includes('s') ? s.y + s.d : s.y + s.d / 2;
      g.fillStyle = '#fff'; g.strokeStyle = accent; g.lineWidth = 2;
      g.fillRect(this.sx(hx) - 5, this.sy(hy) - 5, 10, 10); g.strokeRect(this.sx(hx) - 5, this.sy(hy) - 5, 10, 10);
    }
    // in-progress
    const a = this.act;
    if (a?.type === 'new') {
      const x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1), w = Math.abs(a.x1 - a.x0), d = Math.abs(a.y1 - a.y0);
      g.setLineDash([6, 4]); g.strokeStyle = accent; g.lineWidth = 2; g.strokeRect(this.sx(x), this.sy(y), w * z, d * z); g.setLineDash([]);
      g.font = '600 13px Inter, system-ui'; g.fillStyle = '#1d2327'; g.fillText(`${fmtFt(w)} × ${fmtFt(d)}`, this.sx(x + w / 2), this.sy(y + d / 2));
    }
    if (a?.type === 'calib') {
      g.strokeStyle = '#d02b2b'; g.lineWidth = 3; g.setLineDash([8, 5]);
      g.beginPath(); g.moveTo(this.sx(a.a.x), this.sy(a.a.y)); g.lineTo(this.sx(a.b.x), this.sy(a.b.y)); g.stroke(); g.setLineDash([]);
      for (const q of [a.a, a.b]) { g.fillStyle = '#d02b2b'; g.beginPath(); g.arc(this.sx(q.x), this.sy(q.y), 4, 0, 7); g.fill(); }
    }
  }
  _drawDoor(r, d, color) {
    const g = this.g, h = d.wall === 'n' || d.wall === 's';
    const c = d.wall === 'n' ? r.y : d.wall === 's' ? r.y + r.d : d.wall === 'w' ? r.x : r.x + r.w;
    const a = (h ? r.x : r.y) + (d.offset || 0), b = a + d.width;
    g.strokeStyle = color; g.lineWidth = 6; g.lineCap = 'butt';
    g.beginPath();
    if (h) { g.moveTo(this.sx(a), this.sy(c)); g.lineTo(this.sx(b), this.sy(c)); }
    else { g.moveTo(this.sx(c), this.sy(a)); g.lineTo(this.sx(c), this.sy(b)); }
    g.stroke();
  }
}

function hexA(hex, a) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(31,111,92,${a})`;
}
