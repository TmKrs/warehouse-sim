// The inside of every store: shelves filled with the store's stock, checkouts,
// fruit stands and fridges, a back room with the delivered boxes, and the
// customers, cashiers and staff. Only drawn (and updated) when the camera is
// close, see main.js. The movement comes from sim/storeFloor.js.
//
// Each store's inside is built in the site's own frame (see region.js):
// local x = u along the road, local z = -v away from it.
import * as THREE from 'three';
import { STORE, bayOf } from '../sim/storeFloor.js';

const L = STORE;
const MAX_PEOPLE = 32;
const MAX_BOXES = 700;
const MAX_TROLLEYS = 32;
const MAX_BASKETS = 32;
const SHELF_SLOTS = L.tiers.length * L.perLevel;
const TROLLEY_AHEAD = 0.8; // trolley centre in front of the person pushing it
const GOODS = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0xf8fafc, 0x7c3aed, 0x0891b2, 0xea580c, 0xdb2777];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

// A light tiled floor, drawn once and shared by every store.
function tileTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#e7e5e4';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#d6d3d1';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#a8a29e';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(64, 128);
  g.moveTo(0, 64);
  g.lineTo(128, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((L.halfWidth * 2) / 1.6, (L.depth - L.backWall) / 1.6);
  tex.anisotropy = 8;
  return tex;
}

// Shared by every store, made once.
let shared = null;
function sharedParts() {
  if (shared) return shared;
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // A limb hanging from its pivot (hip or shoulder) at the origin.
  const limb = (w, h, d) => box(w, h, d).translate(0, -h / 2, 0);
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shared = {
    geo: {
      unit: box(1, 1, 1), flat,
      pallet: box(1.2, 0.14, 1.2),
      leg: limb(0.14, 0.78, 0.15), arm: limb(0.1, 0.6, 0.11),
      torso: box(0.24, 0.62, 0.4),
      head: new THREE.SphereGeometry(0.12, 12, 8),
      hair: new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      fruit: new THREE.SphereGeometry(0.09, 8, 6),
      basket: box(0.42, 0.2, 0.3),
    },
    mat: {
      tiles: mat(0xffffff, { map: tileTexture(), roughness: 0.45 }),
      concrete: mat(0xa8adb3, { roughness: 0.9 }),
      wall: mat(0xe2e8f0, { roughness: 0.8 }),
      shelf: mat(0xf1f5f9, { roughness: 0.5, metalness: 0.2 }),
      spine: mat(0x94a3b8, { roughness: 0.6, metalness: 0.3 }),
      accent: mat(0xdc2626, { roughness: 0.5 }),
      tint: mat(0xffffff, { roughness: 0.6 }), // coloured per instance
      glow: new THREE.MeshBasicMaterial({ color: 0xffffff }), // coloured per instance, not lit
      counter: mat(0xcbd5e1, { roughness: 0.5, metalness: 0.2 }),
      belt: mat(0x1f2937, { roughness: 0.9 }),
      screen: new THREE.MeshBasicMaterial({ color: 0x5eead4 }),
      dark: mat(0x334155, { roughness: 0.5, metalness: 0.3 }),
      wood: mat(0xb08a5a, { roughness: 0.9 }),
      crate: mat(0x8b6b45, { roughness: 0.9 }),
      fridge: mat(0xf8fafc, { emissive: 0xdbeafe, emissiveIntensity: 0.25, roughness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xbfdbfe, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.25 }),
      card: mat(0xb88a55, { roughness: 0.95 }),
      baler: mat(0x15803d, { roughness: 0.5, metalness: 0.3 }),
      locker: mat(0x64748b, { metalness: 0.4 }),
      mats: mat(0x27272a, { roughness: 1 }),
      steel: mat(0xb6bec9, { metalness: 0.7, roughness: 0.35 }),
      tyre: mat(0x111111, { roughness: 0.9 }),
      basket: mat(0xdc2626, { roughness: 0.6 }),
      box: mat(0xffffff, { roughness: 0.75 }),
      person: mat(0xffffff, { roughness: 0.8 }), // clothes and skin, coloured per instance
    },
  };
  return shared;
}

