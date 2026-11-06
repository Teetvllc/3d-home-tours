// The shareable viewer page: view.html?l=<slug>   (also ?draft=1 from the builder, or ?src=<url to listing.json>)
import { HomeViewer } from './viewer3d.js';
import { mountFitPanel, mountFurniturePanel, toast } from './panels.js';
import { fetchListing, listingUrl, idbGet, fetchBrandDefaults } from './store.js';
import { fmtFt, encodeLayout, decodeLayout } from './model.js';
import { renderFooter, applyAccent, applyLink } from './brand.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);

async function getListing() {
  if (params.get('draft')) {
    const d = await idbGet('draft');
    if (!d) throw new Error('No draft found in this browser. Open the builder and press “Preview”.');
    return structuredClone(d);
  }
  if (params.get('src')) return fetchListing(new URL(params.get('src'), location.href).href);
  return fetchListing(listingUrl(params.get('l') || 'sample'));
}

function fail(err) {
  $('loading').innerHTML = `<div><h2>We couldn't open this tour</h2><p>${esc(err.message)}</p>
    <p class="muted">Links look like <code>view.html?l=your-listing</code>, with the file at <code>listings/your-listing/listing.json</code>.</p></div>`;
  $('addr').textContent = '3D Home Tour';
}

(async function main() {
  let L, brand;
  try { [L, brand] = await Promise.all([getListing(), fetchBrandDefaults()]); }
  catch (e) { return fail(e); }

  // ---- header + footer ----
  const D = L.details || {};
  const title = [D.address, D.city].filter(Boolean).join(', ') || '3D Home Tour';
  document.title = `${D.address || 'Home'} — 3D Tour`;
  $('addr').textContent = title;
  const sqft = D.sqft || Math.round((L.rooms || []).reduce((a, r) => a + r.w * r.d, 0));
  $('meta').innerHTML = [D.price && `<b>${esc(D.price)}</b>`, D.beds && `${esc(D.beds)} bd`, D.baths && `${esc(D.baths)} ba`,
    sqft && `${Number(sqft).toLocaleString()} sq ft`].filter(Boolean).map(s => `<span>${s}</span>`).join('');
  const B = applyAccent(L, brand);
  renderFooter($('brand'), B, D.address || '');
  const lead = applyLink(B.presenter, D.address || '');
  if (lead) {
    Object.assign($('btnApply'), { href: lead.href, hidden: false });
    if (lead.external) { $('btnApply').target = '_blank'; $('btnApply').rel = 'noopener'; }
  }

  // ---- 3D ----
  const viewer = new HomeViewer($('hv'));
  const hashLayout = location.hash.startsWith('#layout=') ? decodeLayout(location.hash.slice(8)) : null;
  viewer.load(L);
  if (hashLayout) { viewer.setFurniture(hashLayout); toast(null, 'Showing a furniture layout someone shared with you.'); }
  $('loading').hidden = true;
  window.viewer = viewer; // handy for debugging

  // ---- rooms ----
  const roomsNav = $('rooms');
  roomsNav.innerHTML = `<button type="button" data-room="" class="on">Whole home</button>` + viewer.rooms.map(r =>
    `<button type="button" data-room="${r.id}">${esc(r.name)}<small>${fmtFt(r.w)} × ${fmtFt(r.d)}</small></button>`).join('');
  const markRoom = id => roomsNav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.room === (id || '')));
  roomsNav.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.room) viewer.goToRoom(b.dataset.room); else { viewer.setMode('orbit'); viewer.resetView(); }
    markRoom(b.dataset.room);
  };
  viewer.addEventListener('roomclick', e => markRoom(e.detail));
  viewer.addEventListener('walkroom', e => { markRoom(e.detail.id); viewer.currentRoomId = e.detail.id; });

  // ---- modes ----
  const hint = $('hint'); let hintTimer;
  const showHint = msg => { hint.textContent = msg; hint.hidden = false; hint.style.opacity = 1; clearTimeout(hintTimer); hintTimer = setTimeout(() => (hint.style.opacity = 0), 5000); };
  const touch = matchMedia('(pointer: coarse)').matches;
  $('modeSeg').onclick = e => { const m = e.target.closest('[data-mode]')?.dataset.mode; if (m) viewer.setMode(m); };
  viewer.addEventListener('mode', e => {
    const walk = e.detail === 'walk';
    $('modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === e.detail));
    $('walkpad').hidden = !walk;
    showHint(walk ? (touch ? 'Drag to look around · use the arrows to walk' : 'Drag to look · W A S D or arrow keys to walk · Shift to hurry')
      : (touch ? 'Drag to orbit · pinch to zoom · tap a room name to jump' : 'Drag to orbit · scroll to zoom · drag furniture to move it'));
  });
  showHint(touch ? 'Drag to orbit · pinch to zoom · try Walk mode' : 'Drag to orbit · scroll to zoom · try Walk mode');

  // walk pad (press and hold)
  const pad = $('walkpad'), held = new Set();
  const applyPad = () => viewer.setMoveInput((held.has('f') ? 1 : 0) - (held.has('b') ? 1 : 0), 0, (held.has('l') ? 1 : 0) - (held.has('r') ? 1 : 0));
  pad.addEventListener('pointerdown', e => { const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return; e.preventDefault(); e.target.setPointerCapture?.(e.pointerId); held.add(m); applyPad(); });
  const release = e => { const m = e.target.closest?.('[data-m]')?.dataset.m; if (m) held.delete(m); else held.clear(); applyPad(); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => pad.addEventListener(t, release));

  $('btnPlan').hidden = !L.plan?.src;
  $('btnPlan').onclick = () => { viewer.setShowPlan(!viewer.showPlan); $('btnPlan').classList.toggle('on', viewer.showPlan); };
  $('btnReset').onclick = () => { viewer.setMode('orbit'); viewer.resetView(); markRoom(''); };

  // ---- drawers ----
  const drawers = { fit: $('drawerFit'), furn: $('drawerFurn') };
  const btns = { fit: $('btnFit'), furn: $('btnFurn') };
  const open = name => Object.entries(drawers).forEach(([k, d]) => { const on = k === name && d.hidden; d.hidden = !on; btns[k].classList.toggle('on', on); });
  btns.fit.onclick = () => open('fit'); btns.furn.onclick = () => open('furn');
  document.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => open(null)));

  mountFitPanel($('fitBody'), {
    viewer, onPlaced: (f, placed) => {
      if (matchMedia('(max-width: 720px)').matches) open(null);
      toast(null, placed ? `Added ${f.name}. Drag it to try other spots.` : `${f.name} is in, but overlaps something (red). Drag it to adjust.`);
    },
  });
  mountFurniturePanel($('furnBody'), {
    viewer,
    extraButtons: `<button type="button" class="btn primary" id="btnShare">Copy link to my layout</button><button type="button" class="btn" id="btnResetLayout">Reset layout</button>`,
  });
  viewer.addEventListener('select', e => { if (e.detail && drawers.furn.hidden && drawers.fit.hidden && !matchMedia('(max-width: 720px)').matches) open('furn'); });
  $('btnShare').onclick = async () => {
    const url = `${location.origin}${location.pathname}${location.search}#layout=${encodeLayout(viewer.getFurniture())}`;
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); toast(null, 'Link copied — anyone who opens it sees your furniture layout.'); }
    catch { prompt('Copy this link:', url); }
  };
  $('btnResetLayout').onclick = () => { viewer.setFurniture(L.furniture || []); history.replaceState(null, '', location.pathname + location.search); };

  // ---- photos ----
  const photos = L.photos || [];
  $('btnPhotos').hidden = !photos.length;
  $('btnPhotos').textContent = `Photos (${photos.length})`;
  const lb = $('lightbox'); let list = [], idx = 0;
  const roomName = id => viewer.rooms.find(r => r.id === id)?.name || '';
  const show = () => {
    const p = list[idx]; lb.querySelector('img').src = p.src; lb.querySelector('img').alt = p.caption || roomName(p.roomId);
    lb.querySelector('.cap').innerHTML = `${esc(p.caption || roomName(p.roomId) || 'Photo')}<small>${idx + 1} of ${list.length}${p.caption && p.roomId ? ' · ' + esc(roomName(p.roomId)) : ''}</small>`;
    lb.querySelector('.lb-thumbs').innerHTML = list.map((q, i) => `<img src="${q.src}" data-i="${i}" class="${i === idx ? 'on' : ''}" alt="">`).join('');
  };
  const openLB = (roomId) => {
    list = roomId ? [...photos.filter(p => p.roomId === roomId), ...photos.filter(p => p.roomId !== roomId)] : photos;
    if (!list.length) return; idx = 0; lb.hidden = false; show();
  };
  $('btnPhotos').onclick = () => openLB(null);
  viewer.addEventListener('photos', e => openLB(e.detail));
  lb.querySelector('.lb-close').onclick = () => (lb.hidden = true);
  lb.querySelector('.lb-prev').onclick = () => { idx = (idx - 1 + list.length) % list.length; show(); };
  lb.querySelector('.lb-next').onclick = () => { idx = (idx + 1) % list.length; show(); };
  lb.querySelector('.lb-thumbs').onclick = e => { if (e.target.dataset.i) { idx = +e.target.dataset.i; show(); } };
  lb.onclick = e => { if (e.target === lb) lb.hidden = true; };
  window.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') lb.hidden = true;
    if (e.key === 'ArrowRight') lb.querySelector('.lb-next').click();
    if (e.key === 'ArrowLeft') lb.querySelector('.lb-prev').click();
  }, true);
})();
