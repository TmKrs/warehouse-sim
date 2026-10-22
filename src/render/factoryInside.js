// The inside of every factory: production lines with boxes on the belts,
// finished-goods racks, forklifts and workers. Only drawn (and updated) when
// the camera is close, see main.js. The movement comes from sim/factoryFloor.js.
//
// Each factory's inside is built in the site's own frame (see region.js):
// local x = u along the road, local z = -v away from it.
import * as THREE from 'three';
import { FLOOR } from '../sim/factoryFloor.js';

const L = FLOOR;
const MAX_BOXES = 600;
const MAX_PALLETS = 80;
const FORK_PALLET_X = 1.45; // pallet centre on the forks, in front of the forklift

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

// Shared by every factory, made once.
let shared = null;
function sharedParts() {
  if (shared) return shared;
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // A limb hanging from its pivot (hip or shoulder) at the origin.
  const limb = (w, h, d) => box(w, h, d).translate(0, -h / 2, 0);
  const wheel = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14).rotateX(Math.PI / 2);
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shared = {
    geo: {
      unit: box(1, 1, 1), flat, wheel,
      pallet: box(1.2, L.palletH, 1.2),
      leg: limb(0.14, 0.78, 0.15), arm: limb(0.1, 0.6, 0.11),
      torso: box(0.24, 0.62, 0.4), vest: box(0.28, 0.42, 0.44),
      head: new THREE.SphereGeometry(0.12, 12, 8),
      helmet: new THREE.SphereGeometry(0.14, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      hopper: new THREE.CylinderGeometry(1.0, 0.4, 1.2, 16),
      beacon: new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10),
    },
    mat: {
      floor: mat(0xb9bdc2, { roughness: 0.55, metalness: 0.05 }),
      yellow: new THREE.MeshBasicMaterial({ color: 0xe8b00a }),
      green: new THREE.MeshBasicMaterial({ color: 0x4f9e6b }),
      white: new THREE.MeshBasicMaterial({ color: 0xe5e7eb }),
      lane: mat(0x9a9fa6, { roughness: 0.6 }),
      machine: mat(0x5b6b7c, { metalness: 0.35, roughness: 0.5 }),
      teal: mat(0x0f766e, { metalness: 0.2, roughness: 0.5 }),
      steel: mat(0xaab2bd, { metalness: 0.7, roughness: 0.35 }),
      belt: mat(0x24282e, { roughness: 0.9 }),
      screen: new THREE.MeshBasicMaterial({ color: 0x5eead4 }),
      light: new THREE.MeshBasicMaterial({ color: 0xffffff }), // tinted per instance
      upright: mat(0x1d4ed8, { metalness: 0.3, roughness: 0.5 }),
      beam: mat(0xea580c, { metalness: 0.3, roughness: 0.5 }),
      wood: mat(0xb08a5a, { roughness: 0.9 }),
      box: mat(0xffffff, { roughness: 0.75 }),
      lamp: mat(0x374151, { emissive: 0xfff7d6, emissiveIntensity: 1.2 }),
      table: mat(0xd6d3d1),
      locker: mat(0x64748b, { metalness: 0.4 }),
      // Forklift and people.
      fork: mat(0xf2b705, { roughness: 0.45, metalness: 0.15 }),
      fdark: mat(0x1f2937, { roughness: 0.6, metalness: 0.3 }),
      tyre: mat(0x111111, { roughness: 0.9 }),
      trousers: mat(0x1e293b),
      shirt: mat(0x1d4ed8),
      vest: mat(0xd9f20b, { emissive: 0x6b7a00, emissiveIntensity: 0.35 }),
      skin: mat(0xd8a47f),
      helmet: mat(0xf8fafc, { roughness: 0.4 }),
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
const AMBER = new THREE.Color(0xf59e0b);

// Matrix for a box from its size and centre, turned by `rot` around y.
function boxMatrix(x, y, z, w, h, d, rot = 0) {
  _q.setFromAxisAngle(_UP, rot);
  return _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d));
}

