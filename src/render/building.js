// The static parts of the warehouse: floor, walls, racks, docks, conveyors, chargers.
import * as THREE from 'three';
import { CELL } from '../sim/layout.js';
import { CS, LEVEL_H, SHELF0 } from './coords.js';

const COLORS = {
  upright: 0x2c5aa0,
  beam: 0xe8742a,
  deck: 0xb9bcc2,
  wall: 0xe4e2dc,
  wallTrim: 0x3a4250,
  yard: 0x4a4d52,
};

function floorTexture(L) {
  const px = 64;
  const cv = document.createElement('canvas');
  cv.width = L.W * px;
  cv.height = L.D * px;
  const g = cv.getContext('2d');
  // Polished concrete with a bit of noise.
  g.fillStyle = '#c9c6bf';
  g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 9000; i++) {
    const v = 180 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.25)`;
    g.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // Faint grid of the robot cells.
  g.strokeStyle = 'rgba(80,80,80,0.12)';
  g.lineWidth = 2;
  for (let x = 0; x <= L.W; x++) {
    g.beginPath(); g.moveTo(x * px, 0); g.lineTo(x * px, cv.height); g.stroke();
  }
  for (let z = 0; z <= L.D; z++) {
    g.beginPath(); g.moveTo(0, z * px); g.lineTo(cv.width, z * px); g.stroke();
  }
  const cell = (x, z, color) => {
    g.fillStyle = color;
    g.fillRect(x * px + 3, z * px + 3, px - 6, px - 6);
  };
  for (let z = 0; z < L.D; z++) {
    for (let x = 0; x < L.W; x++) {
      const t = L.type[L.idx(x, z)];
      if (t === CELL.DOCK) {
        cell(x, z, 'rgba(240,190,40,0.55)');
        g.strokeStyle = 'rgba(30,30,30,0.5)';
        g.lineWidth = 5;
        for (let k = -px; k < px; k += 16) {
          g.beginPath(); g.moveTo(x * px + k, z * px); g.lineTo(x * px + k + px, z * px + px); g.stroke();
        }
      } else if (t === CELL.SHIP) {
        cell(x, z, 'rgba(60,170,110,0.55)');
      } else if (t === CELL.PARK) {
        cell(x, z, 'rgba(50,120,220,0.45)');
      } else if (t === CELL.RACK) {
        cell(x, z, 'rgba(90,90,95,0.25)');
      }
    }
  }
  // Yellow lines along the roads.
  g.strokeStyle = 'rgba(235,190,30,0.9)';
  g.lineWidth = 5;
  const line = (x1, z1, x2, z2) => {
    g.beginPath(); g.moveTo(x1 * px, z1 * px); g.lineTo(x2 * px, z2 * px); g.stroke();
  };
  line(1, 1, L.W - 1, 1);
  line(1, L.D - 1, L.W - 1, L.D - 1);
  line(1, 1, 1, L.D - 1);
  line(L.W - 1, 1, L.W - 1, L.D - 1);
  for (const r of L.rows) {
    line(r.xa, L.zRack0, r.xa, L.zRack1 + 1);
    line(r.xb + 1, L.zRack0, r.xb + 1, L.zRack1 + 1);
  }
  // Dashed centre lines on the main roads.
  g.setLineDash([24, 18]);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 3;
  line(1, 2, L.W - 1, 2);
  line(1, L.D - 2, L.W - 1, L.D - 2);
  g.setLineDash([]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildBuilding(scene, L, C) {
  const group = new THREE.Group();
  scene.add(group);
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // Outdoor ground and truck yard.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: 0x6f7a62, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(C.width + 50, 40),
    new THREE.MeshStandardMaterial({ color: COLORS.yard, roughness: 0.95 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(0, -0.01, C.frontZ - 20);
  yard.receiveShadow = true;
  group.add(yard);
  const backLot = yard.clone();
  backLot.scale.set(1, 0.35, 1);
  backLot.position.set(0, -0.01, C.backZ + 7);
  group.add(backLot);

  // Yard markings for the waiting trucks.
  const markMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 9), markMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI / 2;
    m.position.set(-C.width / 2 + 2 + i * 4.2, 0.0, C.frontZ - 30);
    group.add(m);
  }

  // Warehouse floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(C.width, C.depth),
    new THREE.MeshStandardMaterial({ map: floorTexture(L), roughness: 0.55, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Low outer walls with openings for the docks and conveyors.
  const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: COLORS.wallTrim, roughness: 0.6 });
  const wallH = 1.7;
  const wall = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.01) return;
    const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(len, wallH, 0.25), wallMat));
    m.position.set((x1 + x2) / 2, wallH / 2, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    group.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.3), trimMat);
    trim.position.set((x1 + x2) / 2, wallH, (z1 + z2) / 2);
    trim.rotation.y = m.rotation.y;
    group.add(trim);
  };
  const openings = (z, cellsList) => {
    const xs = cellsList.flat().map((c) => C.cellX(c)).sort((a, b) => a - b);
    const gaps = [];
    for (const cells of cellsList) {
      const cx = cells.map((c) => C.cellX(c));
      gaps.push([Math.min(...cx) - CS / 2, Math.max(...cx) + CS / 2]);
    }
    gaps.sort((a, b) => a[0] - b[0]);
    let x = C.leftX;
    for (const [a, b] of gaps) {
      wall(x, z, a, z);
      x = b;
    }
    wall(x, z, C.rightX, z);
    return xs;
  };
  openings(C.frontZ, L.docks.map((d) => d.cells));
  openings(C.backZ, L.ships.map((s) => s.cells));
  wall(C.leftX, C.frontZ, C.leftX, C.backZ);
  wall(C.rightX, C.frontZ, C.rightX, C.backZ);

  // Racks: blue uprights, orange beams, grey shelves. Drawn with instancing for speed.
  const upGeo = new THREE.BoxGeometry(0.09, 1, 0.09);
  const beamGeo = new THREE.BoxGeometry(0.07, 0.1, CS);
  const deckGeo = new THREE.BoxGeometry(CS - 0.12, 0.04, CS - 0.06);
  let ups = 0;
  let beams = 0;
  let decks = 0;
  for (const r of L.rows) {
    const cellsAlong = L.rackLength;
    ups += 2 * 2 * (cellsAlong + 1);
    beams += 2 * 2 * cellsAlong * (r.levels + 1);
    decks += 2 * cellsAlong * r.levels;
  }
  const upMesh = new THREE.InstancedMesh(upGeo, new THREE.MeshStandardMaterial({ color: COLORS.upright, metalness: 0.35, roughness: 0.45 }), ups);
  const beamMesh = new THREE.InstancedMesh(beamGeo, new THREE.MeshStandardMaterial({ color: COLORS.beam, metalness: 0.2, roughness: 0.5 }), beams);
  const deckMesh = new THREE.InstancedMesh(deckGeo, new THREE.MeshStandardMaterial({ color: COLORS.deck, metalness: 0.5, roughness: 0.6 }), decks);
  for (const m of [upMesh, beamMesh, deckMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  let iu = 0;
  let ib = 0;
  let id = 0;
  for (const r of L.rows) {
    const top = SHELF0 + r.levels * LEVEL_H + 0.1;
    for (const gx of [r.xa, r.xb]) {
      const cx = C.x(gx);
      for (let k = 0; k <= L.rackLength; k++) {
        const z = C.z(L.zRack0 + k) - CS / 2;
        for (const side of [-1, 1]) {
          pos.set(cx + side * (CS / 2 - 0.08), top / 2, z);
          scl.set(1, top, 1);
          upMesh.setMatrixAt(iu++, mat.compose(pos, quat, scl));
        }
      }
      for (let k = 0; k < L.rackLength; k++) {
        const z = C.z(L.zRack0 + k);
        for (let level = 0; level <= r.levels; level++) {
          const y = SHELF0 + level * LEVEL_H - 0.06;
          for (const side of [-1, 1]) {
            pos.set(cx + side * (CS / 2 - 0.08), y, z);
            scl.set(1, 1, 1);
            beamMesh.setMatrixAt(ib++, mat.compose(pos, quat, scl));
          }
          if (level < r.levels) {
            pos.set(cx, y + 0.04, z);
            deckMesh.setMatrixAt(id++, mat.compose(pos, quat, scl));
          }
        }
      }
    }
  }
  upMesh.count = iu;
  beamMesh.count = ib;
  deckMesh.count = id;

  // Dock doors: frame, roll-up door and a bumper; the dock plate where unloaded boxes wait.
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.4 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.5 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x5b6068, metalness: 0.6, roughness: 0.5 });
  for (const d of L.docks) {
    const x = C.x(d.x);
    const w = CS * 2;
    for (const side of [-1, 1]) {
      const post = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 0.3), frameMat));
      post.position.set(x + side * (w / 2 + 0.1), 1.7, C.frontZ);
      group.add(post);
    }
    const lintel = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, 0.3), frameMat));
    lintel.position.set(x, 3.45, C.frontZ);
    group.add(lintel);
    const door = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, 0.15), doorMat));
    door.position.set(x, 3.0, C.frontZ);
    group.add(door);
    const plate = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 1.6), plateMat));
    plate.position.set(x, 0.05, C.frontZ - 0.8);
    group.add(plate);
  }

  // Short conveyors through the back wall, straight into the truck for each store.
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.35 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x55606c, metalness: 0.4 });
  for (const s of L.ships) {
    for (const c of s.cells) {
      const x = C.cellX(c);
      const z0 = C.cellZ(c) + CS * 0.3;
      const len = C.backZ + 0.35 - z0;
      const belt = shadowy(new THREE.Mesh(new THREE.BoxGeometry(CS * 0.8, 0.12, len), beltMat));
      belt.position.set(x, 0.5, z0 + len / 2);
      group.add(belt);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, len), railMat);
        rail.position.set(x + side * CS * 0.42, 0.6, z0 + len / 2);
        group.add(rail);
      }
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), legMat);
      leg.position.set(x, 0.22, z0 + len / 2);
      group.add(leg);
    }
  }

  // Charging pads at the parking spots.
  const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.5 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 1.2 });
  for (const c of L.parking) {
    const x = C.cellX(c);
    const z = C.cellZ(c);
    const out = x < 0 ? -1 : 1;
    const post = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.4), postMat));
    post.position.set(x + out * (CS / 2 - 0.15), 0.35, z);
    group.add(post);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.25), glowMat);
    glow.position.set(x + out * (CS / 2 - 0.25), 0.55, z);
    group.add(glow);
  }

  return group;
}
