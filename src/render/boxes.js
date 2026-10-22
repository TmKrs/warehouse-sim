// Draws every box (on shelves, on robots, on the dock, on the conveyor) with one instanced mesh.
import * as THREE from 'three';
import { CS, boxSize } from './coords.js';
import { DECK_Y } from './robots.js';

const MAX_BOXES = 1200;

export class BoxViews {
  constructor(scene, C) {
    this.C = C;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // Darker tape stripe look via vertex colours would cost more; a slightly rough material keeps it clean.
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BOXES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.ids = new Int32Array(MAX_BOXES);
    this.m = new THREE.Matrix4();
    this.p = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.e = new THREE.Euler();
    this.color = new THREE.Color();
    this.productColors = [];
  }

  setProducts(products) {
    this.productColors = products.map((p) => new THREE.Color().setHSL(p.hue, p.sat, p.light));
  }

  update(sim, robotState, alpha) {
    const C = this.C;
    let n = 0;
    const handled = new Set();
    const put = (box, x, y, z, rot = 0) => {
      if (n >= MAX_BOXES) return;
      const [w, h, d] = boxSize(box);
      this.p.set(x, y + h / 2, z);
      this.q.setFromEuler(this.e.set(0, rot, 0));
      this.s.set(w, h, d);
      this.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s));
      this.mesh.setColorAt(n, this.productColors[box.product]);
      this.ids[n] = box.id;
      n++;
      handled.add(box.id);
    };
    const slotPos = (slot) => [C.x(slot.x), C.levelY(slot.level), C.z(slot.z)];
    const bufferPos = (dock, k) => {
      const col = k % 3;
      const row = Math.floor(k / 3);
      return [C.x(dock.x) + (col - 1) * 0.92, 0.1, C.frontZ - 0.45 - row * 0.75];
    };
    const lerp = (a, b, t) => a + (b - a) * t;

    // Boxes moving with a robot.
    sim.robots.forEach((r, i) => {
      const rs = robotState[i];
      const deckY = DECK_Y + rs.lift + 0.03;
      const a = r.mode === 'act' ? r.action : null;
      const boxId = a ? a.box : r.carrying;
      if (boxId == null) return;
      const box = sim.boxes.get(boxId);
      if (!box) return;
      const rot = -rs.heading;
      if (a && (a.kind === 'store' || a.kind === 'pickup')) {
        const [sx, sy, sz] = slotPos(sim.slots[a.slot]);
        put(box, lerp(rs.x, sx, rs.reach), lerp(deckY, sy, rs.reach), lerp(rs.z, sz, rs.reach), rot);
      } else if (a && a.kind === 'load') {
        const d = sim.docks[a.dock];
        const k = Math.max(0, d.buffer.indexOf(box.id));
        const [bx, by, bz] = bufferPos(d, k);
        put(box, lerp(rs.x, bx, rs.reach), lerp(deckY, by, rs.reach), lerp(rs.z, bz, rs.reach), rot);
      } else if (a && a.kind === 'drop') {
        put(box, rs.x, lerp(deckY, 0.56, rs.reach), lerp(rs.z, rs.z + CS * 0.6, rs.reach), rot);
      } else {
        put(box, rs.x, deckY, rs.z, rot);
      }
    });

    // Boxes on shelves.
    for (const slot of sim.slots) {
      if (slot.boxId === null || handled.has(slot.boxId)) continue;
      const box = sim.boxes.get(slot.boxId);
      const [x, y, z] = slotPos(slot);
      put(box, x, y, z);
    }

    // Boxes waiting on the dock plates.
    for (const d of sim.docks) {
      d.buffer.forEach((id, k) => {
        if (handled.has(id)) return;
        const [x, y, z] = bufferPos(d, k);
        put(sim.boxes.get(id), x, y, z);
      });
    }

    // Shipped boxes riding the short conveyor into the truck.
    const now = sim.time + alpha * 0.3;
    for (const s of sim.shippedBoxes) {
      const travel = (now - s.time) * 1.2;
      if (travel > 1.2) continue;
      put(s.box, C.cellX(s.cell), 0.56, C.cellZ(s.cell) + CS * 0.6 + travel);
    }
    // Boxes waiting at a lane because its truck is not there yet: stacked by the wall.
    sim.lanes.forEach((lane) => {
      const ship = sim.layout.ships[lane.id];
      let k = 0;
      for (const box of lane.buffer) {
        if (handled.has(box.id)) continue;
        const col = k % 2;
        const layer = Math.floor(k / 4);
        const row = Math.floor(k / 2) % 2;
        put(box, C.cellX(ship.cells[col]), 0.56 + layer * 0.75, C.backZ - 0.5 - row * 0.9);
        k++;
        if (k >= 16) break;
      }
    });

    this.count = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  boxIdAt(instanceId) {
    return instanceId < this.count ? this.ids[instanceId] : null;
  }
}
