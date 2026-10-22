// The region around the warehouse: roads, factories, stores, the truck depot,
// trees, the signs on every building, and all trucks driving between them.
import * as THREE from 'three';
import { makeTruck } from './trucks.js';
import { TRUCK_HALF } from '../sim/map.js';
import { SHELF_MAX } from '../sim/world.js';
import { makeRng } from '../sim/random.js';

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
    for (const r of map.roads) {
      const dx = r.b.x - r.a.x;
      const dz = r.b.z - r.a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const angle = Math.atan2(dx, dz);
      strips.push([(r.a.x + r.b.x) / 2, 0.02, (r.a.z + r.b.z) / 2, angle, r.width, len + r.width]);
      if (r.width < 9) continue;
      for (let d = 3; d < len - 2; d += 7) dashes.push([r.a.x + (dx * d) / len, 0.05, r.a.z + (dz * d) / len, angle, 0.2, 3]);
      for (const side of [-1, 1]) {
        const nx = (dz / len) * side * (r.width / 2 - 0.4);
        const nz = (-dx / len) * side * (r.width / 2 - 0.4);
        edges.push([(r.a.x + r.b.x) / 2 + nx, 0.04, (r.a.z + r.b.z) / 2 + nz, angle, 0.15, len]);
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
    flat(strips, mat(0x3f4348, { roughness: 0.95 }));
    flat(dashes, new THREE.MeshBasicMaterial({ color: 0xe5e7eb }));
    flat(edges, new THREE.MeshBasicMaterial({ color: 0xbfc4ca }));

    this.factorySigns = world.factories.map((f) => this.buildFactory(f, world));
    this.storeSigns = world.stores.map((s) => this.buildStore(s));
    this.buildDepot(map.depot);
    this.buildTrees(world);
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
    const wall = mat(0xd6d3cc);
    const darker = mat(0x9ca3af, { metalness: 0.3 });
    const accent = mat(0x0f766e);
    // Concrete apron in front of the docks.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(W + 30, 22), mat(0x8d9096, { roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.01, face + 9);
    apron.receiveShadow = true;
    g.add(apron);
    // The hall is built from walls and a roof, so close up the roof and the
    // front wall can be hidden to look inside (see openFactory).
    const T = 0.3;
    const part = (w, h, d, x, y, z, material = wall) => {
      const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    part(W, H, T, 0, H / 2, cz - D / 2 + T / 2); // back
    part(T, H, D, -W / 2 + T / 2, H / 2, cz);
    part(T, H, D, W / 2 - T / 2, H / 2, cz);
    const closed = [part(W, H, T, 0, H / 2, face - T / 2), part(W, T, D, 0, H - T / 2, cz)]; // front wall, roof
    // A low front wall with openings at the dock doors, shown when open.
    const open = [];
    const cuts = [-W / 2, ...f.docks.flatMap((d) => [d.u - 2, d.u + 2]), W / 2];
    for (let k = 0; k < cuts.length; k += 2) {
      const m = part(cuts[k + 1] - cuts[k], 1.1, T, (cuts[k] + cuts[k + 1]) / 2, 0.55, face - T / 2);
      m.visible = false;
      open.push(m);
    }
    // Saw-tooth roof.
    for (let k = 0; k < 5; k++) {
      const tooth = shadowy(new THREE.Mesh(new THREE.BoxGeometry(W / 5 - 0.4, 2.4, D), darker));
      tooth.position.set(-W / 2 + (k + 0.5) * (W / 5), H + 1.0, cz);
      tooth.rotation.z = 0.35;
      g.add(tooth);
      closed.push(tooth);
    }
    // Chimney with a band, just behind the hall.
    const chimney = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 22, 18), mat(0xb45309)));
    chimney.position.set(W / 2 - 4, 11, cz - D / 2 - 2);
    g.add(chimney);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.4, 18), mat(0xf5f5f4));
    band.position.set(chimney.position.x, 19, chimney.position.z);
    g.add(band);
    // Coloured stripe and dock doors.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.8, D + 0.1), accent);
    stripe.position.set(0, H - 0.8, cz);
    g.add(stripe);
    closed.push(stripe);
    for (const d of f.docks) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.8, 0.2), mat(0x64748b, { metalness: 0.4 }));
      door.position.set(d.u, 2.2, face + 0.05);
      g.add(door);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.3, 0.3), mat(0xf2b705));
      frame.position.set(d.u, 4.2, face + 0.1);
      g.add(frame);
      closed.push(door, frame);
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
    closed.push(sign.mesh);
    return { sign, f, products: world.sim.products, closed, open, isOpen: false };
  }

  // Close up, a factory loses its roof and front wall so you can look inside.
  openFactory(i, isOpen) {
    const fs = this.factorySigns[i];
    if (!fs || fs.isOpen === isOpen) return;
    fs.isOpen = isOpen;
    for (const m of fs.closed) m.visible = !isOpen;
    for (const m of fs.open) m.visible = isOpen;
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

  buildDepot(d) {
    const g = this.group;
    const shed = shadowy(new THREE.Mesh(new THREE.BoxGeometry(16, 6, 12), mat(0x9ca3af, { metalness: 0.3 })));
    shed.position.set(d.x + 12, 3, d.z);
    g.add(shed);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 5), mat(0x475569));
    door.position.set(d.x + 3.9, 2.5, d.z);
    g.add(door);
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
    const spots = [];
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
    for (let k = 0; k < 2500 && spots.length < 360; k++) {
      const x = b.minX - 60 + rng() * (b.maxX - b.minX + 120);
      const z = b.minZ - 60 + rng() * (b.maxZ - b.minZ + 120);
      if (!blocked(x, z)) spots.push([x, z, 0.7 + rng() * 0.7]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), mat(0x6b4f35), spots.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 5.5, 8), mat(0x2f6b3a), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach(([x, z, s], i) => {
      trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, 1.2 * s, z), q, new THREE.Vector3(s, s, s)));
      crown.setMatrixAt(i, m.compose(new THREE.Vector3(x, (2.4 + 2.5) * s, z), q, new THREE.Vector3(s, s, s)));
      crown.setColorAt(i, new THREE.Color().setHSL(0.3 + rng() * 0.06, 0.45, 0.24 + rng() * 0.1));
    });
    trunk.castShadow = crown.castShadow = true;
    this.group.add(trunk, crown);
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