// Reused every frame so nothing is allocated while drawing.
const _m = new THREE.Matrix4();
const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const GREEN = new THREE.Color(0x22c55e);
const RED = new THREE.Color(0xef4444);
const colorCache = new Map();
function color(hex) {
  let c = colorCache.get(hex);
  if (!c) colorCache.set(hex, (c = new THREE.Color(hex)));
  return c;
}

// Matrix for a box from its size and centre, turned by `rot` around y.
function boxMatrix(x, y, z, w, h, d, rot = 0) {
  _q.setFromAxisAngle(_UP, rot);
  return _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d));
}

// A trolley: +x is forward, the origin is the middle of its basket on the floor.
const TROLLEY = [
  [0, 0.42, 0, 0.8, 0.03, 0.5], // basket floor
  [0, 0.64, 0.25, 0.8, 0.42, 0.02], [0, 0.64, -0.25, 0.8, 0.42, 0.02], // sides
  [0.4, 0.62, 0, 0.02, 0.38, 0.5], [-0.4, 0.66, 0, 0.02, 0.46, 0.5], // front, back
  [-0.5, 0.98, 0, 0.05, 0.05, 0.56], // handle
  [-0.44, 0.5, 0.22, 0.03, 0.98, 0.03], [-0.44, 0.5, -0.22, 0.03, 0.98, 0.03], // posts
  [0, 0.14, 0, 0.72, 0.02, 0.44], // lower rack
];
const WHEELS = [[0.32, 0.06, 0.2], [0.32, 0.06, -0.2], [-0.36, 0.06, 0.2], [-0.36, 0.06, -0.2]];
const toLocals = (parts) => parts.map(([x, y, z, w = 0.1, h = 0.12, d = 0.06]) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)));
const TROLLEY_LOCALS = toLocals(TROLLEY);
const WHEEL_LOCALS = toLocals(WHEELS);

export class StoreInsides {
  constructor(world, groupForSite) {
    this.parts = sharedParts();
    this.productColors = world.sim.products.map((p) => new THREE.Color().setHSL(p.hue, p.sat, p.light));
    this.views = world.stores.map((s) => this.build(s, groupForSite(s)));
  }

  setOpen(i, open) {
    const v = this.views[i];
    if (v) v.group.visible = open;
  }

