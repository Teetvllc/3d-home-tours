// Simple, light-weight procedural furniture. Units: feet. Origin = center of footprint on the floor.
// Back of every piece faces -z (against the wall), front faces +z.
import * as THREE from 'three';

const C = {
  wood: 0x7a5a40, darkWood: 0x4a3a2e, lightWood: 0xb99772, sheet: 0xf3f0ea, duvet: 0x7d93a6, pillow: 0xffffff,
  fabric: 0x8c9a8a, cushion: 0x9aa897, chairFab: 0xb07a55, white: 0xf2f2ef, steel: 0xc9cdd0, black: 0x1f1f22,
  counter: 0xe7e3dc, cabinet: 0x50606e, rug: 0xb9a68c, rugIn: 0xd8cbb5, leaf: 0x4f7b45, pot: 0xc9b9a0, porcelain: 0xfafafa,
};

function mat(color, rough = 0.8, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }); }
function add(g, geo, color, x, y, z, rough) {
  const m = new THREE.Mesh(geo, mat(color, rough)); m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
const box = (g, w, h, d, color, x, y, z, rough) => add(g, new THREE.BoxGeometry(w, h, d), color, x, y, z, rough);
const cyl = (g, rt, rb, h, color, x, y, z, rough) => add(g, new THREE.CylinderGeometry(rt, rb, h, 24), color, x, y, z, rough);

function legs(g, w, d, h, color, t = 0.15, inset = 0.15) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(g, t, h, t, color, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset));
}

function sofa(g, w, d, h, col = C.fabric, cush = C.cushion) {
  const lg = 0.3, seatH = 1.45, backT = Math.min(0.8, d * 0.25), armW = Math.min(0.55, w * 0.18);
  legs(g, w, d, lg, C.darkWood, 0.15, 0.25);
  box(g, w, seatH - lg - 0.35, d, col, 0, lg + (seatH - lg - 0.35) / 2, 0);
  box(g, w, h - lg, backT, col, 0, lg + (h - lg) / 2, -d / 2 + backT / 2);
  const armH = Math.min(h, 2.1);
  for (const s of [-1, 1]) box(g, armW, armH - lg, d, col, s * (w / 2 - armW / 2), lg + (armH - lg) / 2, 0);
  const inner = w - 2 * armW, n = Math.max(1, Math.round(inner / 2.4)), cw = inner / n;
  for (let i = 0; i < n; i++) {
    box(g, cw - 0.06, 0.38, d - backT - 0.05, cush, -inner / 2 + cw * (i + 0.5), seatH - 0.15, backT / 2 + 0.02);
    box(g, cw - 0.1, Math.max(0.6, h - seatH - 0.3), 0.35, cush, -inner / 2 + cw * (i + 0.5), seatH + (h - seatH) / 2, -d / 2 + backT + 0.15);
  }
}

function chair(g, x, z, faceRot, col = C.wood) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = faceRot; g.add(c);
  legs(c, 1.35, 1.35, 1.5, col, 0.1, 0.08);
  box(c, 1.4, 0.15, 1.4, col, 0, 1.55, 0);
  box(c, 1.4, 1.5, 0.12, col, 0, 2.3, -0.65);
}

function storage(g, w, d, h, col) {
  const lg = 0.25;
  legs(g, w, d, lg, C.darkWood, 0.12, 0.1);
  box(g, w, h - lg, d, col, 0, lg + (h - lg) / 2, 0);
  const rows = h > 2.4 ? 3 : 2, cols = w > 3 ? 2 : 1, fh = (h - lg - 0.15) / rows, fw = (w - 0.12) / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    box(g, fw - 0.08, fh - 0.08, 0.04, 0xd8c3a5, -w / 2 + 0.06 + fw * (c + 0.5), lg + 0.08 + fh * (r + 0.5), d / 2 + 0.02);
  }
}

