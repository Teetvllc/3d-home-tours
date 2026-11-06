// Shared UI: "Will it fit?" checker and the furniture panel. Used by the viewer and the builder.
import { CATALOG, catalogItem, checkFit, exteriorDoors, makeItem, fmtFt, fmtIn, parseIn, roomAt } from './model.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const groups = () => [...new Set(CATALOG.map(c => c.group))];
const catalogOptions = (filter = () => true) => groups().map(g =>
  `<optgroup label="${g}">${CATALOG.filter(c => c.group === g && filter(c)).map(c => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
const roomOptions = (rooms, sel) => rooms.map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)} — ${fmtFt(r.w)} × ${fmtFt(r.d)}</option>`).join('');

function defaultRoomFor(viewer, key) {
  const rooms = viewer.rooms;
  if (viewer.currentRoomId) return viewer.currentRoomId;
  const want = /bed-/.test(key) ? /primary|master|bed/i : /sofa|sectional|tv|coffee|armchair|piano/.test(key) ? /living|family|great/i
    : /dining/.test(key) ? /dining/i : /desk|shelf/.test(key) ? /office|den|study/i : null;
  return (want && rooms.find(r => want.test(r.name)))?.id || rooms[0]?.id;
}

// ============================ FIT CHECKER ============================
export function mountFitPanel(el, { viewer, onPlaced }) {
  el.innerHTML = `
    <p class="muted">Pick a piece (or type your own measurements) and a room. We check the room size, walkway space, and whether it gets through the doorway.</p>
    <label class="fld">What are you bringing?
      <select data-k="item">${catalogOptions(c => c.kind !== 'rug' && c.kind !== 'plant')}<option value="custom">Custom size…</option></select></label>
    <div class="dims">
      <label class="fld">Width<input data-k="w" inputmode="decimal"><small>inches</small></label>
      <label class="fld">Depth<input data-k="d" inputmode="decimal"><small>inches</small></label>
      <label class="fld">Height<input data-k="h" inputmode="decimal"><small>inches</small></label>
    </div>
    <label class="fld">Which room?<select data-k="room"></select></label>
    <button class="btn primary block" data-act="check" type="button">Check fit</button>
    <div class="fit-result" data-k="result" aria-live="polite"></div>`;
  const $ = k => el.querySelector(`[data-k="${k}"]`);
  const sel = $('item');
  sel.value = 'bed-queen';
  const fillDims = () => { const c = catalogItem(sel.value); if (c) { $('w').value = c.w; $('d').value = c.d; $('h').value = c.h; } };
  fillDims();
  sel.onchange = () => { fillDims(); $('room').value = defaultRoomFor(viewer, sel.value) || $('room').value; $('result').innerHTML = ''; };
  const refreshRooms = () => { const cur = $('room').value; $('room').innerHTML = roomOptions(viewer.rooms, cur || defaultRoomFor(viewer, sel.value)); };
  refreshRooms();

  const current = () => {
    const cat = catalogItem(sel.value);
    const w = parseIn($('w').value), d = parseIn($('d').value), h = parseIn($('h').value) || 30;
    const unchanged = cat && w === cat.w && d === cat.d && h === cat.h;
    return { key: cat?.key || 'custom', label: cat?.label || 'Custom item', kind: cat?.kind || 'box', shape: cat?.shape, w, d, h, ...(unchanged ? { moveDims: cat.moveDims, moveLabel: cat.moveLabel, moveNote: cat.moveNote } : {}) };
  };

  el.querySelector('[data-act="check"]').onclick = () => {
    const item = current(), room = viewer.rooms.find(r => r.id === $('room').value), out = $('result');
    if (!(item.w > 0 && item.d > 0)) { out.innerHTML = '<p class="bad-text">Enter a width and depth in inches (e.g. 84).</p>'; return; }
    if (!room) { out.innerHTML = '<p class="bad-text">This listing has no rooms yet.</p>'; return; }
    const r = checkFit(room, item, exteriorDoors(viewer.rooms)), b = r.best;
    const V = { great: ['ok', 'Fits comfortably'], door: ['warn', 'Fits the room — the doorway is the tricky part'], fits: ['warn', 'Fits — but it\'s snug'], no: ['bad', 'Won\'t fit in this room'] }[r.verdict];
    const roomW = fmtFt(room.w), roomD = fmtFt(room.d);
    const orient = b.rot === 0
      ? `${fmtIn(item.w)} side along the ${roomW} wall`
      : `${fmtIn(item.w)} side along the ${roomD} wall`;
    const lines = [];
    lines.push(b.raw
      ? `<li class="ok-li"><b>Room size:</b> fits with the ${orient} — ${fmtIn(b.spare[0])} to spare one way, ${fmtIn(b.spare[1])} the other.</li>`
      : `<li class="bad-li"><b>Room size:</b> this ${roomW} × ${roomD} room is too small — short by ${fmtIn(Math.max(-Math.min(...b.spare), 0))} even turned the best way.</li>`);
    if (b.raw && r.c.why) lines.push(b.comfy
      ? `<li class="ok-li"><b>Walkways:</b> leaves ${r.c.why}.</li>`
      : `<li class="warn-li"><b>Walkways:</b> you'd be ${fmtIn(b.short)} short of ${r.c.why}.</li>`);
    if (r.door) {
      const d = r.door, what = d.moveLabel ? `${d.moveLabel} (thinnest side ${fmtIn(d.thinnest)})` : `Turned on its side, its thinnest dimension (${fmtIn(d.thinnest)})`;
      const note = d.moveNote ? ' ' + d.moveNote : '';
      const opening = `the ${fmtIn(d.width)} ${d.where === 'entry' ? 'front/exterior door' : d.type === 'door' ? 'door into this room' : 'opening into this room'} (~${fmtIn(d.clearW)} clear)`;
      const also = d.other && d.other.status === 'yes' ? ` The ${d.other.where === 'entry' ? 'exterior door' : 'room\'s doorway'} (${fmtIn(d.other.width)}) is fine.` : '';
      lines.push({
        yes: `<li class="ok-li"><b>Getting it in:</b> ${what} fits through ${opening}${d.other ? ' — the tightest spot on the way in' : ''}.${note}</li>`,
        tight: `<li class="warn-li"><b>Getting it in:</b> tight squeeze. ${what} vs ${opening}. ${d.legs ? 'Taking the legs off (usually 4–6") should get it through' : 'Taking the door off its hinges usually gains about 2"'} — measure first.${also}</li>`,
        no: `<li class="bad-li"><b>Getting it in:</b> ${what} is too big for ${opening}. It would need to come apart or come in another way.${also}</li>`,
      }[d.status]);
    } else lines.push('<li class="muted">No doorway is marked for this room, so the doorway check was skipped.</li>');
    out.innerHTML = `<div class="verdict ${V[0]}">${V[1]}</div><ul class="fit-lines">${lines.join('')}</ul>
      ${b.raw ? '<button class="btn block" data-act="place" type="button">Show it in 3D</button>' : ''}
      <p class="fine">Measurements come from the listing's floor plan and are approximate. Always measure before you buy or move.</p>`;
    out.querySelector('[data-act="place"]')?.addEventListener('click', () => {
      const { placed, item: f } = viewer.addItem(makeItem({ ...item, label: item.label }), room.id);
      viewer.goToRoom(room.id);
      onPlaced?.(f, placed);
    });
  };
  return { refreshRooms };
}

