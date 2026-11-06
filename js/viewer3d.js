// HomeViewer — turns a listing (rooms + doors + furniture) into a 3D scene.
// Modes: 'orbit' (dollhouse, drag furniture) and 'walk' (first person, WASD / on-screen pad, drag to look).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  WALL_H, WALL_T, DOOR_H, EYE_H, computeWalls, wallRectsFrom, openingZones, roomAt, bounds,
  rectOf, overlap, collides, isNoCollide, autoPlace, fmtFt, defaultFloorFor, clamp,
} from './model.js';
import { buildFurnitureMesh, tint } from './furniture3d.js';
import { floorTexture } from './textures.js';

const CAMERA_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9zm3 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg>';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HomeViewer extends EventTarget {
  constructor(container) {
    super();
    this.el = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.className = 'hv-canvas';
    container.appendChild(r.domElement);
    this.css = new CSS2DRenderer(); this.css.domElement.className = 'hv-labels'; container.appendChild(this.css.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0xe8edf0);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const oc = this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(oc, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.47, minDistance: 5, maxDistance: 220 });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb3a68f, 1.5); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3df, 2.1);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    s.add(this.sun, this.sun.target);

    this.root = new THREE.Group(); this.furnGroup = new THREE.Group(); s.add(this.root, this.furnGroup);
    this.meshes = new Map(); this.furniture = []; this.rooms = []; this.wallRects = []; this.zones = []; this.labelObjs = [];
    this.mode = 'orbit'; this.showPlan = false; this.selectedId = null; this.currentRoomId = null;
    this.walk = { yaw: 0, pitch: 0, x: 0, z: 0, keys: new Set(), input: { f: 0, s: 0, turn: 0 } };
    this.ray = new THREE.Raycaster(); this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._bind();
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(container); this._resize();
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this._tick());
  }

  // ---------------- building the house ----------------
  load(listing) {
    this._clear(this.root);
    this.labelObjs.forEach(l => l.element.remove()); this.labelObjs = [];
    this.listing = listing;
    const rooms = this.rooms = (listing.rooms || []).filter(r => r.w > 0 && r.d > 0);
    const { segments, openings } = computeWalls(rooms);
    this.wallRects = wallRectsFrom(segments); this.zones = openingZones(openings);
    const b = this.bounds = bounds(rooms);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, span = Math.max(b.x1 - b.x0, b.z1 - b.z0, 10);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 3, 48), new THREE.MeshStandardMaterial({ color: 0xd9dfd6, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.02, cz); ground.receiveShadow = true; this.root.add(ground);

    this.ceilings = new THREE.Group(); this.ceilings.visible = this.mode === 'walk'; this.root.add(this.ceilings);
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 1 });
    for (const rm of rooms) {
      const fm = new THREE.Mesh(new THREE.PlaneGeometry(rm.w, rm.d),
        new THREE.MeshStandardMaterial({ map: floorTexture(rm.floor || defaultFloorFor(rm.name), rm.w, rm.d), roughness: 0.75 }));
      fm.rotation.x = -Math.PI / 2; fm.position.set(rm.x + rm.w / 2, 0.005, rm.y + rm.d / 2); fm.receiveShadow = true;
      this.root.add(fm);
      const cm = new THREE.Mesh(new THREE.PlaneGeometry(rm.w, rm.d), ceilMat);
      cm.rotation.x = Math.PI / 2; cm.position.set(rm.x + rm.w / 2, WALL_H, rm.y + rm.d / 2); this.ceilings.add(cm);
      this._label(rm);
    }

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.92 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x4b4640, roughness: 0.9 });
    const mats = [wallMat, wallMat, capMat, wallMat, wallMat, wallMat];
    const wallBox = (o, c, a, b2, y0, y1) => {
      const len = b2 - a, h = y1 - y0;
      const m = new THREE.Mesh(o === 'h' ? new THREE.BoxGeometry(len, h, WALL_T) : new THREE.BoxGeometry(WALL_T, h, len), mats);
      m.position.set(o === 'h' ? (a + b2) / 2 : c, y0 + h / 2, o === 'h' ? c : (a + b2) / 2);
      m.castShadow = m.receiveShadow = true; this.root.add(m);
    };
    for (const sg of segments) wallBox(sg.o, sg.c, sg.a, sg.b, 0, WALL_H);
    for (const op of openings) if (op.type === 'door') wallBox(op.o, op.c, op.a, op.b, DOOR_H, WALL_H);

    // Optional floor-plan image overlay
    this.planMesh = null;
    const p = listing.plan;
    if (p?.src) {
      new THREE.TextureLoader().load(p.src, tex => {
        if (this.listing !== listing) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        const img = tex.image, w = img.width / p.scale, h = img.height / p.scale;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set((p.offsetX || 0) + w / 2, 0.03, (p.offsetY || 0) + h / 2);
        m.renderOrder = 2; m.visible = this.showPlan; this.planMesh = m; this.root.add(m);
      });
    }

    const sun = this.sun;
    sun.position.set(cx - span * 0.6, span * 1.4, cz + span * 0.9); sun.target.position.set(cx, 0, cz);
    const sc = sun.shadow.camera, e = span * 0.85 + 6;
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 1; sc.far = span * 5; sc.updateProjectionMatrix();

    this.setFurniture(listing.furniture || []);
    if (this.mode === 'walk') this.setMode('orbit');
    this.resetView(true);
  }

  _label(rm) {
    const div = document.createElement('div'); div.className = 'hv-label' + (rm.w * rm.d < 60 ? ' small' : '');
    const photos = (this.listing.photos || []).filter(p => p.roomId === rm.id).length;
    div.innerHTML = `<button class="hv-room" type="button">${esc(rm.name)}<span>${fmtFt(rm.w)} × ${fmtFt(rm.d)}</span></button>` +
      (photos ? `<button class="hv-photo" type="button" title="See photos">${CAMERA_ICON}${photos}</button>` : '');
    div.querySelector('.hv-room').onclick = () => { this.goToRoom(rm.id); this.dispatchEvent(new CustomEvent('roomclick', { detail: rm.id })); };
    div.querySelector('.hv-photo')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('photos', { detail: rm.id })));
    div.addEventListener('pointerdown', e => e.stopPropagation());
    const obj = new CSS2DObject(div); obj.position.set(rm.x + rm.w / 2, 0.3, rm.y + rm.d / 2);
    this.root.add(obj); this.labelObjs.push(obj);
  }

  _clear(group) {
    for (const ch of [...group.children]) {
      group.remove(ch);
      ch.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
      });
    }
  }

  // ---------------- furniture ----------------
  setFurniture(list) {
    this._clear(this.furnGroup); this.meshes.clear();
    this.furniture = list.map(f => ({ ...f }));
    for (const f of this.furniture) this._addMesh(f);
    this.selectedId = null; this._retint();
    this.dispatchEvent(new CustomEvent('select', { detail: null }));
  }
  _addMesh(f) { const g = buildFurnitureMesh(f); this.meshes.set(f.id, g); this.furnGroup.add(g); this._pose(f); }
  _pose(f) { const g = this.meshes.get(f.id); g.position.set(f.x, 0, f.y); g.rotation.y = -(f.rot || 0) * Math.PI / 180; }
  _retint() {
    for (const f of this.furniture) {
      f._bad = collides(f, this.wallRects, this.furniture);
      tint(this.meshes.get(f.id), f._bad ? 0x8a0f0f : f.id === this.selectedId ? 0x173a63 : 0x000000);
    }
  }
  getFurniture() { return this.furniture.map(({ _bad, ...f }) => ({ ...f })); }
  get(id) { return this.furniture.find(f => f.id === id); }
  roomOf(f) { return roomAt(this.rooms, f.x, f.y); }

  /** Add an item (feet) into a room, auto-placing it. Returns {item, placed:boolean}. */
  addItem(item, roomId) {
    const room = this.rooms.find(r => r.id === roomId) || this.rooms[0];
    const f = { ...item };
    const spot = room && autoPlace(room, f, this.furniture, this.wallRects, this.zones);
    if (spot) Object.assign(f, spot); else if (room) Object.assign(f, { x: room.x + room.w / 2, y: room.y + room.d / 2, rot: 0 });
    this.furniture.push(f); this._addMesh(f); this.select(f.id); this._changed();
    return { item: f, placed: !!spot };
  }
  updateItem(id, patch) {
    const f = this.get(id); if (!f) return;
    const rebuild = ['w', 'd', 'h', 'kind', 'shape'].some(k => k in patch && patch[k] !== f[k]);
    Object.assign(f, patch);
    if (rebuild) { const old = this.meshes.get(id); this.furnGroup.remove(old); this._clear(old); this._addMesh(f); }
    this._pose(f); this._retint(); this._changed();
  }
  rotateSelected(deg = 90) { const f = this.get(this.selectedId); if (f) this.updateItem(f.id, { rot: (((f.rot || 0) + deg) % 360 + 360) % 360 }); }
  removeItem(id = this.selectedId) {
    const g = this.meshes.get(id); if (!g) return;
    this.furnGroup.remove(g); this._clear(g); this.meshes.delete(id);
    this.furniture = this.furniture.filter(f => f.id !== id);
    if (this.selectedId === id) this.select(null);
    this._retint(); this._changed();
  }
  select(id) {
    this.selectedId = id; this._retint();
    this.dispatchEvent(new CustomEvent('select', { detail: id ? this.get(id) : null }));
  }
  _changed() { this.dispatchEvent(new CustomEvent('change')); }

  // ---------------- view control ----------------
  setShowPlan(on) { this.showPlan = on; if (this.planMesh) this.planMesh.visible = on; }

  resetView(instant) {
    const b = this.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const span = Math.max(b.x1 - b.x0, b.z1 - b.z0, 10);
    const aspect = this.camera.aspect || 1.5;
    const dist = span * (aspect < 1 ? 1.75 : 1.15) + 6;
    this._flyTo(new THREE.Vector3(cx, 0, cz), new THREE.Vector3(cx + dist * 0.08, dist * 0.95, cz + dist * 0.45), instant);
    this.currentRoomId = null;
  }
  _flyTo(target, pos, instant) {
    if (instant) { this.controls.target.copy(target); this.camera.position.copy(pos); this.controls.update(); this._anim = null; return; }
    this._anim = { t: 0, dur: 0.7, fT: this.controls.target.clone(), tT: target, fP: this.camera.position.clone(), tP: pos };
  }

  goToRoom(id) {
    const rm = this.rooms.find(r => r.id === id); if (!rm) return;
    this.currentRoomId = id;
    const cx = rm.x + rm.w / 2, cz = rm.y + rm.d / 2;
    if (this.mode === 'walk') {
      const p = this._freeSpot(cx, cz); this.walk.x = p.x; this.walk.z = p.z; return;
    }
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    dir.y = Math.max(dir.y, 0.75); dir.normalize();
    const dist = Math.max(rm.w, rm.d) * 1.3 + 9;
    this._flyTo(new THREE.Vector3(cx, 0, cz), new THREE.Vector3(cx, 0, cz).add(dir.multiplyScalar(dist)));
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    const walking = mode === 'walk';
    this.controls.enabled = !walking;
    if (this.ceilings) this.ceilings.visible = walking;
    this.labelObjs.forEach(l => (l.visible = !walking));
    this.camera.fov = walking ? 72 : 50; this.camera.updateProjectionMatrix();
    this.hemi.intensity = walking ? 2.4 : 1.5;   // interiors under a ceiling need more fill light
    if (walking) {
      const t = this.controls.target;
      const rm = this.rooms.find(r => r.id === this.currentRoomId) || this.rooms.find(r => /living|family|great|foyer|entry/i.test(r.name)) || roomAt(this.rooms, t.x, t.z) || this.rooms[0];
      const p = rm ? this._freeSpot(rm.x + rm.w / 2, rm.y + rm.d / 2) : { x: t.x, z: t.z };
      Object.assign(this.walk, { x: p.x, z: p.z, pitch: -0.05 });
      if (rm) this.walk.yaw = rm.w >= rm.d ? Math.PI / 2 : 0;
      this._anim = null;
    } else {
      const { x, z } = this.walk;
      this._flyTo(new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 4, 34, z + 24), true);
    }
    this.dispatchEvent(new CustomEvent('mode', { detail: mode }));
  }
  setMoveInput(f = 0, s = 0, turn = 0) { Object.assign(this.walk.input, { f, s, turn }); }

  _blocked(x, z) {
    const R = 0.6, r = { x0: x - R, x1: x + R, z0: z - R, z1: z + R };
    return this.wallRects.some(w => overlap(r, w)) || this.furniture.some(f => !isNoCollide(f) && overlap(r, rectOf(f)));
  }
  _freeSpot(x, z) {
    if (!this._blocked(x, z)) return { x, z };
    for (let rad = 0.5; rad < 12; rad += 0.5) for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
      if (!this._blocked(px, pz) && roomAt(this.rooms, px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  // ---------------- input ----------------
  _bind() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => this._down(e), { capture: true });
    window.addEventListener('pointermove', this._mv = e => this._move(e));
    window.addEventListener('pointerup', this._upH = e => this._up(e));
    const typing = e => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    window.addEventListener('keydown', this._kd = e => {
      if (typing(e)) return;
      this.walk.keys.add(e.code);
      if (this.mode === 'walk' && /^(Arrow|Key[WASD])/.test(e.code)) e.preventDefault();
      if (e.code === 'KeyR' && this.selectedId) this.rotateSelected(e.shiftKey ? -90 : 90);
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedId) { e.preventDefault(); this.removeItem(); }
      if (e.code === 'Escape') this.select(null);
    });
    window.addEventListener('keyup', this._ku = e => this.walk.keys.delete(e.code));
    window.addEventListener('blur', this._bl = () => this.walk.keys.clear());
    el.addEventListener('wheel', e => {
      if (this.mode !== 'walk') return;
      e.preventDefault(); this.camera.fov = clamp(this.camera.fov + e.deltaY * 0.03, 40, 90); this.camera.updateProjectionMatrix();
    }, { passive: false });
  }
  _ndc(e) { this.camera.updateMatrixWorld(); const r = this.renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  _floorPoint(e) { this.ray.setFromCamera(this._ndc(e), this.camera); const v = new THREE.Vector3(); return this.ray.ray.intersectPlane(this.floor, v) ? v : null; }
  _pick(e) {
    this.ray.setFromCamera(this._ndc(e), this.camera);
    const hit = this.ray.intersectObjects(this.furnGroup.children, true)[0];
    let o = hit?.object; while (o && !o.userData.fid) o = o.parent;
    return o ? this.get(o.userData.fid) : null;
  }
  _down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this._press = { x: e.clientX, y: e.clientY, moved: false };
    if (this.mode === 'walk') { this._look = { x: e.clientX, y: e.clientY }; return; }
    const f = this._pick(e);
    if (f) {
      this.select(f.id);
      const p = this._floorPoint(e) || new THREE.Vector3(f.x, 0, f.y);
      this.drag = { id: f.id, ox: p.x - f.x, oz: p.z - f.y, moved: false };
      this.controls.enabled = false;
    }
  }
  _move(e) {
    if (this._press && Math.hypot(e.clientX - this._press.x, e.clientY - this._press.y) > 5) this._press.moved = true;
    if (this.drag) {
      const p = this._floorPoint(e); const f = this.get(this.drag.id); if (!p || !f) return;
      const snap = v => Math.round(v * 4) / 4;
      f.x = snap(p.x - this.drag.ox); f.y = snap(p.z - this.drag.oz); this.drag.moved = true;
      this._pose(f); this._retint();
    } else if (this._look) {
      this.walk.yaw -= (e.clientX - this._look.x) * 0.005;
      this.walk.pitch = clamp(this.walk.pitch - (e.clientY - this._look.y) * 0.005, -1.2, 1.2);
      this._look = { x: e.clientX, y: e.clientY };
    }
  }
  _up(e) {
    const click = this._press && !this._press.moved;
    if (this.drag) {
      if (this.drag.moved) { this._changed(); this.dispatchEvent(new CustomEvent('select', { detail: this.get(this.drag.id) })); }
      this.drag = null; this.controls.enabled = this.mode !== 'walk';
    } else if (click && e.target === this.renderer.domElement) {
      const f = this._pick(e); this.select(f ? f.id : null);
    }
    this._look = null; this._press = null;
  }

  // ---------------- loop ----------------
  _resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h); this.css.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.mode === 'walk') {
      const k = this.walk.keys, inp = this.walk.input;
      let f = inp.f, s = inp.s, turn = inp.turn;
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyA')) s -= 1;
      if (k.has('KeyD')) s += 1;
      if (k.has('ArrowLeft') || k.has('KeyQ')) turn += 1;
      if (k.has('ArrowRight') || k.has('KeyE')) turn -= 1;
      this.walk.yaw += turn * 1.8 * dt;
      const sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? 11 : 6) * dt, yaw = this.walk.yaw;
      const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp, dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp;
      const stuck = this._blocked(this.walk.x, this.walk.z);
      if (stuck || !this._blocked(this.walk.x + dx, this.walk.z)) this.walk.x += dx;
      if (stuck || !this._blocked(this.walk.x, this.walk.z + dz)) this.walk.z += dz;
      this.camera.position.set(this.walk.x, EYE_H, this.walk.z);
      this.camera.rotation.set(this.walk.pitch, this.walk.yaw, 0, 'YXZ');
      const rm = roomAt(this.rooms, this.walk.x, this.walk.z);
      if (rm && rm.id !== this._walkRoom) { this._walkRoom = rm.id; this.dispatchEvent(new CustomEvent('walkroom', { detail: rm })); }
    } else {
      if (this._anim) {
        const a = this._anim; a.t += dt; const u = Math.min(1, a.t / a.dur), k = 1 - Math.pow(1 - u, 3);
        this.controls.target.lerpVectors(a.fT, a.tT, k); this.camera.position.lerpVectors(a.fP, a.tP, k);
        if (u >= 1) this._anim = null;
      }
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  }

  screenshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/jpeg', 0.85); }

  dispose() {
    this.renderer.setAnimationLoop(null); this._ro.disconnect();
    window.removeEventListener('pointermove', this._mv); window.removeEventListener('pointerup', this._upH);
    window.removeEventListener('keydown', this._kd); window.removeEventListener('keyup', this._ku); window.removeEventListener('blur', this._bl);
    this._clear(this.root); this._clear(this.furnGroup); this.renderer.dispose();
    this.el.innerHTML = '';
  }
}
