// The supply chain around the warehouse: factories make boxes, trucks bring
// them to the warehouse, stores sell them to customers and order more.
// Like sim.js it has no 3D code, so tests can run it without a browser.

import { Sim, TICK } from './sim.js';
import { buildMap, TRUCK_HALF } from './map.js';
import { makeRng } from './random.js';
import { FactoryFloor } from './factoryFloor.js';
import { StoreFloor } from './storeFloor.js';
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
      visits: [], // what each customer bought, for the store's inside (storeFloor.js)
    }));
    this.storeFloors = this.stores.map((s) => new StoreFloor(s, makeRng(this.settings.seed * 13 + s.id)));
    this.lanes = this.sim.layout.ships.map((ship) => ({ id: ship.id, x: this.C.x(ship.x), truck: null }));
    this.trucks = [];
    this.zones = this.map.zones.map(() => ({ holder: null, queue: [] }));
    this.returns = []; // empty trucks waiting for room to leave the warehouse yard
    // Factories send their first trucks one after another, not all at once.
    const starts = this.factories.map(() => rng.range(10, 40 + 15 * this.factories.length)).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 12);
    const order = this.factories.map((f) => f.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((id, i) => { this.factories[id].nextTruckAt = starts[i]; });
    this.nextFactoryTruck = 0;
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
    for (const fl of this.storeFloors) fl.step(TICK, this);
    this.shop();
    this.purchase();
    this.dispatchWaiting();
    this.storeOrders();
    this.manageLanes();
    this.spawnReturns();
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
      const visit = { bought: [], missed: [] };
      for (let k = 0; k < n; k++) {
        const p = this.rng.weighted(sim.products.map((x) => x.share));
        if (st.stock[p] > 0) {
          st.stock[p]--;
          st.soldToday++;
          st.soldTotal++;
          visit.bought.push(p);
        } else {
          st.lostToday++;
          st.lostTotal++;
          visit.missed.push(p);
        }
      }
      st.visits.push(visit);
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

  // Orders that have no truck yet get one, spaced out so trucks don't all leave at once.
  dispatchWaiting() {
    if (this.time < this.nextFactoryTruck) return;
    for (const f of this.factories) {
      if (this.time < f.nextTruckAt) continue;
      const po = f.orders.find((o) => o.status === 'waiting' && !o.truck);
      if (!po || !this.dispatchFactoryTruck(f, po)) continue;
      f.nextTruckAt = this.time + 40;
      this.nextFactoryTruck = this.time + 4;
      return;
    }
  }

  // Is there room for a truck at this spot? Used before a truck appears.
  roomFor(p, heading) {
    return !this.trucks.some((o) => overlap(p.x, p.z, heading, 0, 1, o.x, o.z, o.heading));
  }

  dispatchFactoryTruck(f, po) {
    const d = f.docks.findIndex((dk) => !dk.truck);
    if (d < 0) return false;
    const start = this.map.paths.garageStart(f);
    if (!this.roomFor(start, start.heading)) return false;
    const t = this.newTruck({ kind: 'in', factory: f.id, po: po.id, dock: d, label: `${f.name} → Warehouse` });
    f.docks[d].truck = t.id;
    po.truck = t.id;
    const path = this.map.paths.garageToDock(f, d);
    this.place(t, start, start.heading);
    this.go(t, path, 'toFactoryDock');
    return true;
  }

  dispatchLaneTruck(lane) {
    const start = this.map.paths.depotStart();
    if (!this.roomFor(start, start.heading)) return;
    const t = this.newTruck({ kind: 'out', lane: lane.id, label: 'Depot → Warehouse' });
    lane.truck = t.id;
    this.place(t, start, start.heading);
    this.go(t, this.map.paths.depotToLane(lane.x), 'toLane');
  }

  // A factory truck left a warehouse dock: send it home.
  truckLeftWarehouse(simTruck) {
    const f = this.factories[simTruck.from];
    if (!f) return;
    const po = f.orders.find((o) => o.id === simTruck.po);
    if (po) po.status = 'delivered';
    f.orders = f.orders.filter((o) => o.status !== 'delivered');
    this.returns.push({ f, color: simTruck.color });
  }

  // Empty trucks drive home from the warehouse yard one at a time, when there is room.
  spawnReturns() {
    if (!this.returns.length) return;
    const p = this.map.yardExitCentre;
    if (!this.roomFor(p, 0)) return;
    const { f, color } = this.returns.shift();
    const t = this.newTruck({ kind: 'return', factory: f.id, label: `Warehouse → ${f.name} (empty)` });
    t.color = color;
    this.place(t, p, 0);
    this.go(t, this.map.paths.warehouseToGarage(f), 'home');
  }

  arrive(t) {
    const now = this.time;
    t.speed = 0;
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
    this.releaseZones(t, true);
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
      } else if (po.status === 'loading' && now >= t.loadUntil && (this.floors[f.id].boxesOwed(t.dock) === 0 || now > t.loadUntil + 90)) {
        // The truck leaves once the forklifts have brought every box to its dock.
        po.status = 'shipped';
        t.cargo = [...po.items];
        f.docks[t.dock].truck = null;
        const path = this.map.paths.factoryToWarehouse(f, t.dock);
        this.go(t, path, 'toWarehouse');
        t.eta = now + pathLength(t, path) / 9 + 8;
        t.label = `${f.name} → Warehouse`;
        this.stats.trips++;
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
    this.tick = (this.tick ?? 0) + 1;
    for (const t of this.trucks) {
      t.px = t.x;
      t.pz = t.z;
      t.pheading = t.heading;
      if (t.state !== 'drive') {
        this.releaseZones(t);
        this.handleDocked(t);
        continue;
      }
      let target = t.path[t.seg];
      if (!target) {
        this.arrive(t);
        continue;
      }
      // Cut corners a little, like a real driver, so the cab doesn't poke into the other lane.
      const after = t.path[t.seg + 1];
      // Aim a few metres along the next stretch instead of at the corner itself.
      const cut = target.site ? 2 : 6;
      if (after && !target.rev && !after.rev && !target.dock && Math.hypot(target.x - t.x, target.z - t.z) < cut) {
        const lx = after.x - target.x;
        const lz = after.z - target.z;
        const len = Math.hypot(lx, lz);
        if (len <= cut) {
          t.seg++;
        } else {
          t.path[t.seg] = { ...target, x: target.x + (lx / len) * cut, z: target.z + (lz / len) * cut };
        }
        target = t.path[t.seg];
      }
      const dx = target.x - t.x;
      const dz = target.z - t.z;
      const dist = Math.hypot(dx, dz);
      const rev = !!target.rev;
      const cruise = rev ? 2.5 : target.site ? 5 : 11;
      let want = cruise;
      // Slow down for the end of the route.
      if (!t.path[t.seg + 1]) want = Math.min(want, Math.max(1.5, dist * 0.8));
      const speed = Math.max(0, t.speed + Math.max(-6 * dt, Math.min(3 * dt, want - t.speed)));
      // Turn the cab toward the way we drive (backwards when reversing).
      const dirAngle = Math.atan2(dz, dx);
      const face = rev ? dirAngle + Math.PI : dirAngle;
      let diff = face - t.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const turnRate = Math.max(1.2, speed / 4);
      const heading = t.heading + Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      const stepLen = Math.max(speed * dt, 0.3);
      const arrived = stepLen >= dist;
      const nx = arrived ? target.x : t.x + (dx / Math.max(dist, 1e-6)) * stepLen;
      const nz = arrived ? target.z : t.z + (dz / Math.max(dist, 1e-6)) * stepLen;
      // Only move if the road ahead is free and we may enter the zone we drive into.
      if (!this.mayMove(t, nx, nz, heading, rev ? -1 : 1, speed, dirAngle)) {
        t.speed = 0;
        t.waited += dt;
        continue;
      }
      t.speed = speed;
      t.heading = heading;
      t.x = nx;
      t.z = nz;
      t.waited = 0;
      this.releaseZones(t);
      if (arrived) {
        t.seg++;
        if (!t.path[t.seg]) this.arrive(t);
      }
    }
  }

  // The three points along a truck: rear, centre and cab.
  bodyPoints(x, z, heading) {
    const fx = Math.cos(heading) * TRUCK_HALF;
    const fz = Math.sin(heading) * TRUCK_HALF;
    return [[x - fx, z - fz], [x, z], [x + fx, z + fz]];
  }

  mayMove(t, x, z, heading, dir, speed, motion) {
    // 1. Crossings, dock areas and the back yard take one truck at a time, first come first served.
    const gap = 1.5 + speed * 0.6;
    // The end of the truck that leads (the rear when reversing), and a box ahead of it in the way we move.
    const endX = x + Math.cos(heading) * dir * TRUCK_HALF;
    const endZ = z + Math.sin(heading) * dir * TRUCK_HALF;
    const lead = [endX + Math.cos(motion) * gap, endZ + Math.sin(motion) * gap];
    const pts = [...this.bodyPoints(x, z, heading), lead];
    for (const [i, zn] of this.map.zones.entries()) {
      if (!pts.some(([px, pz]) => zn.contains(px, pz))) continue;
      const st = this.zones[i];
      if (st.holder === t.id) continue;
      // Forget trucks that stopped asking (they took another road or left).
      st.queue = st.queue.filter((q) => q.id === t.id || q.tick >= this.tick - 1);
      const mine = st.queue.find((q) => q.id === t.id);
      if (mine) mine.tick = this.tick;
      else st.queue.push({ id: t.id, tick: this.tick });
      if (st.holder !== null || st.queue[0].id !== t.id) {
        t.why = `zone ${i}`;
        return false;
      }
      // Don't block the crossing: only go in if there is room on the far side.
      if (!this.roomAfter(t, zn)) {
        t.why = `no room after zone ${i}`;
        return false;
      }
      st.holder = t.id;
      st.queue.shift();
      (t.zones ??= new Set()).add(i);
    }
    // 2. Keep a gap to every other truck in the direction we drive.
    for (const o of this.trucks) {
      if (o === t) continue;
      // A truck queued for a zone we hold stays put, so only real contact counts.
      const queued = t.zones?.size && [...t.zones].some((i) => this.zones[i].queue.some((q) => q.id === o.id));
      const hitBody = overlap(x, z, heading, 0, 0, o.x, o.z, o.heading);
      const hitAhead = !queued && overlapBox(endX + Math.cos(motion) * gap / 2, endZ + Math.sin(motion) * gap / 2, motion, gap / 2, o);
      if (!hitBody && !hitAhead) continue;
      // Already touching (rare, e.g. right after a hand-over): let them drive apart.
      if (overlap(t.x, t.z, t.heading, 0, 0, o.x, o.z, o.heading)) continue;
      t.why = `${o.name}${hitBody ? ' body' : ' ahead'}`;
      return false;
    }
    return true;
  }

  // Is there space for the truck just past a zone, along its route?
  roomAfter(t, zn) {
    let x = t.x;
    let z = t.z;
    let inside = false;
    let past = 0;
    for (let k = t.seg; k < t.path.length; k++) {
      const p = t.path[k];
      if (p.rev || p.dock) return true; // backing into a dock inside the zone
      const len = Math.hypot(p.x - x, p.z - z);
      const ux = (p.x - x) / (len || 1);
      const uz = (p.z - z) / (len || 1);
      for (let d = 1; d <= len; d += 1) {
        const px = x + ux * d;
        const pz = z + uz * d;
        if (zn.contains(px, pz)) inside = true;
        else if (inside && ++past >= TRUCK_HALF + 1) {
          const cx = px + ux * TRUCK_HALF;
          const cz = pz + uz * TRUCK_HALF;
          return !this.trucks.some((o) => o !== t && overlap(cx, cz, Math.atan2(uz, ux), 0, 0.5, o.x, o.z, o.heading));
        }
      }
      x = p.x;
      z = p.z;
    }
    return true; // the route ends inside the zone
  }

  // Give back zones the truck has fully left (or all of them).
  releaseZones(t, all = false) {
    if (!t.zones?.size) {
      if (all) for (const st of this.zones) st.queue = st.queue.filter((q) => q.id !== t.id);
      return;
    }
    const pts = this.bodyPoints(t.x, t.z, t.heading);
    const parked = t.state !== 'drive';
    for (const i of [...t.zones]) {
      if (!all && !parked && pts.some(([px, pz]) => this.map.zones[i].contains(px, pz))) continue;
      this.zones[i].holder = null;
      t.zones.delete(i);
    }
    if (all) for (const st of this.zones) st.queue = st.queue.filter((q) => q.id !== t.id);
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

// Do two trucks overlap? Truck A can be stretched forward (or backward, with a
// negative value) by `ext` metres and widened by `pad`. Uses the separating axis test.
const HALF_W = 1.3;
function overlap(ax, az, ah, ext, pad, bx, bz, bh) {
  const a = rect(ax, az, ah, TRUCK_HALF + pad, HALF_W + pad, ext);
  const b = rect(bx, bz, bh, TRUCK_HALF + 0.2, HALF_W, 0);
  for (const r of [a, b]) {
    for (const [nx, nz] of r.axes) {
      const pa = project(a.corners, nx, nz);
      const pb = project(b.corners, nx, nz);
      if (pa[1] <= pb[0] || pb[1] <= pa[0]) return false;
    }
  }
  return true;
}

// Does a box (centre, angle, half length, truck width) touch truck o?
function overlapBox(x, z, h, halfL, o) {
  const a = rect(x, z, h, halfL, HALF_W, 0);
  const b = rect(o.x, o.z, o.heading, TRUCK_HALF + 0.2, HALF_W, 0);
  for (const r of [a, b]) {
    for (const [nx, nz] of r.axes) {
      const pa = project(a.corners, nx, nz);
      const pb = project(b.corners, nx, nz);
      if (pa[1] <= pb[0] || pb[1] <= pa[0]) return false;
    }
  }
  return true;
}

function rect(x, z, h, halfL, halfW, ext) {
  const fx = Math.cos(h);
  const fz = Math.sin(h);
  const front = halfL + Math.max(0, ext);
  const back = halfL + Math.max(0, -ext);
  const corners = [[front, halfW], [front, -halfW], [-back, -halfW], [-back, halfW]].map(([l, w]) => [
    x + fx * l - fz * w,
    z + fz * l + fx * w,
  ]);
  return { corners, axes: [[fx, fz], [-fz, fx]] };
}

function project(corners, nx, nz) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, z] of corners) {
    const d = x * nx + z * nz;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
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
