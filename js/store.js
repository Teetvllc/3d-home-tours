// Loading listings, resolving image paths, IndexedDB drafts, brand defaults.

export const listingUrl = slug => new URL(`listings/${encodeURIComponent(slug)}/listing.json`, location.href).href;

const isAbs = s => /^(data:|blob:|https?:|\/)/i.test(s || '');

/** Fetch a listing.json and make every image path absolute (relative paths resolve next to the JSON). */
export async function fetchListing(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  const L = await res.json();
  const fix = s => (s && !isAbs(s) ? new URL(s, url).href : s);
  if (L.plan?.src) L.plan.src = fix(L.plan.src);
  for (const p of L.photos || []) p.src = fix(p.src);
  // Headshots from config/brand.json live at the site root, not next to the listing.
  const fixBrand = s => (s && /^config\//.test(s) ? new URL(s, location.href).href : fix(s));
  if (L.branding?.presenter?.photo) L.branding.presenter.photo = fixBrand(L.branding.presenter.photo);
  if (L.branding?.agent?.photo) L.branding.agent.photo = fixBrand(L.branding.agent.photo);
  return L;
}

const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

/** Convert every image URL in a listing to an embedded data: URL (so an exported listing.json is self-contained). */
export async function inlineAssets(L) {
  const conv = async s => (!s || s.startsWith('data:') ? s : blobToDataURL(await (await fetch(s)).blob()));
  if (L.plan?.src) L.plan.src = await conv(L.plan.src);
  for (const p of L.photos || []) p.src = await conv(p.src);
  for (const who of ['presenter', 'agent']) if (L.branding?.[who]?.photo) L.branding[who].photo = await conv(L.branding[who].photo);
  return L;
}

/** Downscale an image file → JPEG data URL. */
export async function fileToDataURL(file, maxSide = 1600, quality = 0.85, background = null) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = background || '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', quality), width: c.width, height: c.height };
  } finally { URL.revokeObjectURL(url); }
}

// ---- IndexedDB key/value (drafts can be several MB, too big for localStorage) ----
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('listing3d', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbGet(k) {
  try { const d = await db(); return await new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  catch { return undefined; }
}
export async function idbSet(k, v) {
  try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; }
  catch { return false; }
}

export async function fetchBrandDefaults() {
  try { const r = await fetch('config/brand.json', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch { /* optional file */ }
  return {};
}

export function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
