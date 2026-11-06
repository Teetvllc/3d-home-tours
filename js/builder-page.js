// Builder: make a listing.json from a floor plan image, room sizes, photos and branding.
import { PlanEditor } from './plan-editor.js';
import { HomeViewer } from './viewer3d.js';
import { mountFitPanel, mountFurniturePanel, toast } from './panels.js';
import { fetchListing, listingUrl, inlineAssets, fileToDataURL, idbGet, idbSet, fetchBrandDefaults, lsGet, lsSet } from './store.js';
import { uid, fmtFt, parseFt, parseIn, FLOORS, defaultFloorFor, bounds } from './model.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

let L = null, brandDefaults = {}, viewer = null, furnPanel = null, fitPanel = null;

function blankListing() {
  const mine = lsGet('myBranding') || {};
  return {
    version: 1, slug: '',
    details: { address: '', city: '', price: '', beds: '', baths: '', sqft: '' },
    plan: null, rooms: [], photos: [], furniture: [],
    branding: {
      presenter: { ...(brandDefaults.presenter || {}), ...(mine.presenter || {}) },
      agent: {},
      accent: mine.accent || brandDefaults.accent || '#1f6f5c',
      disclaimer: mine.disclaimer ?? brandDefaults.disclaimer ?? '',
    },
  };
}
function normalize(x) {
  const b = blankListing();
  const out = { ...b, ...x, details: { ...b.details, ...(x.details || {}) }, branding: { ...b.branding, ...(x.branding || {}) } };
  out.branding.presenter = { ...(x.branding?.presenter || b.branding.presenter) };
  out.branding.agent = { ...(x.branding?.agent || {}) };
  out.rooms = (x.rooms || []).map(r => ({ doors: [], floor: defaultFloorFor(r.name), ...r }));
  out.photos = x.photos || []; out.furniture = x.furniture || [];
  return out;
}