// ============================ FURNITURE ============================
export function mountFurniturePanel(el, { viewer, extraButtons = '' }) {
  el.innerHTML = `
    <label class="fld">Add to room<select data-k="room"></select></label>
    <div class="catalog">${groups().map(g => `<h4>${g}</h4><div class="chips">${CATALOG.filter(c => c.group === g)
      .map(c => `<button type="button" class="chip" data-add="${c.key}">${esc(c.label)}</button>`).join('')}</div>`).join('')}</div>
    <div class="sel-card" data-k="sel" hidden></div>
    <h4 class="list-h">In this home <span data-k="count"></span></h4>
    <div class="placed" data-k="list"></div>
    <div class="row-btns">${extraButtons}</div>
    <p class="fine">Tip: drag pieces in Dollhouse view. <kbd>R</kbd> rotates, <kbd>Del</kbd> removes. Red means it overlaps a wall or another piece.</p>`;
  const $ = k => el.querySelector(`[data-k="${k}"]`);
  const refreshRooms = () => { const cur = $('room').value; $('room').innerHTML = roomOptions(viewer.rooms, cur || viewer.currentRoomId || viewer.rooms[0]?.id); };
  refreshRooms();
  viewer.addEventListener('roomclick', e => { $('room').value = e.detail; });

  el.querySelector('.catalog').addEventListener('click', e => {
    const key = e.target.closest('[data-add]')?.dataset.add; if (!key) return;
    const roomId = $('room').value || defaultRoomFor(viewer, key);
    const { placed } = viewer.addItem(makeItem(catalogItem(key)), roomId);
    if (viewer.mode !== 'walk') viewer.goToRoom(roomId);
    if (!placed) toast(el, 'No clear spot left in that room — it\'s shown in red. Drag it somewhere, or try a bigger room.');
  });

  const renderSel = f => {
    const box = $('sel');
    if (!f) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="sel-head"><input class="sel-name" data-f="name" value="${esc(f.name)}" aria-label="Name"><button type="button" class="icon-btn" data-a="close" title="Deselect">✕</button></div>
      <div class="dims">
        <label class="fld">W<input data-f="w" value="${Math.round(f.w * 12)}" inputmode="decimal"><small>in</small></label>
        <label class="fld">D<input data-f="d" value="${Math.round(f.d * 12)}" inputmode="decimal"><small>in</small></label>
        <label class="fld">H<input data-f="h" value="${Math.round(f.h * 12)}" inputmode="decimal"><small>in</small></label>
      </div>
      ${f._bad ? '<p class="bad-text">Overlaps a wall or another piece.</p>' : ''}
      <div class="row-btns"><button type="button" class="btn" data-a="rotl">⟲ Rotate</button><button type="button" class="btn" data-a="rotr">⟳ Rotate</button><button type="button" class="btn danger" data-a="del">Remove</button></div>`;
    box.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.f;
      if (k === 'name') return viewer.updateItem(f.id, { name: inp.value });
      const v = parseIn(inp.value); if (v > 0) viewer.updateItem(f.id, { [k]: v / 12 });
    });
    box.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'rotl') viewer.rotateSelected(-90); else if (a === 'rotr') viewer.rotateSelected(90);
      else if (a === 'del') viewer.removeItem(); else if (a === 'close') viewer.select(null);
    };
  };
  const renderList = () => {
    const items = viewer.furniture;
    $('count').textContent = `(${items.length})`;
    $('list').innerHTML = items.length ? items.map(f => {
      const rm = roomAt(viewer.rooms, f.x, f.y);
      return `<button type="button" class="placed-item ${f.id === viewer.selectedId ? 'on' : ''} ${f._bad ? 'bad' : ''}" data-id="${f.id}">
        <span>${esc(f.name)}</span><small>${rm ? esc(rm.name) : 'Outside'} · ${Math.round(f.w * 12)}×${Math.round(f.d * 12)}"</small></button>`;
    }).join('') : '<p class="muted">No furniture yet — tap a piece above to add it.</p>';
  };
  $('list').onclick = e => {
    const id = e.target.closest('[data-id]')?.dataset.id; if (!id) return;
    viewer.select(id); const rm = viewer.roomOf(viewer.get(id)); if (rm && viewer.mode !== 'walk') viewer.goToRoom(rm.id);
  };
  viewer.addEventListener('select', e => { renderSel(e.detail && viewer.get(e.detail.id)); renderList(); });
  viewer.addEventListener('change', () => {
    renderList();
    const f = viewer.get(viewer.selectedId);
    const box = $('sel');
    if (f && !box.contains(document.activeElement)) renderSel(f);
  });
  renderList();
  return { refreshRooms, renderList };
}

export function toast(anchor, msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3800);
}