export class FactoryInsides {
  constructor(world, groupForSite) {
    this.parts = sharedParts();
    this.productColors = world.sim.products.map((p) => new THREE.Color().setHSL(p.hue, p.sat, p.light));
    this.views = world.factories.map((f) => this.build(f, groupForSite(f)));
  }

  setOpen(i, open) {
    const v = this.views[i];
    if (v) v.group.visible = open;
  }

  // ---------- building ----------
  build(f, siteGroup) {
    const { geo, mat: M } = this.parts;
    const g = new THREE.Group();
    g.visible = false;
    siteGroup.add(g);
    const z = (w) => -(f.faceV + w); // local z for a distance from the front wall
    const W = L.halfWidth * 2;
    const add = (mesh, shadows = true) => {
      if (shadows) mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // Many copies of one part, as one draw call. Each item is [x, y, z, w, h, d, rot].
    const many = (geometry, material, items, shadows = true) => {
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      items.forEach(([x, y, zz, w = 1, h = 1, d = 1, rot = 0], i) => mesh.setMatrixAt(i, boxMatrix(x, y, zz, w, h, d, rot)));
      return add(mesh, shadows);
    };

    // Polished concrete floor.
    const floor = new THREE.Mesh(geo.flat, M.floor);
    floor.scale.set(W - 0.3, 1, L.depth - 0.3);
    floor.position.set(0, 0.02, z(L.depth / 2));
    floor.receiveShadow = true;
    g.add(floor);

    // Floor markings: yellow edges along the forklift loop, green walkways,
    // outlines around pallet spots and hatching in front of the dock doors.
    const yellow = [];
    const green = [];
    const dark = [];
    const line = (list, u1, w1, u2, w2, width) => {
      const du = u2 - u1;
      const dw = w2 - w1;
      const len = Math.hypot(du, dw);
      list.push([(u1 + u2) / 2, 0.03, z((w1 + w2) / 2), width, 1, len + width, Math.atan2(du, -dw)]);
    };
    const floorRoute = this.routeOf(f);
    for (let k = 0; k < floorRoute.length; k++) {
      const a = floorRoute[k];
      const b = floorRoute[(k + 1) % floorRoute.length];
      line(dark, a.u, a.w, b.u, b.w, 2.6); // darker driving lane
      // Arrows of the one-way loop: short white dashes along the lane.
      const len = Math.hypot(b.u - a.u, b.w - a.w);
      for (let d = 1.5; d < len - 1; d += 3) {
        const t = d / len;
        const u = a.u + (b.u - a.u) * t;
        const w = a.w + (b.w - a.w) * t;
        line(yellow, u, w, u + ((b.u - a.u) / len) * 1.0, w + ((b.w - a.w) / len) * 1.0, 0.12);
      }
    }
    for (const r of [[-3, 9.6, -20.6, 9.6], [-20.6, 9.6, -20.6, 16.6], [-20.6, 16.6, -7, 16.6], [-20.6, 9.6, -17, 3.6],
      [-20.4, 22.6, 3, 22.6], [-20.4, 22.6, -21.4, 11.2], [-21.4, 11.2, -8, 11.2]]) {
      line(green, r[0], r[1], r[2], r[3], 0.9);
    }
    const square = (list, u, w, s) => {
      line(list, u - s, w - s, u + s, w - s, 0.08);
      line(list, u - s, w + s, u + s, w + s, 0.08);
      line(list, u - s, w - s, u - s, w + s, 0.08);
      line(list, u + s, w - s, u + s, w + s, 0.08);
    };
    for (const w of L.lines) square(yellow, L.endU, w, 0.75);
    for (let k = 0; k < f.products.length; k++) {
      const w = L.rows[k];
      line(yellow, 11.5, w - 0.8, 21.4, w - 0.8, 0.1);
      line(yellow, 11.5, w + 0.8, 21.4, w + 0.8, 0.1);
    }
    for (const d of f.docks) {
      for (let k = -2; k <= 2; k++) line(yellow, d.u + k * 0.8 - 0.4, 0.3, d.u + k * 0.8 + 0.4, 1.3, 0.22);
    }
    const strips = (list, material, y) => {
      const mesh = new THREE.InstancedMesh(geo.flat, material, list.length);
      list.forEach(([x, , zz, w, , d, rot], i) => mesh.setMatrixAt(i, boxMatrix(x, y, zz, w, 1, d, rot)));
      mesh.receiveShadow = true;
      g.add(mesh);
    };
    strips(dark, M.lane, 0.025);
    strips(green, M.green, 0.03);
    strips(yellow, M.yellow, 0.035);

    // Production lines: a machine with a hopper, a press over the belt, a
    // control panel and a light that is green while the line runs.
    const mu = L.machineU;
    const lineItems = (fn) => L.lines.map((w) => fn(z(w)));
    many(geo.unit, M.machine, lineItems((zz) => [mu, 1.3, zz, L.machineLen, 2.6, L.machineDepth]));
    many(geo.unit, M.teal, lineItems((zz) => [mu, 2.2, zz, L.machineLen + 0.04, 0.35, L.machineDepth + 0.04]));
    many(geo.hopper, M.steel, lineItems((zz) => [mu - 0.6, 3.2, zz]));
    many(geo.unit, M.fdark, lineItems((zz) => [mu + 0.9, 1.25, zz + L.machineDepth / 2 + 0.15, 0.7, 1.1, 0.3]));
    many(geo.unit, M.screen, lineItems((zz) => [mu + 0.9, 1.5, zz + L.machineDepth / 2 + 0.31, 0.5, 0.35, 0.02]), false);
    // Press gantry over the start of the belt.
    const pressU = L.beltFrom + 2.2;
    many(geo.unit, M.teal, [
      ...lineItems((zz) => [pressU, 1.3, zz - 0.6, 0.18, 2.6, 0.18]),
      ...lineItems((zz) => [pressU, 1.3, zz + 0.6, 0.18, 2.6, 0.18]),
      ...lineItems((zz) => [pressU, 2.6, zz, 0.6, 0.25, 1.4]),
    ]);
    // Belts with rails and legs.
    const beltLen = L.beltTo - L.beltFrom;
    const beltU = (L.beltFrom + L.beltTo) / 2;
    many(geo.unit, M.belt, lineItems((zz) => [beltU, L.beltY - 0.06, zz, beltLen, 0.12, 0.9]));
    many(geo.unit, M.steel, [
      ...lineItems((zz) => [beltU, L.beltY - 0.02, zz - 0.5, beltLen, 0.2, 0.08]),
      ...lineItems((zz) => [beltU, L.beltY - 0.02, zz + 0.5, beltLen, 0.2, 0.08]),
    ]);
    const legs = [];
    for (const w of L.lines) {
      for (let u = L.beltFrom + 0.6; u < L.beltTo; u += 2.2) {
        legs.push([u, (L.beltY - 0.12) / 2, z(w) - 0.42, 0.08, L.beltY - 0.12, 0.08]);
        legs.push([u, (L.beltY - 0.12) / 2, z(w) + 0.42, 0.08, L.beltY - 0.12, 0.08]);
      }
    }
    many(geo.unit, M.fdark, legs);

    // Pallet racks for finished goods: blue uprights, orange beams, and a
    // board in the product's colour at the aisle end of every row.
    const uprights = [];
    const beams = [];
    const bayEdges = [11.6, 14.8, 18.0, 21.2];
    for (let k = 0; k < f.products.length; k++) {
      const w = L.rows[k];
      for (const u of bayEdges) for (const s of [-0.65, 0.65]) uprights.push([u, 1.3, z(w + s), 0.1, 2.6, 0.1]);
      for (const y of [L.beamY - 0.06, 2.55]) {
        for (const s of [-0.65, 0.65]) beams.push([(bayEdges[0] + bayEdges[3]) / 2, y, z(w + s), bayEdges[3] - bayEdges[0], 0.12, 0.08]);
      }
    }
    many(geo.unit, M.upright, uprights);
    many(geo.unit, M.beam, beams);
    const boards = new THREE.InstancedMesh(geo.unit, M.light, f.products.length);
    f.products.forEach((p, k) => {
      boards.setMatrixAt(k, boxMatrix(bayEdges[0] - 0.08, 2.1, z(L.rows[k]), 0.04, 0.6, 1.2));
      boards.setColorAt(k, this.productColors[p]);
    });
    g.add(boards);

    // Break corner by the front wall: a table and a row of lockers.
    many(geo.unit, M.table, [[-17, 0.38, z(2.6), 2.6, 0.76, 1.1]]);
    many(geo.unit, M.locker, [[-20.2, 1.0, z(0.5), 4.0, 2.0, 0.5]]);

    // Lamps along the side and back walls.
    const lamps = [];
    for (let w = 4; w < L.depth; w += 6) for (const u of [-W / 2 + 0.6, W / 2 - 0.6]) lamps.push([u, 7, z(w), 0.5, 0.3, 1.6]);
    for (let u = -18; u <= 18; u += 9) lamps.push([u, 7, z(L.depth - 0.6), 1.6, 0.3, 0.5]);
    many(geo.unit, M.lamp, lamps, false);

    // ---------- moving parts ----------
    const dyn = (geometry, material, count, color = false) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (color) mesh.setColorAt(0, GREEN);
      g.add(mesh);
      return mesh;
    };
    const heads = dyn(geo.unit, M.steel, L.lines.length);
    const beacons = dyn(geo.beacon, M.light, L.lines.length, true);
    const boxes = dyn(geo.unit, M.box, MAX_BOXES, true);
    const pallets = dyn(geo.pallet, M.wood, MAX_PALLETS);
    const nf = 3;
    const nw = 6;
    // A forklift: +x is forward, the origin is the middle of the body.
    const forklift = [
      { mesh: dyn(geo.unit, M.fork, nf), parts: [[-0.2, 0.65, 0, 1.7, 0.85, 1.15]] },
      { mesh: dyn(geo.unit, M.fdark, nf * 6), parts: [
        [-0.95, 0.6, 0, 0.45, 0.8, 1.17], // counterweight
        [-0.2, 2.42, 0, 1.3, 0.06, 1.12], // overhead guard
        [0.35, 1.75, 0.52, 0.06, 1.3, 0.06], [0.35, 1.75, -0.52, 0.06, 1.3, 0.06],
        [-0.75, 1.75, 0.52, 0.06, 1.3, 0.06], [-0.75, 1.75, -0.52, 0.06, 1.3, 0.06],
      ] },
      { mesh: dyn(geo.wheel, M.tyre, nf * 4), parts: [[0.4, 0.28, 0.5], [0.4, 0.28, -0.5], [-0.7, 0.28, 0.5], [-0.7, 0.28, -0.5]] },
      { mesh: dyn(geo.unit, M.steel, nf * 2), parts: [[0.72, 1.2, 0.36, 0.09, 2.4, 0.09], [0.72, 1.2, -0.36, 0.09, 2.4, 0.09]] },
      { mesh: dyn(geo.unit, M.fdark, nf * 3), lift: true, parts: [
        [0.8, 0.3, 0, 0.07, 0.6, 0.85], // carriage
        [1.42, 0.025, 0.28, 1.15, 0.05, 0.13], [1.42, 0.025, -0.28, 1.15, 0.05, 0.13], // forks
      ] },
      { mesh: dyn(geo.vest, M.vest, nf), parts: [[-0.4, 1.32, 0]] },
      { mesh: dyn(geo.head, M.skin, nf), parts: [[-0.4, 1.68, 0]] },
      { mesh: dyn(geo.helmet, M.helmet, nf), parts: [[-0.4, 1.72, 0]] },
      { mesh: dyn(geo.beacon, M.light, nf, true), parts: [[-0.75, 2.55, 0]] },
    ];
    for (const part of forklift) {
      part.locals = part.parts.map(([x, y, zz, w = 1, h = 1, d = 1]) => new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, zz), new THREE.Quaternion(), new THREE.Vector3(w, h, d)));
      if (part.mesh.material === M.light) for (let k = 0; k < nf; k++) part.mesh.setColorAt(k, AMBER);
    }
    // A worker: legs and arms swing from the hip and shoulder.
    const people = {
      legs: dyn(geo.leg, M.trousers, nw * 2),
      arms: dyn(geo.arm, M.shirt, nw * 2),
      torso: dyn(geo.torso, M.shirt, nw),
      vest: dyn(geo.vest, M.vest, nw),
      head: dyn(geo.head, M.skin, nw),
      helmet: dyn(geo.helmet, M.helmet, nw),
    };
    return { f, group: g, z, heads, beacons, boxes, pallets, forklift, people, pressU };
  }

  // The forklift loop as (u, w) points, for the lane markings.
  routeOf(f) {
    const corner = Math.min(...f.docks.map((d) => d.u)) - 4;
    const rowsTop = L.backLane;
    return [
      { u: L.westLane, w: L.backLane }, { u: L.westLane, w: L.crossLane }, { u: corner, w: L.crossLane },
      { u: corner, w: L.frontLane }, { u: L.eastLane, w: L.frontLane }, { u: L.eastLane, w: rowsTop },
    ];
  }

  // ---------- every frame ----------
  update(world, alpha) {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      if (v.group.visible && world.floors[i]) this.updateOne(v, world.floors[i], alpha);
    }
  }

  updateOne(v, floor, alpha) {
    const { z } = v;
    this.v = v;
    this.nb = 0;
    this.np = 0;
    const B = L.box;

    // Lines: machines, press and the boxes on the belts.
    for (let i = 0; i < floor.lines.length; i++) {
      const line = floor.lines[i];
      const zz = z(line.w);
      const t = floor.lineProgress(i);
      const drop = line.running ? Math.max(0, Math.sin(t * Math.PI * 6)) * 0.7 : 0;
      v.heads.setMatrixAt(i, boxMatrix(v.pressU, 2.25 - drop, zz, 0.5, 0.45, 0.7));
      v.beacons.setMatrixAt(i, boxMatrix(L.machineU + 1.4, 2.73, zz - 0.8, 1, 1, 1));
      v.beacons.setColorAt(i, line.running ? GREEN : AMBER);
      for (const b of line.belt) {
        const x = b.px + (b.x - b.px) * alpha;
        if (x < 0.3) continue; // still inside the machine
        this.putBox(b.p, L.beltFrom + x, L.beltY + B / 2, zz, 0);
      }
      this.putPallet(L.endU, 0, zz, 0);
      this.stack(line.pallet, -1, line.pallet.length, L.endU, 0, zz, 0);
    }
    v.heads.instanceMatrix.needsUpdate = true;
    v.beacons.instanceMatrix.needsUpdate = true;
    v.beacons.instanceColor.needsUpdate = true;

    // Racks: full pallets from the back of each row, then the upper level.
    const slots = L.slots.length;
    for (const row of floor.rows) {
      const zz = z(row.w);
      let left = Math.min(row.count, slots * L.levels * L.palletBoxes);
      for (let k = 0; left > 0; k++) {
        const n = Math.min(left, L.palletBoxes);
        const y = k >= slots ? L.beamY : 0;
        this.putPallet(L.slots[k % slots], y, zz, 0);
        this.stack(null, row.product, n, L.slots[k % slots], y, zz, 0);
        left -= n;
      }
    }

    // Forklifts, with their pallet and boxes on the forks.
    const fls = floor.forklifts;
    for (let k = 0; k < fls.length; k++) {
      const fl = fls[k];
      const h = fl.pheading + angleDiff(fl.heading, fl.pheading) * alpha;
      const x = fl.pu + (fl.u - fl.pu) * alpha;
      const zz = -(fl.pv + (fl.v - fl.pv) * alpha);
      const fork = fl.pfork + (fl.fork - fl.pfork) * alpha;
      _base.makeRotationY(h).setPosition(x, 0, zz);
      for (const part of v.forklift) {
        const n = part.locals.length;
        for (let j = 0; j < n; j++) {
          _local.copy(part.locals[j]);
          if (part.lift) _local.elements[13] += fork;
          part.mesh.setMatrixAt(k * n + j, _m.multiplyMatrices(_base, _local));
        }
      }
      if (fl.load.length) {
        const px = x + Math.cos(h) * FORK_PALLET_X;
        const pz = zz - Math.sin(h) * FORK_PALLET_X;
        this.putPallet(px, fork, pz, h);
        this.stack(fl.load, -1, Math.min(fl.load.length, L.palletBoxes), px, fork, pz, h);
      }
    }
    for (const part of v.forklift) part.mesh.instanceMatrix.needsUpdate = true;

    // Workers: walking swings legs and arms, working moves the arms.
    const P = v.people;
    const ws = floor.workers;
    for (let k = 0; k < ws.length; k++) {
      const p = ws[k];
      const h = p.pheading + angleDiff(p.heading, p.pheading) * alpha;
      const x = p.pu + (p.u - p.pu) * alpha;
      const zz = -(p.pv + (p.v - p.pv) * alpha);
      const phase = p.pphase + (p.phase - p.pphase) * alpha;
      const swing = p.walking ? Math.sin(phase) * 0.55 : 0;
      const bob = p.walking ? Math.abs(Math.sin(phase)) * 0.05 : 0;
      const busy = p.working ? Math.sin(phase * 2) * 0.25 : 0;
      _base.makeRotationY(h).setPosition(x, bob, zz);
      limb(P.legs, k * 2, swing, 0.1, 0.8);
      limb(P.legs, k * 2 + 1, -swing, -0.1, 0.8);
      limb(P.arms, k * 2, p.walking ? -swing * 0.8 : p.working ? 0.9 + busy : 0, 0.27, 1.38);
      limb(P.arms, k * 2 + 1, p.walking ? swing * 0.8 : p.working ? 0.9 - busy : 0, -0.27, 1.38);
      body(P.torso, k, 1.1);
      body(P.vest, k, 1.16);
      body(P.head, k, 1.56);
      body(P.helmet, k, 1.6);
    }
    for (const key in P) P[key].instanceMatrix.needsUpdate = true;

    v.boxes.count = this.nb;
    v.boxes.instanceMatrix.needsUpdate = true;
    v.boxes.instanceColor.needsUpdate = true;
    v.pallets.count = this.np;
    v.pallets.instanceMatrix.needsUpdate = true;
  }

  putBox(p, x, y, zz, rot) {
    if (this.nb >= MAX_BOXES) return;
    const s = L.box * 0.96;
    this.v.boxes.setMatrixAt(this.nb, boxMatrix(x, y, zz, s, s, s, rot));
    this.v.boxes.setColorAt(this.nb, this.productColors[p]);
    this.nb++;
  }

  putPallet(x, y, zz, rot) {
    if (this.np >= MAX_PALLETS) return;
    this.v.pallets.setMatrixAt(this.np, boxMatrix(x, y + L.palletH / 2, zz, 1, 1, 1, rot));
    this.np++;
  }

  // Up to 8 boxes on a pallet at (x, zz), 2 x 2 per layer, turned with it.
  // The products come from `list`, or are all `product` when list is null.
  stack(list, product, n, x, y, zz, rot) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let k = 0; k < n; k++) {
      const a = k & 1 ? 0.29 : -0.29;
      const b = k & 2 ? 0.29 : -0.29;
      const top = y + L.palletH + L.box / 2 + (k >> 2) * L.box;
      this.putBox(list ? list[k] : product, x + a * c + b * s, top, zz - a * s + b * c, rot);
    }
  }
}

// A leg or arm of worker matrix _base, swung forward by `angle` from its pivot.
function limb(mesh, idx, angle, side, y) {
  _local.makeRotationZ(angle).setPosition(0, y, side);
  mesh.setMatrixAt(idx, _m.multiplyMatrices(_base, _local));
}

function body(mesh, idx, y) {
  _local.makeTranslation(0, y, 0);
  mesh.setMatrixAt(idx, _m.multiplyMatrices(_base, _local));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
