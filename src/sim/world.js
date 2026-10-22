// The supply chain around the warehouse: factories make boxes, trucks bring
// them to the warehouse, stores sell them to customers and order more.
// Like sim.js it has no 3D code, so tests can run it without a browser.

import { Sim, TICK } from './sim.js';
import { buildMap, TRUCK_HALF } from './map.js';
import { makeRng } from './random.js';
import { FactoryFloor } from './factoryFloor.js';
import { makeCoords } from '../render/coords.js';

export const CLOCK_SPEED = 30; // 1 real second = 30 clock seconds
export const START_HOUR = 6;

export const DEFAULT_WORLD = {
  robots: 10,
  factories: 3,
  stores: 3,
  customersPerHour: 12, // all stores together
  targetFill: 0.8,
  seed: 7,
};

const FACTORY_NAMES = ['Nordwerk', 'Isar Works', 'Alpenfab', 'Donau Plant', 'Hafenwerk', 'Bergmill', 'Lechtal', 'Ostpark'];
const STORE_NAMES = ['Downtown', 'Riverside', 'Market Square', 'Old Town', 'Harbour', 'Hillside', 'Station', 'Parkview'];

const TRUCK_LOAD = 18; // boxes a truck can carry
const MIN_FACTORY_LOAD = 12; // purchasing waits for a fairly full truck unless something is urgent
const FACTORY_CAP = 60; // finished boxes a factory can keep
const CYCLE = 7; // seconds per box on a production line
const SHELF_MAX = 10; // boxes per product on a store's shelves
const LANE_WAIT = 180; // seconds a shipping truck waits before leaving half full
const STORE_DUE = 240; // seconds the warehouse has for a store order

// Customers per hour change through the day: busy at lunch and after work.
export function shopFactor(hour) {
  if (hour < 8 || hour >= 20) return 0;
  if (hour >= 12 && hour < 13) return 2;
  if (hour >= 17 && hour < 19) return 1.8;
  if (hour < 10) return 0.6;
  return 1;
}

export class World {
  constructor(settings = {}) {
    this.reset(settings);
  }

  reset(settings = {}) {
    const s = (this.settings = { ...DEFAULT_WORLD, ...settings });
    this.sim = new Sim({ robots: s.robots, targetFill: s.targetFill, seed: s.seed, chain: true, lanes: s.stores });
    this.sim.onTruckGone = (t) => this.truckLeftWarehouse(t);
    const rng = (this.rng = makeRng(s.seed * 31 + 5));
    this.C = makeCoords(this.sim.layout);
    // The map has its own dice, so the same seed always gives the same map.
    this.map = buildMap(this.C, s.factories, s.stores, makeRng(s.seed * 17 + 3));
    const products = this.sim.products;

    this.factories = this.map.factories.map((m) => {
      const own = products.filter((p) => p.id % s.factories === m.id).map((p) => p.id);
      const stock = products.map(() => 0);
      // Start with some boxes ready so the first trucks can leave right away.
      for (let k = 0; k < 30; k++) stock[rng.pick(own)]++;
      return {
        ...m,
        name: FACTORY_NAMES[m.id],
        products: own,
        stock,
        lines: [0, 1].map((i) => ({ id: i, product: own[i % own.length], progress: 0 })),
        docks: m.docks.map((d) => ({ ...d, truck: null })),
        orders: [], // purchase orders from the warehouse
        made: 0,
      };
    });
    this.floors = this.factories.map((f) => new FactoryFloor(f, makeRng(this.settings.seed * 7 + f.id)));
    this.stores = this.map.stores.map((m) => ({
      ...m,
      name: STORE_NAMES[m.id],
      stock: products.map(() => 8),
      onOrder: products.map(() => 0),
      dockTruck: null,
      soldToday: 0,
      lostToday: 0,
      customersToday: 0,
      soldTotal: 0,
      lostTotal: 0,
      nextCheck: 0,
    }));
    this.lanes = this.sim.layout.ships.map((ship) => ({ id: ship.id, x: this.C.x(ship.x), truck: null }));
    this.trucks = [];
    this.nextTruckId = 1;
    this.nextPoId = 1;
    this.nextPurchase = 0;
    this.day = 0;
    this.stats = { delivered: 0, trips: 0, leadSum: 0, leadCount: 0 };
  }

