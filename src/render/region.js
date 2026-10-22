// The region around the warehouse: roads, factories, stores, the truck depot,
// trees, the signs on every building, and all trucks driving between them.
import * as THREE from 'three';
import { makeTruck } from './trucks.js';
import { TRUCK_HALF } from '../sim/map.js';
import { SHELF_MAX } from '../sim/world.js';
import { makeRng } from '../sim/random.js';
import { Batch } from './merge.js';
import { GLOW, shiny } from './look.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function canvasPanel(w, h, pxPerM = 60) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * pxPerM);
  cv.height = Math.round(h * pxPerM);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  return { cv, g: cv.getContext('2d'), tex, mesh };
}

// Two geometries as one (both need the same attributes).
function mergeTwo(a, b) {
  const batch = new Batch();
  batch.add('x', a).add('x', b);
  return batch.geometries().get('x');
}

// Materials shared by the merged details on every site.
const DETAIL = shiny(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));
const LINES = new THREE.MeshLambertMaterial({ vertexColors: true });
const FENCE = new THREE.MeshStandardMaterial({ color: 0x8a939c, roughness: 0.7, metalness: 0.4, transparent: true, opacity: 0.35, depthWrite: false });

// A flat strip on the ground, w wide and l long (along z).
function groundLine(w, l) {
  const geo = new THREE.PlaneGeometry(w, l);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Metal wall cladding: light panels with vertical ribs, repeated along the wall.
let ribTex = null;
function ribTexture() {
  if (ribTex) return ribTex;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#d6d3cc';
  g.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 8) {
    g.fillStyle = 'rgba(0,0,0,0.13)';
    g.fillRect(x, 0, 2, 64);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(x + 2, 0, 1, 64);
  }
  g.fillStyle = '#a19d95';
  g.fillRect(0, 58, 128, 6);
  ribTex = new THREE.CanvasTexture(cv);
  ribTex.colorSpace = THREE.SRGBColorSpace;
  ribTex.wrapS = THREE.RepeatWrapping;
  ribTex.repeat.set(4, 1);
  ribTex.anisotropy = 4;
  return ribTex;
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const hsl = (p) => `hsl(${Math.round(p.hue * 360)} ${Math.round(p.sat * 100)}% ${Math.round(p.light * 100)}%)`;

export class Region {
  constructor(scene, world) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.truckViews = new Map();
    this.build(world);
  }

  rebuild(world) {
    this.scene.remove(this.group);
    for (const v of this.truckViews.values()) this.scene.remove(v);
    this.truckViews.clear();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.build(world);
  }

  build(world) {
    const g = this.group;
    const map = world.map;

    // Roads: asphalt strips with a dashed centre line and white edges.
    // Each kind is one instanced mesh, so hundreds of road pieces cost only three draw calls.
    const strips = [];
    const dashes = [];
    const edges = [];
    const kerbs = [];
    // Ends of the wide roads, where the narrow site roads join them.
    const wideEnds = map.roads.filter((r) => r.width >= 9).flatMap((r) => [r.a, r.b]);
    const onWide = (p) => wideEnds.some((q) => Math.abs(q.x - p.x) < 1 && Math.abs(q.z - p.z) < 1);
    for (const r of map.roads) {
      const dx = r.b.x - r.a.x;
      const dz = r.b.z - r.a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const angle = Math.atan2(dx, dz);
      strips.push([(r.a.x + r.b.x) / 2, 0.035, (r.a.z + r.b.z) / 2, angle, r.width, len + r.width]);
      // A light concrete kerb and verge just wider than the asphalt; overlapping pieces join up cleanly.
      kerbs.push([(r.a.x + r.b.x) / 2, -0.03, (r.a.z + r.b.z) / 2, angle, r.width + 1.6, len + r.width + 1.6]);
      if (r.width < 9) {
        // Stop line on the lane that leads onto the main road.
        for (const [end, other] of [[r.a, r.b], [r.b, r.a]]) {
          if (!onWide(end)) continue;
          const fx = (end.x - other.x) / len;
          const fz = (end.z - other.z) / len;
          const back = 4.5 + 1.4;
          const side = r.width / 4;
          dashes.push([end.x - fx * back - fz * side, 0.06, end.z - fz * back + fx * side, angle, r.width / 2 - 0.4, 0.45]);
        }
      }
      if (r.width < 9) continue;
      for (let d = 3; d < len - 2; d += 7) dashes.push([r.a.x + (dx * d) / len, 0.06, r.a.z + (dz * d) / len, angle, 0.2, 3]);
      for (const side of [-1, 1]) {
        const nx = (dz / len) * side * (r.width / 2 - 0.4);
        const nz = (-dx / len) * side * (r.width / 2 - 0.4);
        edges.push([(r.a.x + r.b.x) / 2 + nx, 0.05, (r.a.z + r.b.z) / 2 + nz, angle, 0.15, len]);
      }
    }
    const flat = (list, material) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      list.forEach(([x, y, z, angle, w, l], i) => {
        q.setFromAxisAngle(up, angle);
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, 1, l)));
      });
      mesh.receiveShadow = true;
      g.add(mesh);
    };
    flat(kerbs, mat(0xa3a39b, { roughness: 1 }));
    flat(strips, mat(0x3f4348, { roughness: 0.95 }));
    flat(dashes, new THREE.MeshBasicMaterial({ color: 0xe5e7eb }));
    flat(edges, new THREE.MeshBasicMaterial({ color: 0xbfc4ca }));

    this.factorySigns = world.factories.map((f) => this.buildFactory(f, world));
    this.storeSigns = world.stores.map((s) => this.buildStore(s));
    this.buildDepot(map.depot);
    this.buildTrees(world);
    this.buildLamps(map);
    this.lastDraw = -1;
  }

  // Every site is built in its own frame, turned to face the ring road:
  // local x runs along the road (u), local -z points away from it (v).
  siteGroup(site) {
    const sg = new THREE.Group();
    sg.position.set(site.origin.x, 0, site.origin.z);
    sg.rotation.y = site.angle;
    this.group.add(sg);
    return sg;
  }

  buildFactory(f, world) {
    const g = this.siteGroup(f);
    const W = 46;
    const D = 24;
    const H = 10;
    const cz = -(f.faceV + D / 2); // building centre
    const face = -f.faceV; // the wall with the docks, facing the road
    const wall = mat(0xffffff, { map: ribTexture() });
    const darker = mat(0x9ca3af, { metalness: 0.3 });
    const accent = mat(0x0f766e);
    // Concrete apron in front of the docks.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(W + 30, 22), mat(0x8d9096, { roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.01, face + 9);
    apron.receiveShadow = true;
    g.add(apron);
    const hall = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall));
    hall.position.set(0, H / 2, cz);
    g.add(hall);
    // Saw-tooth roof.
    for (let k = 0; k < 5; k++) {
      const tooth = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W / 5 - 0.4, 2.4, D), darker));
      tooth.position.set(-W / 2 + (k + 0.5) * (W / 5), H + 1.0, cz);
      tooth.rotation.z = 0.35;
      g.add(tooth);
    }
    // Chimney with a band.
    const chimney = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 22, 18), mat(0xb45309)));
    chimney.position.set(W / 2 - 4, 11, cz - D / 2 + 4);
    g.add(chimney);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.4, 18), mat(0xf5f5f4));
    band.position.set(chimney.position.x, 19, chimney.position.z);
    g.add(band);
    // Coloured stripe and dock doors.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.8, D + 0.1), accent);
    stripe.position.set(0, H - 0.8, cz);
    g.add(stripe);
    for (const d of f.docks) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.8, 0.2), mat(0x64748b, { metalness: 0.4 }));
      door.position.set(d.u, 2.2, face + 0.05);
      g.add(door);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.3, 0.3), mat(0xf2b705));
      frame.position.set(d.u, 4.2, face + 0.1);
      g.add(frame);
    }
    // Garage where the factory's trucks wait.
    const garage = shadowy(new THREE.Mesh(new THREE.BoxGeometry(12, 5, 9), mat(0xa8a29e)));
    garage.position.set(f.garageU - 10, 2.5, -f.serviceV);
    g.add(garage);
    const gdoor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 4.5), mat(0x57534e));
    gdoor.position.set(f.garageU - 3.9, 2, -f.serviceV);
    g.add(gdoor);

    // Sign on the front wall.
    const sign = canvasPanel(26, 5.2, 50);
    sign.mesh.position.set(-6, 6.6, face + 0.12);
    g.add(sign.mesh);
    const details = this.factoryDetails(g, f, W, D, H, cz, face);
    return { sign, f, products: world.sim.products, details };
  }

  buildStore(s) {
    const g = this.siteGroup(s);
    const W = 38;
    const D = 22;
    const H = 7;
    const face = -s.faceV; // delivery side, facing the road
    const cz = face - D / 2;
    const shop = cz - D / 2; // shop front, facing the customers' car park
    const body = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(0xf1f5f9)));
    body.position.set(0, H / 2, cz);
    g.add(body);
    const roof = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.6, D + 1), mat(0x334155)));
    roof.position.set(0, H + 0.3, cz);
    g.add(roof);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(W - 6, 4, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.75 }),
    );
    glass.position.set(0, 2.4, shop - 0.05);
    g.add(glass);
    const canopy = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W - 4, 0.4, 3), mat(0xdc2626)));
    canopy.position.set(0, 4.8, shop - 1.5);
    g.add(canopy);
    // Delivery door.
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.8, 0.2), mat(0x64748b, { metalness: 0.4 }));
    door.position.set(s.dockU, 2.2, face + 0.05);
    g.add(door);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(W + 14, 18), mat(0x8d9096, { roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.01, face + 8);
    apron.receiveShadow = true;
    g.add(apron);
    // Customer car park with a few cars.
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(W + 10, 22), mat(0x52565c, { roughness: 1 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(0, 0.015, shop - 14);
    lot.receiveShadow = true;
    g.add(lot);
    const carColors = [0xef4444, 0x3b82f6, 0xf8fafc, 0x111827, 0x22c55e, 0xeab308, 0x94a3b8];
    for (let k = 0; k < 9; k++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 4.2), mat(carColors[(k * 3 + s.id) % carColors.length], { metalness: 0.4, roughness: 0.4 }));
      body.position.y = 0.6;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), mat(0x1f2937, { metalness: 0.5, roughness: 0.2 }));
      top.position.set(0, 1.25, -0.2);
      car.add(body, top);
      car.position.set(-W / 2 + 3 + k * 4.2, 0, shop - 12 - (k % 2) * 7);
      car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      if ((k * 7 + s.id) % 3 !== 0) g.add(car);
    }
    // Store name above the shop front, and the status sign on the delivery side.
    const front = canvasPanel(W - 8, 2.4, 50);
    front.mesh.position.set(0, 6.0, shop - 0.12);
    front.mesh.rotation.y = Math.PI;
    g.add(front.mesh);
    const back = canvasPanel(20, 4.4, 50);
    back.mesh.position.set(6, 4.6, face + 0.12);
    g.add(back.mesh);
    return { front, back, s };
  }

  // Pipes, tanks, windows, a fence, dock bumpers and lamps, and painted lines on the apron.
  // All of it is merged into a handful of meshes in its own group.
  factoryDetails(g, f, W, D, H, cz, face) {
    const b = new Batch();
    const back = cz - D / 2;
    const DARK = 0x1f2329;
    const STEEL = 0xaab2bc;
    const TANK = 0xdfe3e8;
    const PIPE = 0x9aa5b1;
    // Two tanks beside the hall with pipes into the wall.
    const tank = new THREE.CylinderGeometry(2.2, 2.2, 9, 16);
    const cap = new THREE.ConeGeometry(2.25, 1.2, 16);
    const pipe = new THREE.CylinderGeometry(0.22, 0.22, 1, 8);
    for (const [k, tz] of [[0, cz - 5], [1, cz + 1]]) {
      const tx = -W / 2 - 4.5 - k * 0.2;
      b.add(DETAIL, tank, tx, 4.5, tz, 0, 0, 0, TANK);
      b.add(DETAIL, cap, tx, 9.6, tz, 0, 0, 0, TANK);
      b.box(DETAIL, 0.6, 0.1, 4.6, tx, 7.0, tz, 0, STEEL);
      // Pipe from the tank to the wall.
      b.add(DETAIL, pipe.clone().scale(1, 2.4, 1), tx + 2.2 + 0.6, 6.5 - k * 1.2, tz, 0, 0, Math.PI / 2, PIPE);
    }
    // A long pipe along the back wall on brackets, and two downpipes.
    b.add(DETAIL, pipe.clone().scale(1.4, W - 2, 1.4), 0, H - 1.8, back - 0.6, 0, 0, Math.PI / 2, PIPE);
    for (let x = -W / 2 + 3; x < W / 2; x += 6) b.box(DETAIL, 0.15, 0.5, 0.7, x, H - 1.8, back - 0.3, 0, STEEL);
    for (const x of [-W / 2 + 1, W / 2 - 1]) b.add(DETAIL, pipe.clone().scale(0.6, H - 1.8, 0.6), x, (H - 1.8) / 2, back - 0.3, 0, 0, 0, PIPE);
    // Rooftop vents.
    const vent = new THREE.CylinderGeometry(0.5, 0.6, 1.4, 10);
    for (let k = 0; k < 5; k++) b.add(DETAIL, vent, -W / 2 + (k + 0.5) * (W / 5) + 3, H + 0.9, back + 1.6, 0, 0, 0, STEEL);
    // Windows: a band on both side walls and on the free part of the front.
    for (const sx of [-1, 1]) {
      for (let z = back + 2.5; z < face - 2; z += 3.4) b.box(GLOW.window, 0.1, 1.5, 2.6, sx * (W / 2 + 0.03), 6.4, z);
    }
    for (let x = 9.5; x < W / 2 - 1.5; x += 3.4) b.box(GLOW.window, 2.6, 1.5, 0.1, x, 6.6, face + 0.03);
    // Dock bumpers and a lamp over every door.
    for (const d of f.docks) {
      for (const s of [-1, 1]) b.box(DETAIL, 0.35, 0.55, 0.4, d.u + s * 1.5, 1.0, face + 0.25, 0, DARK);
      b.box(GLOW.lamp, 0.6, 0.15, 0.35, d.u, 4.75, face + 0.25);
    }
    // Fence around the back and sides of the site.
    const fx0 = -W / 2 - 9;
    const fx1 = W / 2 + 6;
    const fz0 = back - 7;
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2, 5);
    const fence = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ry = Math.atan2(x2 - x1, z2 - z1);
      for (let d = 0; d <= len; d += 3) b.add(DETAIL, post, x1 + ((x2 - x1) * d) / len, 1, z1 + ((z2 - z1) * d) / len, 0, 0, 0, STEEL);
      for (const y of [0.3, 1.9]) b.box(DETAIL, 0.05, 0.06, len, (x1 + x2) / 2, y, (z1 + z2) / 2, ry, STEEL);
      // Wire mesh: a thin grey panel.
      b.box(FENCE, 0.02, 1.6, len, (x1 + x2) / 2, 1.1, (z1 + z2) / 2, ry);
    };
    fence(fx0, face - 1, fx0, fz0);
    fence(fx0, fz0, fx1, fz0);
    fence(fx1, fz0, fx1, face - 1);
    // Lines on the apron: guides in front of each dock and staff parking on the right.
    for (const d of f.docks) {
      for (const s of [-1, 1]) b.add(LINES, groundLine(0.14, 12), d.u + s * 1.7, 0.03, face + 7, 0, 0, 0, 0xf2c014);
    }
    for (let k = 0; k <= 8; k++) b.add(LINES, groundLine(0.12, 5), 16 + k * 2.6, 0.03, face + 3.2, 0, 0, 0, 0xe5e7eb);
    const group = new THREE.Group();
    for (const mesh of b.meshes()) {
      // Only the solid parts cast shadows; paint, glass, lamps and the see-through fence do not.
      if (mesh.material !== DETAIL) mesh.castShadow = false;
      group.add(mesh);
    }
    g.add(group);
    return group;
  }

  buildDepot(d) {
    const g = this.group;
    const shed = shadowy(new THREE.Mesh(new THREE.BoxGeometry(16, 6, 12), mat(0xffffff, { map: ribTexture(), metalness: 0.2 })));
    shed.position.set(d.x + 12, 3, d.z);
    g.add(shed);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 5), mat(0x475569));
    door.position.set(d.x + 3.9, 2.5, d.z);
    g.add(door);
    // Roof edge, a small office, a fuel pump under a canopy, parking lines and a fence.
    const b = new Batch();
    b.box(DETAIL, 16.6, 0.4, 12.6, d.x + 12, 6.2, d.z, 0, 0x475569);
    b.box(DETAIL, 4, 3, 4, d.x + 17.5, 1.5, d.z + 9, 0, 0xe7e5e4);
    b.box(DETAIL, 4.4, 0.25, 4.4, d.x + 17.5, 3.1, d.z + 9, 0, 0x334155);
    b.box(GLOW.window, 2.4, 1, 0.1, d.x + 17.5, 1.8, d.z + 6.97);
    b.box(DETAIL, 6, 0.3, 4, d.x + 8, 4.6, d.z + 10, 0, 0xdc2626);
    for (const s of [-1, 1]) b.box(DETAIL, 0.2, 4.5, 0.2, d.x + 8 + s * 2.5, 2.25, d.z + 10, 0, 0xe5e7eb);
    b.box(DETAIL, 0.8, 1.6, 0.6, d.x + 8, 0.8, d.z + 10, 0, 0x1f2937);
    b.box(GLOW.lamp, 4.6, 0.08, 2.6, d.x + 8, 4.43, d.z + 10);
    b.box(GLOW.lamp, 0.6, 0.15, 0.35, d.x + 3.8, 5.3, d.z);
    for (let k = 0; k < 5; k++) b.add(LINES, groundLine(0.15, 12), d.x - 6 + k * 3.6, 0.03, d.z - 9, 0, Math.PI / 2, 0, 0xe5e7eb);
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2, 5);
    for (let x = d.x - 10; x <= d.x + 30; x += 3) {
      b.add(DETAIL, post, x, 1, d.z + 15, 0, 0, 0, 0xaab2bc);
    }
    b.box(DETAIL, 40, 0.06, 0.05, d.x + 10, 1.9, d.z + 15, 0, 0xaab2bc);
    b.box(FENCE, 40, 1.6, 0.02, d.x + 10, 1.1, d.z + 15);
    for (const mesh of b.meshes()) {
      if (mesh.material !== DETAIL) mesh.castShadow = false;
      g.add(mesh);
    }
    // Concrete yard under the parked trucks.
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(44, 30), mat(0x8d9096, { roughness: 1 }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(d.x + 8, 0.01, d.z);
    yard.receiveShadow = true;
    g.add(yard);
    const sign = canvasPanel(10, 1.8, 50);
    sign.mesh.position.set(d.x + 12, 7.4, d.z - 6.05);
    sign.mesh.rotation.y = Math.PI;
    const { g: c, cv } = sign;
    c.fillStyle = '#0b1220';
    c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#facc15';
    c.font = `700 ${cv.height * 0.55}px ${FONT}`;
    c.fillText('TRUCK DEPOT', cv.width * 0.06, cv.height * 0.7);
    sign.tex.needsUpdate = true;
    g.add(sign.mesh);
  }

  // Trees scattered around, kept off roads and buildings.
  buildTrees(world) {
    const map = world.map;
    const rng = makeRng(world.settings.seed + 3).next;
    const { RX, RZ } = map.ring;
    const sites = [...world.factories, ...world.stores];
    const blocked = (x, z) => {
      if (Math.abs(x) < 90 && Math.abs(z) < RZ + 8) return true; // warehouse, yards and their links
      // On or next to the ring road.
      const inOuter = Math.abs(x) < RX + 9 && Math.abs(z) < RZ + 9;
      const inInner = Math.abs(x) < RX - 9 && Math.abs(z) < RZ - 9;
      if (inOuter && !inInner) return true;
      // Inside a site's footprint, measured in its own frame.
      for (const s of sites) {
        const dx = x - s.origin.x;
        const dz = z - s.origin.z;
        const u = dx * s.U[0] + dz * s.U[1];
        const v = dx * s.V[0] + dz * s.V[1];
        if (u > -64 && u < 42 && v > -4 && v < s.faceV + s.depth + 36) return true;
      }
      if (Math.abs(x - map.depot.x - 8) < 22 && Math.abs(z - map.depot.z) < 16) return true;
      return false;
    };
    const b = map.bounds;
    // Three kinds: conifers, round leafy trees and low bushes. Many grow in small groves.
    const kinds = [[], [], []];
    let last = null;
    for (let k = 0; k < 6000 && kinds[0].length + kinds[1].length + kinds[2].length < 850; k++) {
      let x;
      let z;
      if (last && rng() < 0.55) {
        x = last[0] + (rng() - 0.5) * 22;
        z = last[1] + (rng() - 0.5) * 22;
      } else {
        x = b.minX - 60 + rng() * (b.maxX - b.minX + 120);
        z = b.minZ - 60 + rng() * (b.maxZ - b.minZ + 120);
      }
      if (blocked(x, z)) continue;
      last = [x, z];
      const r = rng();
      kinds[r < 0.42 ? 0 : r < 0.75 ? 1 : 2].push([x, z, 0.8 + rng() * 0.8, rng() * Math.PI * 2]);
    }
    const [conifers, leafy, bushes] = kinds;
    const leafMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true });
    // A conifer is two stacked cones in one geometry.
    const coneLow = new THREE.ConeGeometry(2.3, 3.8, 8, 1, true);
    coneLow.translate(0, 1.9, 0);
    const coneHigh = new THREE.ConeGeometry(1.6, 3.4, 8, 1, true);
    coneHigh.translate(0, 4.1, 0);
    const coniferGeo = mergeTwo(coneLow, coneHigh);
    const leafyGeo = new THREE.DodecahedronGeometry(2.3, 0);
    const bushGeo = new THREE.IcosahedronGeometry(1.3, 0);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6, 1, true), mat(0x6b4f35), conifers.length + leafy.length);
    const coniferMesh = new THREE.InstancedMesh(coniferGeo, leafMat(0xffffff), conifers.length);
    const leafyMesh = new THREE.InstancedMesh(leafyGeo, leafMat(0xffffff), leafy.length);
    const bushMesh = new THREE.InstancedMesh(bushGeo, leafMat(0xffffff), bushes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    let t = 0;
    const addTrunk = (x, z, s) => trunk.setMatrixAt(t++, m.compose(p.set(x, 1.3 * s, z), q.identity(), sc.set(s, s, s)));
    conifers.forEach(([x, z, s, a], i) => {
      addTrunk(x, z, s);
      q.setFromAxisAngle(up, a);
      coniferMesh.setMatrixAt(i, m.compose(p.set(x, 1.6 * s, z), q, sc.set(s, s * (0.9 + (a % 0.4)), s)));
      coniferMesh.setColorAt(i, c.setHSL(0.36 + rng() * 0.05, 0.42, 0.2 + rng() * 0.08));
    });
    leafy.forEach(([x, z, s, a], i) => {
      addTrunk(x, z, s);
      q.setFromAxisAngle(up, a);
      leafyMesh.setMatrixAt(i, m.compose(p.set(x, 3.6 * s, z), q, sc.set(s, s * 0.9, s)));
      // Mostly fresh green, now and then a yellowish one.
      const hue = rng() < 0.15 ? 0.14 + rng() * 0.05 : 0.24 + rng() * 0.07;
      leafyMesh.setColorAt(i, c.setHSL(hue, 0.45, 0.3 + rng() * 0.1));
    });
    bushes.forEach(([x, z, s, a], i) => {
      q.setFromAxisAngle(up, a);
      bushMesh.setMatrixAt(i, m.compose(p.set(x, 0.55 * s, z), q, sc.set(s * 1.2, s * 0.75, s)));
      bushMesh.setColorAt(i, c.setHSL(0.25 + rng() * 0.07, 0.4, 0.26 + rng() * 0.1));
    });
    for (const im of [trunk, coniferMesh, leafyMesh, bushMesh]) {
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    }
  }

  // Street lamps along the outside of the ring road; their heads glow at night.
  buildLamps(map) {
    const { RX, RZ } = map.ring;
    const ends = map.roads.flatMap((r) => [r.a, r.b]);
    const spots = [];
    const sides = [
      [[-RX, -RZ], [RX, -RZ], [0, -1]],
      [[RX, -RZ], [RX, RZ], [1, 0]],
      [[RX, RZ], [-RX, RZ], [0, 1]],
      [[-RX, RZ], [-RX, -RZ], [-1, 0]],
    ];
    for (const [a, b2, out] of sides) {
      const len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
      for (let d = 18; d < len - 12; d += 34) {
        const x = a[0] + ((b2[0] - a[0]) * d) / len;
        const z = a[1] + ((b2[1] - a[1]) * d) / len;
        // Leave junctions free.
        if (ends.some((e) => Math.hypot(e.x - x, e.z - z) < 11)) continue;
        spots.push([x + out[0] * 6.2, z + out[1] * 6.2, Math.atan2(-out[0], -out[1])]);
      }
    }
    // Pole with its arm in one geometry; the arm points along local +z toward the road.
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 7, 6);
    pole.translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 2.2);
    arm.translate(0, 6.9, 1.0);
    const poles = new THREE.InstancedMesh(mergeTwo(pole, arm), mat(0x4b5563, { metalness: 0.5, roughness: 0.5 }), spots.length);
    const headGeo = new THREE.BoxGeometry(0.42, 0.14, 0.8);
    headGeo.translate(0, 6.84, 2.0);
    const heads = new THREE.InstancedMesh(headGeo, GLOW.lamp, spots.length);
    const poolGeo = new THREE.PlaneGeometry(16, 16);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0.09, 2.0);
    const pools = new THREE.InstancedMesh(poolGeo, GLOW.pool, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, a], i) => {
      q.setFromAxisAngle(up, a);
      m.compose(p.set(x, 0, z), q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      pools.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    this.group.add(poles, heads, pools);
  }

  // ---------- every frame ----------
  update(world, alpha, realTime) {
    const alive = new Set();
    for (const t of world.trucks) {
      alive.add(t.id);
      let v = this.truckViews.get(t.id);
      if (!v) {
        v = makeTruck(t.color);
        this.truckViews.set(t.id, v);
        this.scene.add(v);
      }
      let dh = t.heading - t.pheading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const h = t.pheading + dh * alpha;
      const cx = t.px + (t.x - t.px) * alpha;
      const cz = t.pz + (t.z - t.pz) * alpha;
      // The model's origin is the rear doors.
      v.position.set(cx - Math.cos(h) * TRUCK_HALF, 0, cz - Math.sin(h) * TRUCK_HALF);
      v.rotation.y = -h - Math.PI / 2;
      v.userData.truckId = t.id;
    }
    for (const [id, v] of this.truckViews) {
      if (!alive.has(id)) {
        this.scene.remove(v);
        this.truckViews.delete(id);
      }
    }
    if (realTime - this.lastDraw > 0.5) {
      this.lastDraw = realTime;
      for (const fs of this.factorySigns) this.drawFactory(fs, world);
      for (const ss of this.storeSigns) this.drawStore(ss, world);
    }
  }

  drawFactory({ sign, f, products }, world) {
    const { g, cv, tex } = sign;
    const W = cv.width;
    const H = cv.height;
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#5eead4';
    g.font = `700 ${H * 0.2}px ${FONT}`;
    g.fillText(`FACTORY ${f.id + 1} · ${f.name.toUpperCase()}`, W * 0.03, H * 0.24);
    const ready = f.stock.reduce((a, b) => a + b, 0);
    g.fillStyle = '#e2e8f0';
    g.font = `600 ${H * 0.13}px ${FONT}`;
    const making = f.lines.map((l) => products[l.product].name).join(' + ');
    g.fillText(`Making: ${making}`, W * 0.03, H * 0.46);
    const open = f.orders.filter((o) => o.status === 'waiting' || o.status === 'loading').length;
    g.fillText(`Ready to ship: ${ready} boxes · Orders: ${open}`, W * 0.03, H * 0.66);
    // A coloured chip with the stock of each product.
    const chipW = (W * 0.94) / Math.max(4, f.products.length);
    f.products.forEach((p, i) => {
      const x = W * 0.03 + i * chipW;
      g.fillStyle = hsl(products[p]);
      g.fillRect(x, H * 0.76, chipW * 0.9, H * 0.18);
      g.fillStyle = '#0b1220';
      g.font = `700 ${H * 0.11}px ${FONT}`;
      g.fillText(`${products[p].name} ${f.stock[p]}`, x + chipW * 0.04, H * 0.89);
    });
    tex.needsUpdate = true;
  }

  drawStore({ front, back, s }, world) {
    const open = world.hour >= 8 && world.hour < 20;
    {
      const { g, cv, tex } = front;
      g.fillStyle = '#b91c1c';
      g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#fff';
      g.font = `800 ${cv.height * 0.55}px ${FONT}`;
      const name = `STORE ${s.id + 1} · ${s.name.toUpperCase()}`;
      g.fillText(name, (cv.width - g.measureText(name).width) / 2, cv.height * 0.7);
      g.fillStyle = open ? '#86efac' : '#fecaca';
      g.font = `700 ${cv.height * 0.3}px ${FONT}`;
      g.fillText(open ? 'OPEN' : 'CLOSED', cv.width * 0.02, cv.height * 0.4);
      tex.needsUpdate = true;
    }
    const { g, cv, tex } = back;
    const W = cv.width;
    const H = cv.height;
    const products = world.sim.products;
    const stock = s.stock.reduce((a, b) => a + b, 0);
    const cap = products.length * SHELF_MAX;
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fca5a5';
    g.font = `700 ${H * 0.18}px ${FONT}`;
    g.fillText(`${s.name.toUpperCase()} · ${open ? 'open' : 'closed'}`, W * 0.03, H * 0.22);
    g.fillStyle = '#e2e8f0';
    g.font = `600 ${H * 0.12}px ${FONT}`;
    g.fillText(`Stock ${stock}/${cap} · Sold today ${s.soldToday} · Missed ${s.lostToday}`, W * 0.03, H * 0.42);
    // Mini bars per product.
    const bw = (W * 0.94) / products.length;
    products.forEach((p, i) => {
      const f = s.stock[p.id] / SHELF_MAX;
      const x = W * 0.03 + i * bw;
      g.fillStyle = '#1e293b';
      g.fillRect(x, H * 0.52, bw * 0.8, H * 0.4);
      g.fillStyle = s.stock[p.id] ? hsl(p) : '#ef4444';
      const h = s.stock[p.id] ? H * 0.4 * f : H * 0.04;
      g.fillRect(x, H * 0.92 - h, bw * 0.8, h);
    });
    tex.needsUpdate = true;
  }

  truckMeshes() {
    return [...this.truckViews.values()];
  }
}
