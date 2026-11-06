#!/usr/bin/env node
// Build a tour from a listing's public facts (address, price, beds/baths, room sizes).
//
//   node tools/make-listing.mjs spec.json
//
// spec.json:
// {
//   "address": "123 Main St", "city": "Charlotte, NC 28105",
//   "listingUrl": "https://www.redfin.com/...",          // shown as "Listing photos ↗"
//   "agent": { "name": "...", "brokerage": "...", "phone": "...", "email": "..." },
//   "text": "4 bd 3 ba 2,150 sqft $389,900\nLiving Room 15 x 18\nPrimary Bedroom 14x16 Upper\n..."
// }
// Writes listings/<slug>/listing.json and adds the tour to listings/index.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseListingText, generateLayout, autoStage } = await import(pathToFileURL(path.join(root, 'js/generate.js')).href);

const specPath = process.argv[2];
if (!specPath) { console.error('Usage: node tools/make-listing.mjs spec.json'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
if (!spec.address || !spec.text) { console.error('spec needs "address" and "text"'); process.exit(1); }

const slug = spec.slug || spec.address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const { details, rooms: parsed } = parseListingText(spec.text);
if (!parsed.length) console.warn('! No room sizes found in the text — every room will be an estimate.');
const rooms = generateLayout(parsed, details);
const furniture = autoStage(rooms);

const listing = {
  version: 1, slug, approximate: true,
  details: {
    address: spec.address, city: spec.city || '', price: spec.price || details.price || '',
    beds: spec.beds ?? details.beds ?? '', baths: spec.baths ?? details.baths ?? '', sqft: spec.sqft ?? details.sqft ?? '',
    listingUrl: spec.listingUrl || '',
  },
  plan: null, rooms, photos: [], furniture,
  // Presenter + disclaimer come from config/brand.json; only the listing agent is per-listing.
  branding: { agent: spec.agent || {} },
};

const dir = path.join(root, 'listings', slug);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'listing.json'), JSON.stringify(listing, null, 2));

const idxPath = path.join(root, 'listings', 'index.json');
const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : [];
const title = [spec.address, spec.city].filter(Boolean).join(', ');
const i = idx.findIndex(e => e.slug === slug);
if (i >= 0) idx[i].title = title; else idx.unshift({ slug, title });
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');

const levels = [...new Set(rooms.map(r => r.level ?? 1))];
console.log(`✓ listings/${slug}/listing.json`);
console.log(`  ${parsed.length} rooms from the listing, ${rooms.filter(r => r.est).length} estimated, ${levels.length} floor(s), ${furniture.length} furniture pieces`);
for (const r of rooms) console.log(`  L${r.level ?? 1}  ${r.est ? '≈' : ' '} ${r.name}  ${r.w.toFixed(1)} x ${r.d.toFixed(1)}`);
console.log(`  link: view.html?l=${slug}`);