  // ---------- time ----------
  get time() {
    return this.sim.time;
  }

  // Seconds since midnight of day 1 on the wall clock.
  get clock() {
    return START_HOUR * 3600 + this.time * CLOCK_SPEED;
  }

  get hour() {
    return (this.clock / 3600) % 24;
  }

  log(text, kind) {
    this.sim.log(text, kind);
  }

  step() {
    const before = Math.floor(this.clock / 86400);
    this.sim.step();
    if (Math.floor(this.clock / 86400) !== before) {
      for (const st of this.stores) {
        st.soldToday = 0;
        st.lostToday = 0;
        st.customersToday = 0;
      }
    }
    this.produce();
    for (const fl of this.floors) fl.step(TICK, this);
    this.shop();
    this.purchase();
    this.storeOrders();
    this.manageLanes();
    this.moveTrucks();
  }

  // ---------- factories ----------
  produce() {
    for (const f of this.factories) {
      const total = f.stock.reduce((a, b) => a + b, 0);
      for (const line of f.lines) {
        if (total >= FACTORY_CAP) continue;
        line.progress += TICK;
        if (line.progress < CYCLE) continue;
        line.progress = 0;
        f.stock[line.product]++;
        f.made++;
        line.product = this.nextProduct(f, line);
      }
    }
  }

