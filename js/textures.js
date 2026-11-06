// Procedural floor textures drawn on canvas (no image downloads). Each canvas tile = 4 ft × 4 ft.
import * as THREE from 'three';

const cache = {};
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const rgb = (c, v = 0) => `rgb(${c[0] + v | 0},${c[1] + v * 0.85 | 0},${c[2] + v * 0.7 | 0})`;

function draw(type) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = rng(type.length * 977 + 13);
  if (type === 'wood' || type === 'light-wood') {
    const base = type === 'wood' ? [146, 102, 66] : [206, 174, 132];
    const rows = 8, ph = S / rows; // 6" planks
    for (let row = 0; row < rows; row++) {
      let x = -r() * 300;
      while (x < S) {
        const len = 170 + r() * 230, v = (r() - 0.5) * 34;
        g.fillStyle = rgb(base, v); g.fillRect(x, row * ph, len, ph);
        g.strokeStyle = 'rgba(55,30,12,0.10)'; g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const yy = row * ph + r() * ph; g.beginPath(); g.moveTo(x, yy);
          g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 6, x + len * 0.7, yy + (r() - 0.5) * 6, x + len, yy); g.stroke();
        }
        g.fillStyle = 'rgba(45,25,10,0.35)'; g.fillRect(x, row * ph, 1.5, ph);
        x += len;
      }
      g.fillStyle = 'rgba(45,25,10,0.3)'; g.fillRect(0, row * ph, S, 1.5);
    }
  } else if (type === 'tile' || type === 'stone') {
    const n = type === 'tile' ? 4 : 2, sz = S / n;
    const base = type === 'tile' ? [232, 230, 225] : [188, 180, 168];
    g.fillStyle = type === 'tile' ? '#b9b4ab' : '#8f877c'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = rgb(base, (r() - 0.5) * 14); g.fillRect(i * sz + 2, j * sz + 2, sz - 4, sz - 4);
      if (type === 'stone') for (let k = 0; k < 220; k++) {
        g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '60,50,40'},0.10)`;
        g.fillRect(i * sz + r() * sz, j * sz + r() * sz, 2 + r() * 4, 2 + r() * 4);
      }
    }
  } else if (type === 'carpet') {
    g.fillStyle = '#c9c0b3'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 14000; k++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '70,60,50'},0.07)`;
      g.fillRect(r() * S, r() * S, 2, 2);
    }
  } else {
    g.fillStyle = '#a9a8a4'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 60; k++) {
      const gr = g.createRadialGradient(r() * S, r() * S, 0, r() * S, r() * S, 40 + r() * 80);
      gr.addColorStop(0, `rgba(${r() > 0.5 ? '255,255,255' : '40,40,40'},0.07)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
  }
  return c;
}

export function floorTexture(type, w, d) {
  const canvas = cache[type] || (cache[type] = draw(type));
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 4, d / 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