// ---------- persistence ----------
let saveTimer;
function save(now) {
  clearTimeout(saveTimer);
  const go = async () => { const ok = await idbSet('draft', L); $('status').textContent = ok ? `Draft saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Draft not saved (storage blocked)'; };
  if (now) return go();
  $('status').textContent = 'Saving…'; saveTimer = setTimeout(go, 500);
}
function changed() { save(); renderPublish(); }

async function setListing(x, msg) {
  L = normalize(x);
  document.documentElement.style.setProperty('--accent', L.branding.accent || '#1f6f5c');
  fillPaths(); renderPlanInfo(); renderRooms(); renderPhotos(); renderPublish();
  await editor.setImage(L.plan?.src); editor.select(null); editor.fit();
  if (!$('threePane').hidden) refresh3D();
  save(true); if (msg) toast(null, msg);
}

// ---------- generic [data-path] fields ----------
function fillPaths() {
  document.querySelectorAll('[data-path]').forEach(el => { const v = getPath(L, el.dataset.path); el.value = v ?? (el.type === 'color' ? '#1f6f5c' : ''); });
}
document.querySelectorAll('[data-path]').forEach(el => el.addEventListener('input', () => {
  const p = el.dataset.path;
  setPath(L, p, el.value);
  if (p === 'details.address' && (!L.slug || L._autoSlug)) { L.slug = slugify(el.value); L._autoSlug = true; $('slug').value = L.slug; }
  if (p === 'slug') { L.slug = slugify(el.value); L._autoSlug = false; }
  if (p === 'branding.accent') { document.documentElement.style.setProperty('--accent', el.value); editor.draw(); }
  changed();
}));
$('slug').addEventListener('change', e => { e.target.value = L.slug; });

// ---------- plan image ----------
const editor = new PlanEditor($('planCanvas'), () => L);
window.planEditor = editor; // handy for debugging
const HELP = {
  select: 'Drag a room to move it, drag its handles to resize. Drag empty space to pan, scroll to zoom. <kbd>Del</kbd> deletes the selected room.',
  room: 'Drag a rectangle over a room on the plan. It snaps to neighboring rooms so walls line up.',
  door: 'Click on a wall to add a 32" door there (orange). Fine-tune or switch it to an open archway (blue) in the room panel.',
  calibrate: 'Drag along a wall whose length you know (e.g. a room labeled 14\' × 12\'), then type the real length.',
};
editor.addEventListener('tool', e => {
  $('toolSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tool === e.detail));
  $('planHelp').innerHTML = HELP[e.detail];
});
$('toolSeg').onclick = e => { const t = e.target.closest('[data-tool]')?.dataset.tool; if (t) editor.setTool(t); };
$('fitView').onclick = () => editor.fit();
editor.setTool('select');
editor.addEventListener('change', () => { renderRooms(); changed(); });
editor.addEventListener('live', () => renderRoomEditor());
editor.addEventListener('select', () => renderRooms());
editor.addEventListener('calibrated', () => { renderPlanInfo(); toast(null, 'Scale set. Rooms you trace now will have true dimensions.'); });
editor.addEventListener('created', () => { $('roomsSection').open = true; setTimeout(() => $('roomEdit').querySelector('[data-rf="name"]')?.select(), 50); });

$('planFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const img = await fileToDataURL(f, 2400, 0.9);
    const keepScale = L.plan?.calibrated && L.rooms.length;
    L.plan = { src: img.src, scale: keepScale ? L.plan.scale : img.width / 60, offsetX: 0, offsetY: 0, opacity: 0.8, calibrated: false };
    await editor.setImage(img.src); editor.fit(); renderPlanInfo(); changed();
    editor.setTool('calibrate');
    toast(null, 'Now calibrate: drag along one wall whose length you know.');
  } catch (err) { toast(null, err.message); }
};
function renderPlanInfo() {
  const p = L.plan, el = $('planInfo');
  if (!p) { el.innerHTML = '<p class="fine">Optional, but makes tracing fast. No plan? Just add rooms by size in step 3.</p>'; return; }
  el.innerHTML = `
    ${p.calibrated ? `<p class="fine">Scale: ${p.scale.toFixed(1)} px per foot. Re-calibrate anytime.</p>`
      : `<div class="callout warn" style="margin-top:8px"><b>Set the scale.</b> Pick <b>Calibrate</b>, then drag along a wall whose length you know.</div>`}
    <label class="fld">Plan visibility<input type="range" min="0.1" max="1" step="0.05" value="${p.opacity ?? 0.8}" id="planOpacity"></label>
    <div class="row-btns"><button class="btn" type="button" id="calBtn">Calibrate</button><button class="btn danger" type="button" id="rmPlan">Remove image</button></div>`;
  $('planOpacity').oninput = e => { p.opacity = +e.target.value; editor.draw(); changed(); };
  $('calBtn').onclick = () => editor.setTool('calibrate');
  $('rmPlan').onclick = () => { L.plan = null; editor.setImage(null); renderPlanInfo(); changed(); };
}

// ---------- rooms ----------
$('qaAdd').onclick = () => {
  const name = $('qaName').value.trim() || `Room ${L.rooms.length + 1}`;
  const w = parseFt($('qaW').value), d = parseFt($('qaD').value);
  if (!(w > 0 && d > 0)) { toast(null, 'Enter width and depth, like 12\' 6" or 12.5'); return; }
  const b = L.rooms.length ? bounds(L.rooms) : { x1: 0, z0: 0 };
  const r = { id: uid('r'), name, floor: defaultFloorFor(name), x: L.rooms.length ? b.x1 : 0, y: L.rooms.length ? b.z0 : 0, w, d, doors: [] };
  L.rooms.push(r); $('qaName').value = $('qaW').value = $('qaD').value = '';
  editor.select(r.id); editor.fit(); renderRooms(); changed();
  toast(null, `Added ${name}. Drag it into place on the plan — it snaps to other rooms.`);
};

function renderRooms() {
  $('roomList').innerHTML = L.rooms.map(r => `<button type="button" data-id="${r.id}" class="${r.id === editor.selId ? 'on' : ''}">
    <span>${esc(r.name)}</span><small>${fmtFt(r.w)} × ${fmtFt(r.d)} · ${(r.doors || []).length} door${(r.doors || []).length === 1 ? '' : 's'}</small></button>`).join('')
    || '<p class="muted">No rooms yet.</p>';
  renderRoomEditor();
}
$('roomList').onclick = e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) editor.select(id); };

const WALLS = { n: 'Top', s: 'Bottom', w: 'Left', e: 'Right' };
function renderRoomEditor() {
  const r = L.rooms.find(q => q.id === editor.selId), el = $('roomEdit');
  if (!r) { el.innerHTML = ''; return; }
  if (el.dataset.id === r.id && el.contains(document.activeElement)) { // live update numbers only
    for (const k of ['x', 'y', 'w', 'd']) { const i = el.querySelector(`[data-rf="${k}"]`); if (i !== document.activeElement) i.value = fmtFt(r[k]); }
    return;
  }
  el.dataset.id = r.id;
  el.innerHTML = `<div class="room-edit">
    <div class="grid2">
      <label class="fld">Name<input data-rf="name" value="${esc(r.name)}"></label>
      <label class="fld">Floor<select data-rf="floor">${Object.entries(FLOORS).map(([k, v]) => `<option value="${k}" ${k === r.floor ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="fld">Width ↔<input data-rf="w" value="${fmtFt(r.w)}"></label>
      <label class="fld">Depth ↕<input data-rf="d" value="${fmtFt(r.d)}"></label>
      <label class="fld">Left edge at<input data-rf="x" value="${fmtFt(r.x)}"></label>
      <label class="fld">Top edge at<input data-rf="y" value="${fmtFt(r.y)}"></label>
    </div>
    <h4 class="list-h">Doors &amp; openings</h4>
    ${(r.doors || []).map((d, i) => `<div class="door-row" data-i="${i}">
      <label class="fld">Wall<select data-df="wall">${Object.entries(WALLS).map(([k, v]) => `<option value="${k}" ${k === d.wall ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="fld">From corner<input data-df="offset" value="${fmtFt(d.offset)}"></label>
      <label class="fld">Width<input data-df="width" value="${Math.round(d.width * 12)}&quot;"></label>
      <label class="fld">Type<select data-df="type"><option value="door" ${d.type !== 'opening' ? 'selected' : ''}>Door</option><option value="opening" ${d.type === 'opening' ? 'selected' : ''}>Open archway</option></select></label>
      <button class="icon-btn" type="button" data-del="${i}" title="Remove">✕</button></div>`).join('') || '<p class="fine" style="margin:0">None yet. Use <b>Add door</b> and click a wall, or the button below.</p>'}
    <div class="row-btns"><button class="btn" type="button" data-act="addDoor">+ Doorway</button><button class="btn danger" type="button" data-act="delRoom">Delete room</button></div>
  </div>`;
  el.querySelectorAll('[data-rf]').forEach(inp => inp.onchange = () => {
    const k = inp.dataset.rf;
    if (k === 'name') { const was = r.floor === defaultFloorFor(r.name); r.name = inp.value; if (was) r.floor = defaultFloorFor(r.name); }
    else if (k === 'floor') r.floor = inp.value;
    else { const v = parseFt(inp.value); if (isFinite(v) && (v > 0 || k === 'x' || k === 'y')) r[k] = Math.round(v * 12) / 12; else inp.value = fmtFt(r[k]); }
    editor.draw(); renderRooms(); changed();
  });
  el.querySelectorAll('.door-row').forEach(row => {
    const d = r.doors[+row.dataset.i];
    row.querySelectorAll('[data-df]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.df;
      if (k === 'wall' || k === 'type') d[k] = inp.value;
      else if (k === 'offset') { const v = parseFt(inp.value); if (v >= 0) d.offset = v; }
      else { const v = parseIn(inp.value); if (v > 6) d.width = v / 12; }
      editor.draw(); changed(); renderRoomEditor();
    });
  });
  el.onclick = e => {
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (del != null) { r.doors.splice(+del, 1); el.dataset.id = ''; renderRooms(); editor.draw(); changed(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'addDoor') { r.doors.push({ wall: 's', offset: Math.max(0, r.w / 2 - 1.33), width: 2.67, type: 'door' }); el.dataset.id = ''; renderRooms(); editor.draw(); changed(); }
    if (act === 'delRoom') deleteRoom(r.id);
  };
}
function deleteRoom(id) {
  const r = L.rooms.find(q => q.id === id); if (!r || !confirm(`Delete “${r.name}”?`)) return;
  L.rooms = L.rooms.filter(q => q.id !== id);
  L.photos.forEach(p => { if (p.roomId === id) p.roomId = ''; });
  editor.select(null); renderRooms(); renderPhotos(); changed();
}
window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('planPane').hidden) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selId) { e.preventDefault(); deleteRoom(editor.selId); }
  if (e.key === 'Escape') editor.setTool('select');
});

// ---------- photos ----------
$('photoFiles').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    try {
      const { src } = await fileToDataURL(f, 1600, 0.82);
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toLowerCase();
      const guess = L.rooms.find(r => base.includes(r.name.toLowerCase()) || r.name.toLowerCase().split(' ').some(w => w.length > 3 && base.includes(w)));
      L.photos.push({ id: uid('p'), src, roomId: guess?.id || editor.selId || '', caption: '' });
    } catch { toast(null, `Skipped ${f.name} — not an image.`); }
  }
  renderPhotos(); changed();
};
function renderPhotos() {
  $('photoGrid').innerHTML = L.photos.map((p, i) => `<div class="photo-card" data-i="${i}">
    <img src="${p.src}" alt="">
    <div><label class="fld">Room<select data-pf="roomId"><option value="">— Not tied to a room —</option>${L.rooms.map(r => `<option value="${r.id}" ${r.id === p.roomId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
    <label class="fld"><input data-pf="caption" value="${esc(p.caption)}" placeholder="Caption (optional)"></label></div>
    <button class="icon-btn" type="button" data-rm="${i}" title="Remove photo">✕</button></div>`).join('');
}
$('photoGrid').addEventListener('change', e => { const card = e.target.closest('[data-i]'); const k = e.target.dataset.pf; if (card && k) { L.photos[+card.dataset.i][k] = e.target.value; changed(); } });
$('photoGrid').addEventListener('click', e => { const i = e.target.closest('[data-rm]')?.dataset.rm; if (i != null) { L.photos.splice(+i, 1); renderPhotos(); changed(); } });

// ---------- branding ----------
const headshot = (who, input) => input.onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  L.branding[who].photo = (await fileToDataURL(f, 300, 0.85)).src; changed(); toast(null, 'Headshot added.');
};
headshot('presenter', $('presPhoto')); headshot('agent', $('agentPhoto'));
$('saveMine').onclick = () => {
  lsSet('myBranding', { presenter: L.branding.presenter, accent: L.branding.accent, disclaimer: L.branding.disclaimer });
  toast(null, 'Saved. New listings will start with your info filled in.');
};

// ---------- publish ----------
function siteBase() { return location.href.replace(/[^/]*([?#].*)?$/, ''); }
function renderPublish() {
  const slug = L.slug || 'your-listing';
  const issues = [];
  if (!L.rooms.length) issues.push('Add at least one room.');
  if (L.plan && !L.plan.calibrated) issues.push('Calibrate the floor plan scale (step 2).');
  if (!L.slug) issues.push('Give the link a name above.');
  if (L.rooms.length && !L.rooms.some(r => r.doors?.length)) issues.push('No doors yet — the walkthrough needs doorways between rooms.');
  const size = new Blob([JSON.stringify(L)]).size;
  $('publishInfo').innerHTML = `
    ${issues.length ? `<div class="callout warn">${issues.map(esc).join('<br>')}</div>` : ''}
    <ol style="padding-left:18px;margin:10px 0">
      <li>Click <b>Download listing.json</b> (${(size / 1048576).toFixed(1)} MB — photos are packed inside).</li>
      <li>In your site, put it at <code>listings/${esc(slug)}/listing.json</code></li>
      <li>Share this link:<br><code>${esc(siteBase())}view.html?l=${esc(slug)}</code></li>
    </ol>
    <p class="fine">Use <b>Preview as visitor</b> to try the exact page your clients will see before you publish.</p>`;
}

function download() {
  const out = structuredClone(L); delete out._autoSlug;
  out.furniture = (viewer && !$('threePane').hidden) ? viewer.getFurniture() : out.furniture;
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'listing.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(null, `Downloaded. Upload it to listings/${L.slug || 'your-listing'}/listing.json`);
}
$('bExport').onclick = download;
$('bPreview').onclick = async () => { await save(true); window.open('view.html?draft=1', '_blank'); };
$('bNew').onclick = () => { if (confirm('Start a new, empty listing? (Download the current one first if you want to keep it.)')) { setListing(blankListing()); editor.setTool('select'); } };
$('bSample').onclick = async () => { if (!L.rooms.length || confirm('Replace the current draft with the sample listing?')) await loadSample(); };
$('bOpen').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await setListing(JSON.parse(await f.text()), `Opened ${f.name}`); } catch { toast(null, 'That file isn\'t a valid listing.json'); }
};
async function loadSample() { await setListing(await inlineAssets(await fetchListing(listingUrl('sample'))), 'Sample listing loaded.'); }

// ---------- 3D tab ----------
function refresh3D() {
  if (!viewer) {
    viewer = window.viewer = new HomeViewer($('hv'));
    furnPanel = mountFurniturePanel($('furnBody'), { viewer });
    fitPanel = mountFitPanel($('fitBody'), { viewer });
    viewer.addEventListener('change', () => { L.furniture = viewer.getFurniture(); changed(); });
    viewer.addEventListener('mode', e => $('bMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === e.detail)));
    $('bMode').onclick = e => { const m = e.target.closest('[data-mode]')?.dataset.mode; if (m) viewer.setMode(m); };
  }
  viewer.load(L); furnPanel.refreshRooms(); furnPanel.renderList(); fitPanel.refreshRooms();
}
document.querySelector('.tabs').onclick = e => {
  const t = e.target.closest('[data-tab]')?.dataset.tab; if (!t) return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('planPane').hidden = t !== 'plan'; $('threePane').hidden = t !== '3d';
  if (t === '3d') refresh3D(); else { viewer?.setMode('orbit'); requestAnimationFrame(() => editor.draw()); }
};
$('sideSeg').onclick = e => {
  const s = e.target.closest('[data-side]')?.dataset.side; if (!s) return;
  $('sideSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.side === s));
  $('furnBody').hidden = s !== 'furn'; $('fitBody').hidden = s !== 'fit';
};

// ---------- boot ----------
(async () => {
  brandDefaults = await fetchBrandDefaults();
  const slug = new URLSearchParams(location.search).get('l');
  try {
    if (slug) return await setListing(await inlineAssets(await fetchListing(listingUrl(slug))), `Editing “${slug}”`);
    const draft = await idbGet('draft');
    if (draft) return await setListing(draft);
    await loadSample();
  } catch (err) {
    console.error(err); await setListing(blankListing()); toast(null, err.message);
  }
})();