  // Make what open orders need first, otherwise what the factory has least of.
  nextProduct(f, line) {
    const need = this.sim.products.map(() => 0);
    for (const po of f.orders) if (po.status === 'waiting' || po.status === 'loading') for (const p of po.items) need[p]++;
    let best = line.product;
    let bestScore = -Infinity;
    for (const p of f.products) {
      const other = f.lines.find((l) => l !== line && l.product === p) ? 2 : 0;
      const score = need[p] - f.stock[p] - other + this.rng.next() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  // ---------- warehouse purchasing ----------
  // Boxes per product the warehouse has or will soon have, minus what stores still wait for.
  position() {
    const sim = this.sim;
    const pos = sim.products.map(() => 0);
    for (const b of sim.boxes.values()) if (!b.order) pos[b.product]++;
    for (const t of sim.trucks) {
      if (t.status === 'gone' || t.status === 'leaving') continue;
      for (const p of t.load.slice(t.unloaded)) pos[p]++;
    }
    for (const f of this.factories) {
      for (const po of f.orders) if (po.status === 'waiting' || po.status === 'loading') for (const p of po.items) pos[p]++;
    }
    for (const t of this.trucks) if (t.kind === 'in') for (const p of t.cargo) pos[p]++;
    for (const o of sim.orders) {
      if (o.status !== 'open') continue;
      for (const line of o.lines) if (line.state === 'backorder') pos[line.product]--;
    }
    return pos;
  }

  purchase() {
    if (this.time < this.nextPurchase) return;
    this.nextPurchase = this.time + 5;
    const sim = this.sim;
    const target = this.settings.targetFill * sim.capacity;
    const pos = this.position();
    let room = target - pos.reduce((a, p) => a + Math.max(0, p), 0);
    const backorder = pos.map((p) => p < 0);
    for (const f of this.factories) {
      const open = f.orders.filter((po) => po.status === 'waiting' || po.status === 'loading').length;
      if (open >= f.docks.length) continue;
      const items = [];
      const deficit = f.products.map((p) => ({ p, d: sim.products[p].share * target - pos[p] }));
      while (items.length < TRUCK_LOAD) {
        deficit.sort((a, b) => b.d - a.d);
        if (deficit[0].d < 1) break;
        if (room < 1 && !backorder[deficit[0].p]) break;
        items.push(deficit[0].p);
        deficit[0].d -= 1;
        room--;
      }
      const urgent = items.some((p) => backorder[p]);
      if (items.length >= MIN_FACTORY_LOAD || (urgent && items.length)) {
        for (const p of items) pos[p]++;
        const po = { id: this.nextPoId++, items, status: 'waiting', created: this.time, truck: null };
        f.orders.push(po);
        this.dispatchFactoryTruck(f, po);
      } else {
        room += items.length;
      }
    }
  }

  // ---------- stores ----------
  shop() {
    const factor = shopFactor(this.hour);
    if (!factor) return;
    const sim = this.sim;
    const perStore = this.settings.customersPerHour / this.stores.length;
    const chance = (perStore * factor * TICK * CLOCK_SPEED) / 3600;
    for (const st of this.stores) {
      if (this.rng.next() >= chance) continue;
      st.customersToday++;
      const n = 1 + this.rng.weighted([0.6, 0.3, 0.1]);
      for (let k = 0; k < n; k++) {
        const p = this.rng.weighted(sim.products.map((x) => x.share));
        if (st.stock[p] > 0) {
          st.stock[p]--;
          st.soldToday++;
          st.soldTotal++;
        } else {
          st.lostToday++;
          st.lostTotal++;
        }
      }
    }
  }

  // A store orders when products run low, in batches so trucks are worth the trip.
  storeOrders() {
    for (const st of this.stores) {
      if (this.time < st.nextCheck) continue;
      st.nextCheck = this.time + 10;
      const want = [];
      let empty = false;
      this.sim.products.forEach((p) => {
        const have = st.stock[p.id] + st.onOrder[p.id];
        if (have <= 4) {
          for (let k = have; k < SHELF_MAX; k++) want.push(p.id);
          if (st.stock[p.id] === 0) empty = true;
        }
      });
      if (want.length >= 8 || (empty && want.length)) {
        const items = want.slice(0, TRUCK_LOAD);
        for (const p of items) st.onOrder[p]++;
        const order = this.sim.addOrder(st.id, items, STORE_DUE);
        order.store = st.name;
      }
    }
  }

  // ---------- shipping lanes at the warehouse ----------
  manageLanes() {
    const sim = this.sim;
    for (const lane of this.lanes) {
      const buffer = sim.lanes[lane.id].buffer;
      const truck = lane.truck && this.trucks.find((t) => t.id === lane.truck);
      if (!truck) {
        lane.truck = null;
        const waiting = buffer.length || sim.orders.some((o) => o.status === 'open' && o.ship === lane.id);
        if (waiting) this.dispatchLaneTruck(lane);
        continue;
      }
      if (truck.state !== 'docked') continue;
      // Load boxes from the conveyor into the truck.
      if (buffer.length && truck.cargo.length < TRUCK_LOAD && this.time >= (truck.nextBox ?? 0)) {
        const box = buffer.shift();
        truck.cargo.push(box.product);
        truck.boxes.push(box);
        truck.firstBox ??= this.time;
        truck.nextBox = this.time + 0.6;
      }
      const full = truck.cargo.length >= TRUCK_LOAD;
      const waited = truck.firstBox !== undefined && this.time - truck.firstBox >= LANE_WAIT;
      if (full || (waited && !buffer.length)) {
        const store = this.stores[lane.id];
        truck.dest = store.id;
        truck.label = `Warehouse → ${store.name}`;
        this.go(truck, this.map.paths.laneToStore(lane.x, store), 'toStore');
        lane.truck = null;
        this.stats.trips++;
      }
    }
  }

  // ---------- trucks ----------
  newTruck(props) {
    const t = {
      id: this.nextTruckId++, x: 0, z: 0, px: 0, pz: 0, heading: 0, pheading: 0, speed: 0,
      path: [], seg: 0, state: 'drive', cargo: [], boxes: [], waitFor: 0, ...props,
    };
    t.name = `T-${String(t.id).padStart(3, '0')}`;
    t.color = this.rng.pick([0xd9dde3, 0xe9eef2, 0xc7ccd3, 0xf2f2ee]);
    this.trucks.push(t);
    return t;
  }

  place(t, p, heading) {
    t.x = t.px = p.x;
    t.z = t.pz = p.z;
    t.heading = t.pheading = heading;
  }

  go(t, path, phase) {
    t.path = path;
    t.seg = 0;
    t.state = 'drive';
    t.phase = phase;
    t.waited = 0;
    t.departed = this.time;
  }

  dispatchFactoryTruck(f, po) {
    const d = f.docks.findIndex((dk) => !dk.truck);
    if (d < 0) return;
    const t = this.newTruck({ kind: 'in', factory: f.id, po: po.id, dock: d, label: `${f.name} → Warehouse` });
    f.docks[d].truck = t.id;
    po.truck = t.id;
    const path = this.map.paths.garageToDock(f, d);
    const start = this.map.paths.garageStart(f);
    this.place(t, start, start.heading);
    this.go(t, path, 'toFactoryDock');
  }

  dispatchLaneTruck(lane) {
    const t = this.newTruck({ kind: 'out', lane: lane.id, label: 'Depot → Warehouse' });
    lane.truck = t.id;
    const start = this.map.paths.depotStart();
    this.place(t, start, start.heading);
    this.go(t, this.map.paths.depotToLane(lane.x), 'toLane');
  }

  // A factory truck left a warehouse dock: send it home.
  truckLeftWarehouse(simTruck) {
    const f = this.factories[simTruck.from];
    if (!f) return;
    const t = this.newTruck({ kind: 'return', factory: f.id, label: `Warehouse → ${f.name} (empty)` });
    t.color = simTruck.color;
    this.place(t, this.map.yardExitCentre, 0);
    this.go(t, this.map.paths.warehouseToGarage(f), 'home');
    const po = f.orders.find((o) => o.id === simTruck.po);
    if (po) po.status = 'delivered';
    f.orders = f.orders.filter((o) => o.status !== 'delivered');
  }

  arrive(t) {
    const now = this.time;
    if (t.phase === 'toFactoryDock') {
      t.state = 'docked';
      t.label = `Loading at ${this.factories[t.factory].name}`;
    } else if (t.phase === 'toWarehouse') {
      // Hand over to the warehouse yard.
      const f = this.factories[t.factory];
      const st = this.sim.receiveTruck({ name: t.name, load: t.cargo, planned: t.eta, color: t.color, from: f.id });
      st.po = t.po;
      this.remove(t);
    } else if (t.phase === 'toLane') {
      t.state = 'docked';
      t.label = `Loading at shipping lane ${t.lane + 1}`;
    } else if (t.phase === 'toStore') {
      t.state = 'unloading';
      t.nextBox = now + 1;
      t.label = `Unloading at ${this.stores[t.dest].name}`;
    } else {
      this.remove(t);
    }
  }

  remove(t) {
    this.trucks = this.trucks.filter((x) => x !== t);
  }

  // Loading at factories and unloading at stores.
  handleDocked(t) {
    const now = this.time;
    if (t.kind === 'in' && t.state === 'docked') {
      const f = this.factories[t.factory];
      const po = f.orders.find((o) => o.id === t.po);
      if (po.status === 'waiting') {
        const need = f.stock.map(() => 0);
        for (const p of po.items) need[p]++;
        const ready = need.every((n, p) => n <= f.stock[p]);
        if (ready) {
          for (const p of po.items) f.stock[p]--;
          po.status = 'loading';
          t.loadUntil = now + po.items.length * 0.6;
        }
      } else if (po.status === 'loading' && now >= t.loadUntil) {
        po.status = 'shipped';
        t.cargo = [...po.items];
        f.docks[t.dock].truck = null;
        const path = this.map.paths.factoryToWarehouse(f, t.dock);
        this.go(t, path, 'toWarehouse');
        t.eta = now + pathLength(t, path) / 9 + 8;
        t.label = `${f.name} → Warehouse`;
        this.stats.trips++;
        // Another order may be waiting for a free dock.
        const next = f.orders.find((o) => o.status === 'waiting' && !o.truck);
        if (next) this.dispatchFactoryTruck(f, next);
      }
    }
    if (t.state === 'unloading' && now >= t.nextBox) {
      const st = this.stores[t.dest];
      if (t.cargo.length) {
        const p = t.cargo.pop();
        t.boxes.pop();
        st.stock[p]++;
        st.onOrder[p] = Math.max(0, st.onOrder[p] - 1);
        this.stats.delivered++;
        t.nextBox = now + 0.6;
      } else {
        t.label = `${st.name} → Depot (empty)`;
        this.go(t, this.map.paths.storeToDepot(st), 'home');
      }
    }
  }

  moveTrucks() {
    const dt = TICK;
    for (const t of this.trucks) {
      t.px = t.x;
      t.pz = t.z;
      t.pheading = t.heading;
      if (t.state !== 'drive') {
        this.handleDocked(t);
        continue;
      }
      const target = t.path[t.seg];
      if (!target) {
        this.arrive(t);
        continue;
      }
      const dx = target.x - t.x;
      const dz = target.z - t.z;
      const dist = Math.hypot(dx, dz);
      const rev = !!target.rev;
      const cruise = rev ? 2.5 : target.site ? 5 : 11;
      let want = this.blocked(t) ? 0 : cruise;
      // Slow down for the end of the route and for corners.
      const next = t.path[t.seg + 1];
      if (!next) want = Math.min(want, Math.max(1.5, dist * 0.8));
      t.speed += Math.max(-6 * dt, Math.min(3 * dt, want - t.speed));
      if (want === 0) t.speed = 0;
      // Turn the cab toward the way we drive (backwards when reversing).
      const dirAngle = Math.atan2(dz, dx);
      const face = rev ? dirAngle + Math.PI : dirAngle;
      let diff = face - t.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const turnRate = Math.max(0.8, t.speed / 5);
      t.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      const stepLen = t.speed * dt;
      if (stepLen >= dist) {
        t.x = target.x;
        t.z = target.z;
        t.seg++;
        if (!t.path[t.seg]) this.arrive(t);
      } else if (dist > 0) {
        t.x += (dx / dist) * stepLen;
        t.z += (dz / dist) * stepLen;
      }
      t.waited = t.speed < 0.1 ? t.waited + dt : 0;
    }
  }

  // Is another truck right in front of us in our lane?
  blocked(t) {
    const target = t.path[t.seg];
    if (!target || target.rev || target.dock) return false;
    if (t.waited > 8) return false; // never wait forever at a crossing
    const fx = Math.cos(t.heading);
    const fz = Math.sin(t.heading);
    const frontX = t.x + fx * TRUCK_HALF;
    const frontZ = t.z + fz * TRUCK_HALF;
    for (const o of this.trucks) {
      if (o === t || o.state === 'docked' || o.state === 'unloading') continue;
      const ox = Math.cos(o.heading) * TRUCK_HALF;
      const oz = Math.sin(o.heading) * TRUCK_HALF;
      for (const [px, pz] of [[o.x - ox, o.z - oz], [o.x, o.z], [o.x + ox, o.z + oz]]) {
        const rx = px - frontX;
        const rz = pz - frontZ;
        const along = rx * fx + rz * fz;
        const side = Math.abs(rx * fz - rz * fx);
        if (along > -1 && along < 7 && side < 1.7) {
          // Two trucks blocking each other: the older one goes first.
          if (o.id > t.id && this.blocks(o, t)) continue;
          return true;
        }
      }
    }
    return false;
  }

  blocks(a, b) {
    const fx = Math.cos(a.heading);
    const fz = Math.sin(a.heading);
    const rx = b.x - (a.x + fx * TRUCK_HALF);
    const rz = b.z - (a.z + fz * TRUCK_HALF);
    const along = rx * fx + rz * fz;
    return along > -TRUCK_HALF - 1 && along < 7 + TRUCK_HALF && Math.abs(rx * fz - rz * fx) < 1.7;
  }

  // ---------- numbers for the panel ----------
  summary() {
    const storeStock = this.stores.reduce((a, s) => a + s.stock.reduce((x, y) => x + y, 0), 0);
    return {
      factoryStock: this.factories.reduce((a, f) => a + f.stock.reduce((x, y) => x + y, 0), 0),
      onRoad: this.trucks.reduce((a, t) => a + t.cargo.length, 0)
        + this.sim.trucks.filter((t) => t.status !== 'gone').reduce((a, t) => a + t.load.length - t.unloaded, 0),
      storeStock,
      storeCapacity: this.stores.length * this.sim.products.length * SHELF_MAX,
      sold: this.stores.reduce((a, s) => a + s.soldTotal, 0),
      lost: this.stores.reduce((a, s) => a + s.lostTotal, 0),
      trucks: this.trucks.length + this.sim.trucks.filter((t) => t.status !== 'gone' && t.status !== 'planned').length,
    };
  }
}

function pathLength(t, path) {
  let len = 0;
  let x = t.x;
  let z = t.z;
  for (const p of path) {
    len += Math.hypot(p.x - x, p.z - z);
    x = p.x;
    z = p.z;
  }
  return len;
}

export { SHELF_MAX, TRUCK_LOAD };