const BUILDERS = {
  bed(g, { w, d, h }) {
    const fh = 1.05;
    box(g, w, fh, d, C.wood, 0, fh / 2, 0);
    box(g, w - 0.2, 0.8, d - 0.45, C.sheet, 0, fh + 0.4, 0.15);
    box(g, w - 0.08, 0.22, d * 0.6, C.duvet, 0, fh + 0.82, d / 2 - d * 0.3);
    box(g, w + 0.05, h, 0.28, C.wood, 0, h / 2, -d / 2 + 0.14);
    const n = w < 4 ? 1 : 2, pw = (w - 0.4) / n;
    for (let i = 0; i < n; i++) box(g, pw - 0.15, 0.35, 1.1, C.pillow, -w / 2 + 0.2 + pw * (i + 0.5), fh + 0.97, -d / 2 + 0.95);
  },
  sofa(g, { w, d, h }) { sofa(g, w, d, h); },
  chair(g, { w, d, h }) { sofa(g, w, d, h, C.chairFab, 0xc08a65); },
  sectional(g, { w, d, h }) {
    const sd = Math.min(3.3, d * 0.45), main = new THREE.Group(); main.position.z = -d / 2 + sd / 2; g.add(main);
    sofa(main, w, sd, h);
    const cw = Math.min(3.2, w * 0.35);
    box(g, cw, 1.05, d - sd, C.fabric, w / 2 - cw / 2, 0.3 + 0.52, -d / 2 + sd + (d - sd) / 2);
    box(g, cw - 0.1, 0.38, d - sd - 0.05, C.cushion, w / 2 - cw / 2, 1.3, -d / 2 + sd + (d - sd) / 2);
  },
  dining(g, f) {
    const { w, d, h } = f;
    if (f.shape === 'round') {
      cyl(g, w / 2, w / 2, 0.14, C.lightWood, 0, h - 0.07, 0, 0.6);
      cyl(g, 0.25, 0.4, h - 0.14, C.darkWood, 0, (h - 0.14) / 2, 0);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, r = w / 2 + 0.55; chair(g, Math.sin(a) * r, Math.cos(a) * r, a + Math.PI); }
      return;
    }
    box(g, w, 0.14, d, C.lightWood, 0, h - 0.07, 0, 0.6);
    legs(g, w, d, h - 0.14, C.darkWood, 0.22, 0.3);
    const per = Math.max(1, Math.floor(w / 2.3));
    for (let i = 0; i < per; i++) {
      const x = -w / 2 + (w / per) * (i + 0.5);
      chair(g, x, d / 2 + 0.55, Math.PI); chair(g, x, -d / 2 - 0.55, 0);
    }
    if (w >= 5.5) { chair(g, -w / 2 - 0.55, 0, Math.PI / 2); chair(g, w / 2 + 0.55, 0, -Math.PI / 2); }
  },
  coffee(g, { w, d, h }) { box(g, w, 0.12, d, C.lightWood, 0, h - 0.06, 0, 0.6); legs(g, w, d, h - 0.12, C.darkWood, 0.14, 0.2); box(g, w - 0.4, 0.06, d - 0.4, C.lightWood, 0, 0.45, 0); },
  desk(g, { w, d, h }) {
    box(g, w, 0.12, d, C.lightWood, 0, h - 0.06, 0, 0.6);
    legs(g, w, d, h - 0.12, C.darkWood, 0.14, 0.12);
    box(g, Math.min(1.4, w * 0.3), h - 0.5, d - 0.2, C.lightWood, w / 2 - Math.min(1.4, w * 0.3) / 2 - 0.1, (h - 0.5) / 2 + 0.25, 0);
    chair(g, -w * 0.1, d / 2 + 0.5, Math.PI, C.black);
  },
  storage(g, { w, d, h }) { storage(g, w, d, h, C.wood); },
  shelf(g, { w, d, h }) {
    const t = 0.08;
    for (const s of [-1, 1]) box(g, t, h, d, C.wood, s * (w / 2 - t / 2), h / 2, 0);
    box(g, w, h, t, C.darkWood, 0, h / 2, -d / 2 + t / 2);
    const n = Math.max(3, Math.round(h / 1.2));
    const colors = [0x8a3b2e, 0x2f4f6f, 0xc9a24b, 0x557a55, 0xe6e0d4, 0x6a4c7a];
    for (let i = 0; i <= n; i++) {
      const y = i * (h - t) / n + t / 2; box(g, w - 2 * t, t, d, C.wood, 0, y, 0);
      if (i < n) { let x = -w / 2 + t + 0.05; let k = i * 3;
        while (x < w / 2 - t - 0.2) { const bw = 0.08 + ((k * 37) % 7) / 50, bh = 0.6 + ((k * 13) % 5) / 15;
          box(g, bw, bh, d * 0.75, colors[k++ % colors.length], x + bw / 2, y + t / 2 + bh / 2, 0.02); x += bw + 0.01; } }
    }
  },
  tv(g, { w, d, h }) {
    storage(g, w, d, h, C.darkWood);
    const tw = Math.min(w * 0.9, 5.4), th = tw * 0.5625;
    box(g, 0.6, 0.25, 0.5, C.black, 0, h + 0.12, -0.05);
    box(g, tw, th, 0.12, C.black, 0, h + 0.3 + th / 2, -0.05, 0.3);
  },
  counter(g, { w, d, h }) {
    box(g, w - 0.04, h - 0.42, d - 0.12, C.cabinet, 0, (h - 0.42) / 2 + 0.3, -0.06);
    box(g, w - 0.04, 0.3, d - 0.3, C.black, 0, 0.15, -0.15);
    box(g, w, 0.12, d, C.counter, 0, h - 0.06, 0, 0.35);
  },
  fridge(g, { w, d, h }) {
    box(g, w, h, d, C.steel, 0, h / 2, 0, 0.35);
    box(g, 0.02, h * 0.95, 0.02, 0x8a8f93, 0, h / 2, d / 2 + 0.01);
    for (const s of [-1, 1]) box(g, 0.06, 1.4, 0.08, 0x777b80, s * 0.18, h * 0.6, d / 2 + 0.05);
  },
  laundry(g, { w, d, h }) {
    const uw = w / 2 - 0.05;
    for (const s of [-1, 1]) {
      box(g, uw, h, d, C.white, s * (w / 4), h / 2, 0, 0.4);
      cyl(g, uw * 0.33, uw * 0.33, 0.06, 0x9fb3c2, s * (w / 4), h * 0.45, d / 2 + 0.02).rotation.x = Math.PI / 2;
    }
  },
  vanity(g, { w, d, h }) {
    box(g, w, h - 0.12, d - 0.05, C.cabinet, 0, (h - 0.12) / 2, -0.025);
    box(g, w, 0.12, d, C.counter, 0, h - 0.06, 0, 0.35);
    box(g, Math.min(1.4, w * 0.6), 0.04, d * 0.55, C.porcelain, 0, h + 0.01, 0.05, 0.2);
    box(g, Math.min(2.5, w * 0.9), 2.4, 0.06, 0xcfe2ea, 0, h + 1.9, -d / 2 + 0.03, 0.1);
  },
  tub(g, { w, d, h }) {
    box(g, w, h, d, C.porcelain, 0, h / 2, 0, 0.25);
    box(g, w - 0.5, 0.03, d - 0.5, 0xa9c6d6, 0, h - 0.06, 0, 0.1);
  },
  toilet(g, { w, d, h }) {
    box(g, w, h - 0.6, 0.6, C.porcelain, 0, 0.6 + (h - 0.6) / 2, -d / 2 + 0.3, 0.25);
    const bowl = cyl(g, w * 0.48, w * 0.36, 1.25, C.porcelain, 0, 0.62, 0.15, 0.25); bowl.scale.z = 1.35;
  },
  piano(g, { w, d, h }) {
    box(g, w, h, d * 0.55, C.black, 0, h / 2, -d / 2 + d * 0.275, 0.3);
    box(g, w * 0.92, 0.12, d * 0.45, C.white, 0, 2.3, d * 0.05, 0.4);
    box(g, w * 0.92, 0.25, d * 0.45, C.black, 0, 2.15, d * 0.05, 0.3);
    for (const s of [-1, 1]) box(g, 0.15, 2.1, d * 0.45, C.black, s * (w / 2 - 0.08), 1.05, d * 0.05);
  },
  rug(g, { w, d }) { box(g, w, 0.03, d, C.rug, 0, 0.015, 0, 1); box(g, w - 0.6, 0.035, d - 0.6, C.rugIn, 0, 0.02, 0, 1); },
  plant(g, { w, h }) {
    cyl(g, w * 0.32, w * 0.24, 1.1, C.pot, 0, 0.55, 0, 0.6);
    for (let i = 0; i < 5; i++) {
      const s = add(g, new THREE.SphereGeometry(w * 0.32, 12, 10), C.leaf, Math.sin(i * 1.3) * w * 0.15, 1.4 + i * (h - 1.6) / 5, Math.cos(i * 1.3) * w * 0.15, 0.9);
      s.scale.set(1, 1.3, 1);
    }
  },
};

export function buildFurnitureMesh(f) {
  const g = new THREE.Group();
  (BUILDERS[f.kind] || ((gg, { w, d, h }) => box(gg, w, h, d, 0x9a8f80, 0, h / 2, 0)))(g, f);
  g.userData.fid = f.id;
  return g;
}

export function tint(group, hex) {
  group.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(hex); });
}