  // ---------- building ----------
  build(s, siteGroup) {
    const { geo, mat: M } = this.parts;
    const g = new THREE.Group();
    g.visible = false;
    siteGroup.add(g);
    const z = (w) => -(s.faceV + w); // local z for a distance from the delivery wall
    const W = L.halfWidth * 2;
    const add = (mesh, shadows = true) => {
      if (shadows) mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // Many copies of one part, as one draw call. Each item is [x, y, z, w, h, d, rot].
    const many = (geometry, material, items, shadows = true, colors = null) => {
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      items.forEach(([x, y, zz, w = 1, h = 1, d = 1, rot = 0], i) => mesh.setMatrixAt(i, boxMatrix(x, y, zz, w, h, d, rot)));
      if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
      return add(mesh, shadows);
    };
    const plane = (material, u0, u1, w0, w1, y) => {
      const m = new THREE.Mesh(geo.flat, material);
      m.scale.set(u1 - u0, 1, w1 - w0);
      m.position.set((u0 + u1) / 2, y, z((w0 + w1) / 2));
      m.receiveShadow = true;
      g.add(m);
    };

    // Floors: tiles in the shop, concrete in the back room.
    plane(M.tiles, -W / 2 + 0.3, W / 2 - 0.3, L.backWall, L.depth - 0.3, 0.025);
    plane(M.concrete, -W / 2 + 0.3, W / 2 - 0.3, 0.3, L.backWall, 0.025);

    // Walls inside: between back room and shop (with an opening), and the staff room.
    const D = L.staffDoorU;
    const half = L.staffDoorWidth / 2;
    const H = 2.6;
    const wallItems = [
      [(-W / 2 + D - half) / 2, H / 2, z(L.backWall), D - half + W / 2, H, 0.2],
      [(D + half + W / 2) / 2, H / 2, z(L.backWall), W / 2 - D - half, H, 0.2],
      [11, 1.4, z(1.95), 0.15, 2.8, 3.3], // staff room wall, open toward the back aisle
    ];
    many(geo.unit, M.wall, wallItems);
    // A red band on the shop side of the back wall.
    many(geo.unit, M.accent, [
      [(-W / 2 + D - half) / 2, H - 0.25, z(L.backWall) - 0.11, D - half + W / 2, 0.35, 0.02],
      [(D + half + W / 2) / 2, H - 0.25, z(L.backWall) - 0.11, W / 2 - D - half, 0.35, 0.02],
    ], false);

    // Gondolas: two white steps on each side of a grey middle panel, red end
    // panels, a coloured price strip on each step and a header board per product.
    const mid = (L.shelfFrom + L.shelfTo) / 2;
    const len = L.shelfTo - L.shelfFrom;
    const [t0, t1] = L.tiers;
    const gh = L.gondolaHalf;
    const inner = (t0.d + t1.d) / 2; // where the lower step ends and the upper starts
    const shelfItems = [];
    const spineItems = [];
    const endItems = [];
    for (const gu of L.gondolas) {
      for (const side of [-1, 1]) {
        shelfItems.push([gu + side * (gh + inner) / 2, t0.y / 2, z(mid), gh - inner, t0.y, len]);
        shelfItems.push([gu + side * inner / 2, t1.y / 2, z(mid), inner, t1.y, len]);
      }
      spineItems.push([gu, 0.8, z(mid), 0.08, 1.6, len]);
      for (let k = 0; k <= len / L.bayLen; k++) spineItems.push([gu, 0.85, z(L.shelfFrom + k * L.bayLen), 0.12, 1.7, 0.1]);
      for (const w of [L.shelfFrom - 0.03, L.shelfTo + 0.03]) {
        endItems.push([gu, t0.y / 2, z(w), gh * 2 + 0.04, t0.y + 0.02, 0.06]);
        endItems.push([gu, 0.8, z(w), 0.5, 1.6, 0.06]);
      }
    }
    many(geo.unit, M.shelf, shelfItems);
    many(geo.unit, M.spine, spineItems);
    many(geo.unit, M.accent, endItems);
    const strips = [];
    const stripColors = [];
    const headers = [];
    const headerColors = [];
    this.productColors.forEach((c, j) => {
      const b = bayOf(j);
      const gu = L.gondolas[b.k];
      strips.push([gu + b.dir * (gh + 0.01), t0.y - 0.06, z(b.w), 0.02, 0.08, L.bayLen - 0.1]);
      strips.push([gu + b.dir * (inner + 0.01), t1.y - 0.06, z(b.w), 0.02, 0.08, L.bayLen - 0.1]);
      stripColors.push(c, c);
      headers.push([gu + b.dir * 0.05, 1.85, z(b.w), 0.03, 0.45, L.bayLen - 0.2]);
      headerColors.push(c);
    });
    many(geo.unit, M.glow, strips, false, stripColors);
    many(geo.unit, M.tint, headers, false, headerColors);

    // A wall shelf with all sorts of small goods along the left wall.
    const wallU = -W / 2 + 0.55;
    const [wallFrom, wallTo] = L.wallShelf;
    many(geo.unit, M.shelf, [
      [wallU, 0.9, z((wallFrom + wallTo) / 2), 0.06, 1.8, wallTo - wallFrom],
      ...[0.1, 0.6, 1.1, 1.6].map((y) => [wallU + 0.22, y, z((wallFrom + wallTo) / 2), 0.45, 0.04, wallTo - wallFrom]),
    ]);
    const goods = [];
    const goodColors = [];
    let seed = s.id * 97 + 13;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const y of [0.12, 0.62, 1.12]) {
      let gc = color(GOODS[0]);
      for (let w = wallFrom + 0.15; w < wallTo - 0.1; w += 0.22) {
        if (rnd() < 0.18) gc = color(GOODS[Math.floor(rnd() * GOODS.length)]);
        const h = 0.18 + rnd() * 0.18;
        goods.push([wallU + 0.25, y + h / 2, z(w), 0.3, h, 0.18]);
        goodColors.push(gc);
      }
    }
    many(geo.unit, M.tint, goods, true, goodColors);

    // Checkouts: counter, belt, till with a screen, and a lane light on a pole.
    const cMid = (L.counterFrom + L.counterTo) / 2;
    const cLen = L.counterTo - L.counterFrom;
    many(geo.unit, M.counter, L.tills.map((t) => [t, 0.45, z(cMid), 0.8, 0.9, cLen]));
    many(geo.unit, M.belt, L.tills.map((t) => [t + 0.05, 0.915, z(cMid - 0.4), 0.6, 0.04, cLen - 1.0]));
    many(geo.unit, M.dark, [
      ...L.tills.map((t) => [t - 0.2, 1.05, z(L.payW), 0.35, 0.25, 0.45]), // till
      ...L.tills.map((t) => [t - 0.28, 1.35, z(L.payW), 0.05, 0.3, 0.4]), // screen stand
      ...L.tills.map((t) => [t + L.laneOffset + 0.65, 1.05, z(L.counterFrom), 0.05, 2.1, 0.05]), // pole
      ...L.tills.map((t) => [t + 0.25, 0.4, z(L.counterTo + 0.35), 0.5, 0.8, 0.6]), // packing shelf
    ]);
    many(geo.unit, M.screen, L.tills.map((t) => [t - 0.25, 1.36, z(L.payW), 0.02, 0.24, 0.34]), false);
    const laneLights = many(geo.unit, M.glow, L.tills.map((t) => [t + L.laneOffset + 0.65, 2.2, z(L.counterFrom), 0.3, 0.3, 0.3]), false, L.tills.map(() => RED));

    // Fruit and vegetable stands: crates full of colourful fruit.
    const pMid = (L.produceFrom + L.produceTo) / 2;
    const pLen = L.produceTo - L.produceFrom;
    many(geo.unit, M.wood, L.produce.map((u) => [u, 0.36, z(pMid), 2.0, 0.72, pLen]));
    const crates = [];
    const fruit = [];
    const fruitColors = [];
    const FRUIT = [0xf97316, 0xdc2626, 0x84cc16, 0xfacc15, 0x7c3aed, 0x16a34a, 0xfb923c, 0xbe123c];
    L.produce.forEach((u, si) => {
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          const cu = u - 0.5 + a;
          const cw = pMid - 0.62 + b * 1.24;
          crates.push([cu, 0.8, z(cw), 0.92, 0.16, 1.18]);
          const fc = color(FRUIT[(si * 4 + a * 2 + b * 3) % FRUIT.length]);
          for (let i = 0; i < 4; i++) {
            for (let k = 0; k < 6; k++) {
              fruit.push([cu - 0.33 + i * 0.22, 0.95 + ((i + k) % 2) * 0.03, z(cw - 0.5 + k * 0.2), 1, 1, 1]);
              fruitColors.push(fc);
            }
          }
        }
      }
    });
    many(geo.unit, M.crate, crates);
    many(geo.fruit, M.tint, fruit, false, fruitColors);

    // Wall fridges along the back-room wall, with drinks behind glass doors.
    const fU = (L.fridgeFrom + L.fridgeTo) / 2;
    const fLen = L.fridgeTo - L.fridgeFrom;
    const fW = L.backWall + L.fridgeDepth / 2;
    many(geo.unit, M.fridge, [
      [fU, 0.1, z(fW), fLen, 0.2, L.fridgeDepth],
      [fU, 2.05, z(fW), fLen, 0.2, L.fridgeDepth],
      [fU, 1.07, z(L.backWall + 0.13), fLen, 1.8, 0.04],
      ...[0.6, 1.15, 1.7].map((y) => [fU, y - 0.02, z(fW), fLen, 0.03, L.fridgeDepth - 0.1]),
    ]);
    many(geo.unit, M.accent, [[fU, 2.3, z(fW + 0.1), fLen, 0.3, L.fridgeDepth - 0.1]], false);
    const frames = [];
    for (let u = L.fridgeFrom; u <= L.fridgeTo + 0.01; u += fLen / 16) frames.push([u, 1.07, z(L.backWall + L.fridgeDepth), 0.05, 1.9, 0.05]);
    many(geo.unit, M.dark, frames, false);
    many(geo.unit, M.glass, [[fU, 1.07, z(L.backWall + L.fridgeDepth), fLen, 1.8, 0.02]], false);
    const drinks = [];
    const drinkColors = [];
    for (const y of [0.2, 0.6, 1.15, 1.7]) {
      for (let u = L.fridgeFrom + 0.15; u < L.fridgeTo - 0.1; u += 0.17) {
        const h = 0.22 + rnd() * 0.12;
        drinks.push([u, y + h / 2, z(L.backWall + 0.45), 0.12, h, 0.12]);
        drinkColors.push(color([0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0xf8fafc, 0x7c3aed, 0x0891b2][Math.floor(rnd() * 7)]));
      }
    }
    many(geo.unit, M.tint, drinks, false, drinkColors);

    // Special offers: a stepped island stacked with goods and a sign on a pole.
    const promo = [];
    const promoGoods = [];
    const promoColors = [];
    L.promos.forEach(([u, w], k) => {
      promo.push([u, 0.2, z(w), 1.6, 0.4, 1.6], [u, 0.55, z(w), 0.9, 0.3, 0.9]);
      const c = color(GOODS[(k * 5 + 1 + s.id) % GOODS.length]);
      for (let a = -2; a <= 2; a++) {
        for (let b = -2; b <= 2; b++) {
          if (Math.abs(a) < 2 && Math.abs(b) < 2) continue;
          promoGoods.push([u + a * 0.3, 0.53, z(w + b * 0.3), 0.24, 0.26, 0.24]);
          promoColors.push(c);
        }
      }
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          promoGoods.push([u + a * 0.28, 0.83, z(w + b * 0.28), 0.22, 0.26, 0.22]);
          promoColors.push(c);
        }
      }
    });
    many(geo.unit, M.accent, promo);
    many(geo.unit, M.tint, promoGoods, true, promoColors);
    many(geo.unit, M.dark, L.promos.map(([u, w]) => [u, 1.5, z(w), 0.05, 1.6, 0.05]), false);
    many(geo.unit, M.glow, L.promos.map(([u, w]) => [u, 2.35, z(w), 0.9, 0.5, 0.04]), false, L.promos.map(() => color(0xfacc15)));

    // Door mats, and a stack of baskets by the entrance.
    many(geo.unit, M.mats, [
      [L.entranceU, 0.035, z(L.depth - 1.2), L.doorWidth, 0.02, 1.8],
      [L.exitU, 0.035, z(L.depth - 1.2), L.doorWidth, 0.02, 1.8],
    ], false);
    many(geo.basket, M.basket, [0, 1, 2, 3, 4].map((k) => [-13.4, 0.1 + k * 0.12, z(L.depth - 1.0), 1, 1, 1]));

    // Back room: pallets by the delivery door, a rack with spare cartons, a
    // cardboard baler, and the staff room with a table and lockers.
    many(geo.pallet, M.wood, L.pallets.map(([u, w]) => [u, 0.07, z(w)]));
    const rackU = 6;
    const rackItems = [];
    for (const u of [rackU - 3, rackU, rackU + 3]) for (const w of [0.4, 1.2]) rackItems.push([u, 1.2, z(w), 0.08, 2.4, 0.08]);
    for (const y of [0.15, 1.0, 1.85]) rackItems.push([rackU, y, z(0.8), 6.1, 0.06, 0.9]);
    many(geo.unit, M.spine, rackItems);
    const cartons = [];
    for (let k = 0; k < 14; k++) {
      const lvl = k % 3;
      const u = rackU - 2.7 + Math.floor(k / 3) * 1.2 + (k % 2) * 0.3;
      cartons.push([u, [0.15, 1.0, 1.85][lvl] + 0.25, z(0.8), 0.7, 0.45, 0.6]);
    }
    many(geo.unit, M.card, cartons);
    many(geo.unit, M.baler, [[-17.9, 1.1, z(4.3), 1.4, 2.2, 1.4]]);
    many(geo.unit, M.card, [[-17.9, 0.4, z(3.0), 1.2, 0.8, 0.8], [-17.9, 1.2, z(3.0), 1.2, 0.8, 0.8]]);
    many(geo.unit, M.wood, [[14.2, 0.74, z(1.2), 1.8, 0.06, 0.9]]);
    many(geo.unit, M.dark, [
      [14.2, 0.37, z(1.2), 0.1, 0.72, 0.1], // table leg
      [13.0, 0.25, z(1.2), 0.45, 0.5, 0.45], [15.4, 0.25, z(1.2), 0.45, 0.5, 0.45], // stools
      [-1.6, 0.12, z(1.3), 0.6, 0.12, 1.4], [-1.6, 0.6, z(0.65), 0.1, 1.0, 0.1], // pallet truck
    ]);
    many(geo.unit, M.locker, [[18.4, 1.0, z(2.6), 0.6, 2.0, 3.6]]);

    // ---------- moving parts ----------
    const dyn = (geometry, material, count, colored = false) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (colored) mesh.setColorAt(0, GREEN);
      g.add(mesh);
      return mesh;
    };
    const boxes = dyn(geo.unit, M.box, MAX_BOXES, true);
    const people = {
      legs: dyn(geo.leg, M.person, MAX_PEOPLE * 2, true),
      arms: dyn(geo.arm, M.person, MAX_PEOPLE * 2, true),
      torso: dyn(geo.torso, M.person, MAX_PEOPLE, true),
      head: dyn(geo.head, M.person, MAX_PEOPLE, true),
      hair: dyn(geo.hair, M.person, MAX_PEOPLE, true),
    };
    const trolleys = dyn(geo.unit, M.steel, MAX_TROLLEYS * TROLLEY.length);
    const wheels = dyn(geo.unit, M.tyre, MAX_TROLLEYS * WHEELS.length);
    const baskets = dyn(geo.basket, M.basket, MAX_BASKETS);
    return { s, group: g, z, boxes, people, trolleys, wheels, baskets, laneLights };
  }

  // ---------- every frame ----------
  update(world, alpha) {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v.group.visible && world.storeFloors?.[i]) this.updateOne(v, world.storeFloors[i], alpha);
    }
  }

  updateOne(v, floor, alpha) {
    const { z } = v;
    this.v = v;
    this.nb = 0;
    this.nt = 0;
    this.nk = 0;
    const B = L.box;

    // Shelves: one bay per product, the lower step first, then the upper.
    for (let j = 0; j < floor.shelf.length; j++) {
      const b = floor.bays[j];
      const n = Math.min(floor.shelf[j], SHELF_SLOTS);
      const gu = L.gondolas[b.k];
      for (let k = 0; k < n; k++) {
        const tier = L.tiers[Math.floor(k / L.perLevel)];
        const i = k % L.perLevel;
        const w = b.w - L.bayLen / 2 + (L.bayLen / L.perLevel) * (i + 0.5);
        this.putBox(j, gu + b.dir * tier.d, tier.y + B / 2 + 0.005, z(w), B, 0);
      }
    }

    // Back room: delivered boxes on the pallets, 2 x 2 per layer.
    const back = floor.back;
    const max = L.pallets.length * L.palletBoxes;
    for (let k = 0; k < back.length && k < max; k++) {
      const [pu, pw] = L.pallets[Math.floor(k / L.palletBoxes)];
      const n = k % L.palletBoxes;
      const a = n & 1 ? 0.25 : -0.25;
      const c = n & 2 ? 0.25 : -0.25;
      this.putBox(back[k], pu + a, 0.14 + 0.21 + (n >> 2) * 0.42, z(pw + c), 0.4, 0);
    }

    // Trolleys parked by the entrance.
    for (let k = 0; k < 4; k++) {
      _base.makeRotationY(0).setPosition(-17.6 + k * 0.45, 0, z(L.depth - 1.4));
      this.putTrolley();
    }

    // People.
    const P = v.people;
    let np = 0;
    for (const p of floor.people) {
      if (!p.present || np >= MAX_PEOPLE) continue;
      const h = p.pheading + angleDiff(p.heading, p.pheading) * alpha;
      const x = p.pu + (p.u - p.pu) * alpha;
      const zz = -(p.pv + (p.v - p.pv) * alpha);
      const phase = p.pphase + (p.phase - p.pphase) * alpha;
      const swing = p.walking ? Math.sin(phase) * 0.55 : 0;
      const bob = p.walking ? Math.abs(Math.sin(phase)) * 0.04 : 0;
      const busy = p.working ? Math.sin(phase * 2) * 0.25 : 0;
      const sz = p.size;
      _base.makeRotationY(h);
      _base.scale(_s.set(sz, sz, sz));
      _base.setPosition(x, bob, zz);
      const trolley = p.carrier === 'trolley';
      const basket = p.carrier === 'basket';
      const carrying = p.load.length > 0;
      // Arm angles: forward is positive.
      let left = p.walking ? -swing * 0.8 : 0;
      let right = p.walking ? swing * 0.8 : 0;
      if (p.working) {
        left = 0.9 + busy;
        right = 0.9 - busy;
      }
      if (trolley || carrying) left = right = 1.15 + (p.working ? busy * 0.3 : 0);
      if (basket) right = 0.08;
      const shirt = color(p.shirt);
      const trousers = color(p.trousers);
      limb(P.legs, np * 2, swing, 0.1, 0.8, trousers);
      limb(P.legs, np * 2 + 1, -swing, -0.1, 0.8, trousers);
      limb(P.arms, np * 2, left, 0.27, 1.38, shirt);
      limb(P.arms, np * 2 + 1, right, -0.27, 1.38, shirt);
      body(P.torso, np, 1.1, shirt);
      body(P.head, np, 1.56, color(p.skin));
      body(P.hair, np, 1.6, color(p.hair));
      np++;

      // What they carry: a basket in the hand, a trolley, or boxes for the shelves.
      if (basket && this.nk < MAX_BASKETS) {
        _local.makeTranslation(0.08, 0.66, -0.3);
        v.baskets.setMatrixAt(this.nk++, _m.multiplyMatrices(_base, _local));
        for (let k = 0; k < p.items.length && k < 4; k++) this.carried(p.items[k], 0.08 + (k & 1 ? 0.09 : -0.09), 0.8, -0.3 + (k & 2 ? 0.06 : -0.06), 0.13);
      }
      if (trolley) {
        const save = _base.elements[12];
        const saveZ = _base.elements[14];
        _base.elements[12] += Math.cos(h) * TROLLEY_AHEAD;
        _base.elements[14] -= Math.sin(h) * TROLLEY_AHEAD;
        // The trolley does not grow or shrink with the person.
        _base.scale(_s.set(1 / sz, 1 / sz, 1 / sz));
        _base.elements[13] = 0;
        this.putTrolley();
        for (let k = 0; k < p.items.length && k < 8; k++) {
          this.carried(p.items[k], -0.27 + (k % 4) * 0.18, 0.55 + (k >> 2) * 0.2, k & 4 ? 0.1 : -0.1, 0.18);
        }
        _base.elements[12] = save;
        _base.elements[14] = saveZ;
      }
      if (carrying) {
        for (let k = 0; k < p.load.length && k < 4; k++) {
          this.carried(p.load[k], 0.42, 1.0 + (k >> 1) * 0.3, k & 1 ? 0.15 : -0.15, 0.28);
        }
      }
    }
    for (const key in P) {
      P[key].count = key === 'legs' || key === 'arms' ? np * 2 : np;
      P[key].instanceMatrix.needsUpdate = true;
      P[key].instanceColor.needsUpdate = true;
    }

    // Lane lights: green when the cashier is at the till.
    for (let i = 0; i < floor.cashiers.length; i++) {
      const c = floor.cashiers[i];
      v.laneLights.setColorAt(i, c.present && c.steps[0]?.kind === 'till' ? GREEN : RED);
    }
    v.laneLights.instanceColor.needsUpdate = true;

    v.boxes.count = this.nb;
    v.boxes.instanceMatrix.needsUpdate = true;
    v.boxes.instanceColor.needsUpdate = true;
    v.trolleys.count = this.nt * TROLLEY.length;
    v.trolleys.instanceMatrix.needsUpdate = true;
    v.wheels.count = this.nt * WHEELS.length;
    v.wheels.instanceMatrix.needsUpdate = true;
    v.baskets.count = this.nk;
    v.baskets.instanceMatrix.needsUpdate = true;
  }

  putBox(p, x, y, zz, size, rot) {
    if (this.nb >= MAX_BOXES) return;
    this.v.boxes.setMatrixAt(this.nb, boxMatrix(x, y, zz, size, size, size, rot));
    this.v.boxes.setColorAt(this.nb, this.productColors[p]);
    this.nb++;
  }

  // A small box at a point in the frame of _base (a person or their trolley).
  carried(p, x, y, zz, size) {
    if (this.nb >= MAX_BOXES) return;
    _local.compose(_p.set(x, y, zz), _q.identity(), _s.set(size, size, size));
    this.v.boxes.setMatrixAt(this.nb, _m.multiplyMatrices(_base, _local));
    this.v.boxes.setColorAt(this.nb, this.productColors[p]);
    this.nb++;
  }

  // A trolley at the frame _base.
  putTrolley() {
    if (this.nt >= MAX_TROLLEYS) return;
    const v = this.v;
    for (let k = 0; k < TROLLEY_LOCALS.length; k++) {
      v.trolleys.setMatrixAt(this.nt * TROLLEY_LOCALS.length + k, _m.multiplyMatrices(_base, TROLLEY_LOCALS[k]));
    }
    for (let k = 0; k < WHEEL_LOCALS.length; k++) {
      v.wheels.setMatrixAt(this.nt * WHEEL_LOCALS.length + k, _m.multiplyMatrices(_base, WHEEL_LOCALS[k]));
    }
    this.nt++;
  }
}

// A leg or arm of person matrix _base, swung forward by `angle` from its pivot.
function limb(mesh, idx, angle, side, y, c) {
  _local.makeRotationZ(angle).setPosition(0, y, side);
  mesh.setMatrixAt(idx, _m.multiplyMatrices(_base, _local));
  mesh.setColorAt(idx, c);
}

function body(mesh, idx, y, c) {
  _local.makeTranslation(0, y, 0);
  mesh.setMatrixAt(idx, _m.multiplyMatrices(_base, _local));
  mesh.setColorAt(idx, c);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
