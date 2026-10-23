// The warehouse brain: trucks, stock, orders and robots.
// It has no 3D code at all, so it can also run in tests without a browser.

import { buildLayout, CELL, ROW_NAMES } from './layout.js';
import { Planner } from './pathfinding.js';
import { makeRng } from './random.js';

export const TICK = 0.3; // warehouse seconds per robot step (one cell)

export const DEFAULT_SETTINGS = {
  robots: 10,
  truckEverySeconds: 45,
  ordersPerMinute: 6,
  targetFill: 0.8, // purchasing aims to keep the warehouse about this full
  seed: 7,
  // In the supply chain the world sends trucks and store orders, so the
  // warehouse does not make up its own.
  chain: false,
  lanes: 2,
};

const PRODUCT_NAMES = [
  'Sneakers', 'Headphones', 'Coffee beans', 'Books', 'Desk lamps', 'Toy cars',
  'Power tools', 'House plants', 'Kettles', 'Jackets', 'Monitors', 'Board games',
];
export const SIZES = ['S', 'M', 'L'];

const DOCK_BUFFER = 6; // boxes a dock can hold on the floor while unloading
const UNLOAD_SECONDS = 1.1; // one box off the truck
const TRUCK_MOVE_SECONDS = 6; // driving in or out of a dock
const LOAD_TICKS = 3;
const DROP_TICKS = 3;

export class Sim {
  constructor(settings = {}) {
    this.reset(settings);
  }

  reset(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    const rng = (this.rng = makeRng(this.settings.seed));
    const L = (this.layout = buildLayout({ lanes: this.settings.lanes }));
    this.planner = new Planner(L);
    this.tick = 0;
    this.slots = L.slots;
    for (const s of this.slots) {
      s.boxId = null;
      s.reservedFor = null;
    }

    // Products: random colours and sizes, some much more popular than others.
    const hueStart = rng.next();
    this.products = PRODUCT_NAMES.map((name, i) => ({
      id: i,
      name,
      hue: (hueStart + i * 0.618034) % 1,
      sat: rng.range(0.6, 0.85),
      light: rng.range(0.42, 0.55),
      size: rng.int(0, 2),
      popularity: 1 / (1 + i * rng.range(0.3, 0.7)),
    }));
    const popSum = this.products.reduce((s, p) => s + p.popularity, 0);
    for (const p of this.products) p.share = p.popularity / popSum;

    this.boxes = new Map();
    this.nextBoxId = 1;
    this.trucks = [];
    this.nextTruckId = 1;
    this.nextTruckPlanAt = 0;
    this.docks = L.docks.map((d) => ({ ...d, truck: null, buffer: [] }));
    this.yard = []; // trucks that arrived but have no free dock yet
    this.orders = [];
    this.nextOrderId = 1;
    this.nextOrderAt = 75;
    this.claims = new Map(); // cell -> robot id (a robot will stand there for its task)
    this.events = [];
    this.shippedBoxes = []; // recently shipped, for the conveyor animation
    // Boxes waiting at each shipping lane for the truck to the store.
    this.lanes = L.ships.map((s) => ({ id: s.id, buffer: [] }));
    this.stats = {
      boxesIn: 0, boxesOut: 0, ordersOnTime: 0, ordersLate: 0,
      trucksDone: 0, trucksLate: 0, dwellSum: 0, dwellCount: 0,
      waitTicks: 0, moveTicks: 0,
    };

    this.robots = [];
    const parkOrder = [...L.parking].sort((a, b) => L.zOf(a) - L.zOf(b));
    for (let i = 0; i < this.settings.robots && i < parkOrder.length; i++) {
      const cell = parkOrder[i];
      const r = {
        id: i, name: `R${String(i + 1).padStart(2, '0')}`,
        cell, prev: cell, mode: 'idle', task: null, plan: null,
        retryAt: 0, actStart: 0, actUntil: 0, carrying: null, heading: L.xOf(cell) === 0 ? 0 : Math.PI,
        tasksDone: 0,
      };
      this.claims.set(cell, r.id);
      r.task = { type: 'park', steps: [{ goal: cell }], i: 1, claims: [cell] };
      this.planner.commit(r.id, [cell], 0);
      this.robots.push(r);
    }
    this.log('Warehouse opened. Shelves are empty, the first trucks are on their way.');
  }

  get time() {
    return this.tick * TICK;
  }

  log(text, kind = 'info') {
    this.events.push({ time: this.time, text, kind });
    if (this.events.length > 80) this.events.shift();
  }

  // ---------- one step of the whole warehouse ----------
  step() {
    this.tick++;
    const now = this.time;
    if (!this.settings.chain) {
      this.planTrucks(now);
      this.makeOrders(now);
    }
    this.updateTrucks(now);
    this.moveRobots();
    this.dispatch();
    this.planRoutes();
    if (this.tick % 40 === 0) this.planner.forgetBefore(this.tick - 2);
    this.shippedBoxes = this.shippedBoxes.filter((b) => now - b.time < 6);
  }

  // ---------- stock ----------
  get capacity() {
    return this.slots.length;
  }

  get stored() {
    let n = 0;
    for (const s of this.slots) if (s.boxId !== null) n++;
    return n;
  }

  rowFill() {
    const rows = this.layout.rows.map((r) => ({ name: r.name, levels: r.levels, capacity: r.capacity, filled: 0 }));
    for (const s of this.slots) if (s.boxId !== null) rows[s.row].filled++;
    return rows;
  }

  // How many boxes of each product we have or will have soon, minus what customers are waiting for.
  stockPosition() {
    const pos = this.products.map(() => 0);
    for (const b of this.boxes.values()) {
      if (b.state !== 'shipped' && !b.order) pos[b.product]++;
    }
    for (const t of this.trucks) {
      if (t.status === 'planned' || t.status === 'yard' || t.status === 'docking') {
        for (const p of t.load) pos[p]++;
      } else if (t.status === 'unloading') {
        for (const p of t.load.slice(t.unloaded)) pos[p]++;
      }
    }
    for (const o of this.orders) {
      if (o.status !== 'open') continue;
      for (const line of o.lines) if (line.state === 'backorder') pos[line.product]--;
    }
    return pos;
  }

  // ---------- trucks ----------
  // Purchasing: every few minutes we order a truck load for the products we are short of.
  planTrucks(now) {
    if (now < this.nextTruckPlanAt) return;
    const rng = this.rng;
    const first = this.nextTruckId <= 3;
    this.nextTruckPlanAt = now + this.settings.truckEverySeconds * rng.range(0.8, 1.2);

    const target = this.settings.targetFill * this.capacity;
    const pos = this.stockPosition();
    const totalPos = pos.reduce((s, x) => s + Math.max(0, x), 0);
    let room = Math.floor(target - totalPos);
    const backorders = pos.reduce((s, x) => s + Math.max(0, -x), 0);
    room = Math.max(room, backorders);
    const size = Math.min(rng.int(12, 20), room);
    if (size < 4) return;

    const deficits = this.products.map((p) => p.share * target - pos[p.id]);
    const load = [];
    for (let k = 0; k < size; k++) {
      let best = 0;
      for (let i = 1; i < deficits.length; i++) if (deficits[i] > deficits[best]) best = i;
      load.push(best);
      deficits[best] -= 1 + rng.next() * 0.5;
    }

    // Planned arrival, and the real one: some trucks are late, a few are early.
    const lead = first ? 4 + (this.nextTruckId - 1) * 8 : rng.range(70, 110);
    const planned = now + lead;
    const roll = rng.next();
    let delay = rng.range(-10, 12);
    if (!first && roll < 0.3) delay = rng.range(45, 240);
    else if (!first && roll < 0.4) delay = -rng.range(15, 40);
    const truck = {
      id: this.nextTruckId++,
      planned,
      arrival: Math.max(now + 2, planned + delay),
      load,
      unloaded: 0,
      status: 'planned',
      dock: null,
      statusSince: now,
      color: rng.pick([0xd9dde3, 0xe9eef2, 0xc7ccd3, 0xf2f2ee]),
    };
    truck.name = `T-${String(truck.id).padStart(3, '0')}`;
    this.trucks.push(truck);
  }

  updateTrucks(now) {
    const Y = this.yardPlan; // the parking lot and its routes (supply chain only)
    for (const t of this.trucks) {
      if (t.status === 'planned' && now >= t.arrival) {
        t.status = 'yard';
        t.statusSince = now;
        t.late = t.arrival - t.planned > 60;
        if (t.late) this.stats.trucksLate++;
        const diff = Math.round((t.arrival - t.planned) / 60);
        const note = t.late ? `${diff} min late` : t.arrival < t.planned - 10 ? 'early' : 'on time';
        this.log(`${t.name} arrived ${note} with ${t.load.length} boxes.`, t.late ? 'warn' : 'info');
        if (Y) {
          t.stall = this.freeStall();
          t.moveTime = Y.park(t.stall).time;
          this.lastParker = t;
        }
        this.yard.push(t);
      }
    }
    // Parked trucks take the next free dock, one manoeuvre at a time.
    for (const d of this.docks) {
      if (d.truck || !this.yard.length) continue;
      const i = Y ? this.yard.findIndex((t) => now - t.statusSince >= t.moveTime) : 0;
      if (i < 0 || (Y && !this.mayDock(d, now))) continue;
      const t = this.yard.splice(i, 1)[0];
      d.truck = t;
      t.dock = d.id;
      t.status = 'docking';
      t.statusSince = now;
      if (Y) {
        const r = Y.dock(t.stall, d.id);
        t.moveTime = r.time;
        t.clearAt = now + r.clear;
      } else t.moveTime = TRUCK_MOVE_SECONDS;
    }
    for (const d of this.docks) {
      const t = d.truck;
      if (!t) continue;
      if (t.status === 'docking' && now - t.statusSince >= t.moveTime) {
        t.status = 'unloading';
        t.statusSince = now;
        t.nextUnload = now;
      }
      if (t.status === 'unloading') {
        if (t.unloaded < t.load.length && d.buffer.length < DOCK_BUFFER && now >= t.nextUnload) {
          const product = t.load[t.unloaded++];
          const box = this.makeBox(product, t);
          box.state = 'dock';
          box.dock = d.id;
          d.buffer.push(box.id);
          t.nextUnload = now + UNLOAD_SECONDS;
        }
        if (t.unloaded >= t.load.length && (!Y || this.mayLeave(d))) {
          t.status = 'leaving';
          t.statusSince = now;
          t.moveTime = Y ? Y.leave(d.id).time : TRUCK_MOVE_SECONDS;
        }
      }
      if (t.status === 'leaving' && now - t.statusSince >= t.moveTime) {
        t.status = 'gone';
        t.statusSince = now;
        d.truck = null;
        this.stats.trucksDone++;
        this.onTruckGone?.(t);
      }
    }
    if (this.trucks.length > 60) this.trucks = this.trucks.filter((t) => t.status !== 'gone' || now - t.statusSince < 120);
  }

  // ---------- truck yard (supply chain) ----------
  // Stalls taken by trucks that are parked, pulling in, or still pulling out.
  freeStall() {
    const used = new Set();
    for (const t of this.trucks) if (t.status === 'yard' || t.status === 'docking') used.add(t.stall);
    for (let i = 0; i < this.yardPlan.stallX.length; i++) if (!used.has(i)) return i;
    return -1;
  }

  // Can a truck at the gate drive in? Needs a free stall and the entry lane clear.
  yardOpen() {
    if (!this.yardPlan) return true;
    if (this.trucks.some((t) => t.status === 'planned')) return false;
    const last = this.lastParker;
    if (last && last.status === 'yard' && this.time - last.statusSince < last.moveTime) return false;
    return this.freeStall() >= 0;
  }

  // A truck may start for dock d when no other truck is still swinging round,
  // and no truck is leaving from a dock to the west (it would cross d's lane).
  mayDock(d, now) {
    for (const o of this.docks) {
      const t = o.truck;
      if (!t) continue;
      if (t.status === 'docking' && now < t.clearAt) return false;
      if (t.status === 'leaving' && o.x < d.x) return false;
    }
    return true;
  }

  // A truck may leave dock d when nobody is backing up to a dock east of it,
  // and the exit is free (the empty truck waits there until it can join the road).
  mayLeave(d) {
    if (this.exitBusy?.()) return false;
    for (const o of this.docks) if (o.truck && o.truck.status === 'docking' && o.x > d.x) return false;
    for (const o of this.docks) if (o !== d && o.truck && o.truck.status === 'leaving') return false;
    return true;
  }

  // A truck from a factory reached the warehouse gate (supply chain mode).
  receiveTruck({ name, load, planned, color, from }) {
    const now = this.time;
    const truck = {
      id: this.nextTruckId++, name, planned, arrival: now, load, unloaded: 0,
      status: 'planned', dock: null, statusSince: now, color, from,
    };
    this.trucks.push(truck);
    return truck;
  }

  // A store asks for boxes (supply chain mode). Returns the order.
  addOrder(store, products, dueIn) {
    const now = this.time;
    const order = {
      id: this.nextOrderId++, created: now, due: now + dueIn, lines: [], status: 'open', ship: store,
    };
    order.name = `#${1000 + order.id}`;
    for (const product of products) {
      const line = { product, box: null, state: 'backorder' };
      order.lines.push(line);
      this.reserveForLine(order, line);
    }
    this.orders.push(order);
    const missing = order.lines.filter((l) => l.state === 'backorder').length;
    if (missing) this.log(`Order ${order.name}: ${missing} item(s) not in stock, waiting for a truck.`, 'warn');
    if (this.orders.length > 400) this.orders = this.orders.filter((o) => o.status === 'open' || now - o.closed < 300);
    return order;
  }

  makeBox(product, truck) {
    const rng = this.rng;
    const p = this.products[product];
    const box = {
      id: this.nextBoxId++,
      product,
      size: p.size,
      // Each box varies a little, so not all boxes of a product look identical.
      scale: [rng.range(0.88, 1.08), rng.range(0.85, 1.1), rng.range(0.88, 1.08)],
      truck: truck.name,
      arrivedAt: this.time,
      storedAt: null,
      state: 'truck',
      slot: null,
      order: null,
      dock: null,
    };
    this.boxes.set(box.id, box);
    this.stats.boxesIn++;
    return box;
  }

  // ---------- orders ----------
  makeOrders(now) {
    if (now < this.nextOrderAt) return;
    const rng = this.rng;
    this.nextOrderAt = now + rng.exp(this.settings.ordersPerMinute / 60);
    const lineCount = 1 + rng.weighted([0.5, 0.35, 0.15]);
    const order = {
      id: this.nextOrderId++,
      created: now,
      due: now + rng.range(150, 330),
      lines: [],
      status: 'open',
      ship: rng.int(0, 1),
    };
    order.name = `#${1000 + order.id}`;
    for (let k = 0; k < lineCount; k++) {
      const product = rng.weighted(this.products.map((p) => p.share));
      const line = { product, box: null, state: 'backorder' };
      order.lines.push(line);
      this.reserveForLine(order, line);
    }
    this.orders.push(order);
    const missing = order.lines.filter((l) => l.state === 'backorder').length;
    if (missing) this.log(`Order ${order.name}: ${missing} item(s) not in stock, waiting for a truck.`, 'warn');
    if (this.orders.length > 400) this.orders = this.orders.filter((o) => o.status === 'open' || now - o.closed < 300);
  }

  // Take the oldest stored box of the product for this order line (first in, first out).
  reserveForLine(order, line) {
    let best = null;
    for (const s of this.slots) {
      if (s.boxId === null) continue;
      const b = this.boxes.get(s.boxId);
      if (b.product !== line.product || b.order || b.state !== 'stored') continue;
      if (!best || b.storedAt < best.storedAt) best = b;
    }
    if (!best) return false;
    best.order = order.id;
    line.box = best.id;
    line.state = 'reserved';
    return true;
  }

  // A box just went onto a shelf: does a waiting order need it?
  serveBackorders(box) {
    for (const o of this.orders) {
      if (o.status !== 'open') continue;
      for (const line of o.lines) {
        if (line.state === 'backorder' && line.product === box.product) {
          box.order = o.id;
          line.box = box.id;
          line.state = 'reserved';
          return;
        }
      }
    }
  }

  // ---------- robots ----------
  moveRobots() {
    const t = this.tick;
    for (const r of this.robots) {
      r.prev = r.cell;
      if (r.mode === 'travel') {
        const k = Math.min(t - r.plan.t0, r.plan.cells.length - 1);
        r.cell = r.plan.cells[k];
        if (r.cell !== r.prev) {
          const L = this.layout;
          r.heading = Math.atan2(L.zOf(r.cell) - L.zOf(r.prev), L.xOf(r.cell) - L.xOf(r.prev));
          this.stats.moveTicks++;
        } else if (k < r.plan.cells.length - 1) {
          this.stats.waitTicks++;
        }
        if (k >= r.plan.cells.length - 1) {
          r.plan = null;
          if (r.replan) {
            // Got a new job while driving to park; plan it from here.
            r.replan = false;
            r.mode = 'plan';
            r.retryAt = t;
          } else {
            this.arrive(r);
          }
        }
      } else if (r.mode === 'act' && t >= r.actUntil) {
        this.finishAction(r);
      }
    }
  }

  arrive(r) {
    const step = r.task.steps[r.task.i];
    if (step.action) {
      r.mode = 'act';
      r.actStart = this.tick;
      r.actUntil = this.tick + step.action.ticks;
      r.action = step.action;
      if (step.action.side) r.heading = step.action.side > 0 ? 0 : Math.PI;
    } else {
      this.nextStep(r);
    }
  }

  finishAction(r) {
    const a = r.action;
    const now = this.time;
    if (a.kind === 'load') {
      const d = this.docks[a.dock];
      d.buffer = d.buffer.filter((id) => id !== a.box);
      const box = this.boxes.get(a.box);
      box.state = 'carried';
      r.carrying = box.id;
    } else if (a.kind === 'store') {
      const box = this.boxes.get(a.box);
      const slot = this.slots[a.slot];
      slot.boxId = box.id;
      slot.reservedFor = null;
      box.slot = slot.id;
      box.state = 'stored';
      box.storedAt = now;
      r.carrying = null;
      this.serveBackorders(box);
    } else if (a.kind === 'pickup') {
      const box = this.boxes.get(a.box);
      const slot = this.slots[box.slot];
      slot.boxId = null;
      box.slot = null;
      box.state = 'carried';
      r.carrying = box.id;
      this.stats.dwellSum += now - box.storedAt;
      this.stats.dwellCount++;
    } else if (a.kind === 'drop') {
      const box = this.boxes.get(a.box);
      box.state = 'shipped';
      r.carrying = null;
      this.boxes.delete(box.id);
      this.stats.boxesOut++;
      this.shippedBoxes.push({ box, cell: r.cell, time: now });
      const order = this.orders.find((o) => o.id === box.order);
      if (this.settings.chain) this.lanes[order.ship].buffer.push(box);
      const line = order.lines.find((l) => l.box === box.id);
      line.state = 'shipped';
      if (order.lines.every((l) => l.state === 'shipped')) {
        order.status = 'shipped';
        order.closed = now;
        const late = now > order.due;
        order.late = late;
        if (late) {
          this.stats.ordersLate++;
          this.log(`Order ${order.name} shipped ${Math.ceil((now - order.due) / 60)} min late.`, 'warn');
        } else {
          this.stats.ordersOnTime++;
        }
      }
    }
    r.action = null;
    this.nextStep(r);
  }

  nextStep(r) {
    const task = r.task;
    task.i++;
    if (task.i < task.steps.length) {
      r.mode = 'plan';
      r.retryAt = this.tick;
      return;
    }
    // Task finished: free the cells it had claimed (except the one we stand on if parking).
    for (const c of task.claims) {
      if (task.type === 'park' && c === r.cell) continue;
      if (this.claims.get(c) === r.id) this.claims.delete(c);
    }
    if (task.type === 'park') {
      r.mode = 'idle';
    } else {
      r.tasksDone++;
      r.task = null;
      r.mode = 'free';
    }
  }

  // Can this robot be given a new job right now?
  available(r) {
    return r.mode === 'free' || r.mode === 'idle' || (r.task && r.task.type === 'park' && !r.replan && (r.mode === 'travel' || r.mode === 'plan'));
  }

  // ---------- dispatcher: who does which job ----------
  dispatch() {
    const free = this.robots.filter((r) => this.available(r));
    if (!free.length) return;
    const jobs = this.findJobs();
    const P = this.planner;
    // Greedy: repeatedly give the best (robot, job) pair.
    while (free.length && jobs.length) {
      let best = null;
      for (const job of jobs) {
        const d = P.dist(job.firstGoal);
        for (const r of free) {
          const score = d[r.cell] - job.urgency;
          if (!best || score < best.score) best = { score, job, r };
        }
      }
      const { job, r } = best;
      if (!this.claimJob(job, r)) {
        jobs.splice(jobs.indexOf(job), 1);
        continue;
      }
      this.giveTask(r, job.make());
      free.splice(free.indexOf(r), 1);
      jobs.splice(jobs.indexOf(job), 1);
    }
    // Robots with nothing to do drive to a parking spot.
    for (const r of free) {
      if (r.mode === 'free') this.sendToPark(r);
    }
  }

  findJobs() {
    const jobs = [];
    const now = this.time;
    // Put-away jobs: the next box on each dock floor.
    for (const d of this.docks) {
      const boxId = d.buffer.find((id) => !this.boxes.get(id).assigned);
      if (boxId === undefined) continue;
      const cell = d.cells.find((c) => !this.claims.has(c));
      if (cell === undefined) continue;
      const box = this.boxes.get(boxId);
      const waiting = d.truck && d.truck.status === 'unloading' && d.buffer.length >= DOCK_BUFFER;
      jobs.push({
        kind: 'put',
        firstGoal: cell,
        urgency: 4 + d.buffer.length * 3 + (waiting ? 12 : 0) + this.yard.length * 6,
        box, dock: d, cell,
      });
    }
    // Picking jobs: order lines whose box is on a shelf.
    const picks = [];
    for (const o of this.orders) {
      if (o.status !== 'open') continue;
      for (const line of o.lines) {
        if (line.state !== 'reserved') continue;
        const box = this.boxes.get(line.box);
        if (box.state !== 'stored') continue;
        const slot = this.slots[box.slot];
        if (this.claims.has(slot.access)) continue;
        const left = (o.due - now) / (o.due - o.created);
        picks.push({
          kind: 'pick',
          firstGoal: slot.access,
          urgency: 6 + 20 * (1 - Math.max(0, left)) + (left < 0 ? 15 : 0),
          box, order: o, line, slot,
        });
      }
    }
    picks.sort((a, b) => b.urgency - a.urgency);
    jobs.push(...picks.slice(0, 12));
    return jobs;
  }

  // Reserve the cells a job needs; returns false if something is already taken.
  claimJob(job, r) {
    const take = (cells) => {
      if (cells.some((c) => this.claims.has(c) && this.claims.get(c) !== r.id)) return false;
      return true;
    };
    if (job.kind === 'put') {
      if (this.claims.has(job.cell)) return false;
      const slot = this.chooseSlot(job.box);
      if (!slot) return false;
      if (!take([job.cell, slot.access])) return false;
      job.make = () => {
        job.box.assigned = true;
        slot.reservedFor = job.box.id;
        const lift = 2 + slot.level * 2;
        return {
          type: 'put',
          box: job.box.id,
          claims: [job.cell, slot.access],
          steps: [
            { goal: job.cell, action: { kind: 'load', ticks: LOAD_TICKS, box: job.box.id, dock: job.dock.id } },
            { goal: slot.access, action: { kind: 'store', ticks: lift * 2, box: job.box.id, slot: slot.id, level: slot.level, side: slot.side } },
          ],
        };
      };
    } else {
      const shipCell = this.chooseShipCell(job.order, job.slot.access);
      if (shipCell === undefined) return false;
      if (!take([job.slot.access, shipCell])) return false;
      job.make = () => {
        job.line.state = 'assigned';
        const lift = 2 + job.slot.level * 2;
        return {
          type: 'pick',
          box: job.box.id,
          order: job.order.id,
          claims: [job.slot.access, shipCell],
          steps: [
            { goal: job.slot.access, action: { kind: 'pickup', ticks: lift * 2, box: job.box.id, slot: job.slot.id, level: job.slot.level, side: job.slot.side } },
            { goal: shipCell, action: { kind: 'drop', ticks: DROP_TICKS, box: job.box.id } },
          ],
        };
      };
    }
    return true;
  }

  // Smart storage: popular products close to shipping and low on the rack,
  // rare products further away and higher up.
  chooseSlot(box) {
    const p = this.products[box.product];
    const pop = p.share * this.products.length; // ~1 = average
    const shipDist = this.shipDistance();
    let best = null;
    let bestScore = Infinity;
    for (const s of this.slots) {
      if (s.boxId !== null || s.reservedFor !== null) continue;
      if (this.claims.has(s.access)) continue;
      const d = shipDist[s.access];
      const score = d * pop + s.level * (1.5 + pop) + (box.size === 2 ? s.level * 2 : 0) + this.rng.next() * 3;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  shipDistance() {
    if (this._shipDist) return this._shipDist;
    const P = this.planner;
    const N = this.layout.N;
    const out = new Float32Array(N).fill(1e9);
    for (const st of this.layout.ships) {
      for (const c of st.cells) {
        const d = P.dist(c);
        for (let i = 0; i < N; i++) out[i] = Math.min(out[i], d[i]);
      }
    }
    return (this._shipDist = out);
  }

  chooseShipCell(order, from) {
    const P = this.planner;
    const station = this.layout.ships[order.ship];
    let best;
    let bestD = Infinity;
    for (const c of station.cells) {
      if (this.claims.has(c)) continue;
      const d = P.dist(c)[from];
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  giveTask(r, task) {
    if (r.task && r.task.type === 'park') {
      for (const c of r.task.claims) if (this.claims.get(c) === r.id) this.claims.delete(c);
    }
    for (const c of task.claims) this.claims.set(c, r.id);
    task.i = 0;
    r.task = task;
    r.retryAt = this.tick;
    // A robot driving to park keeps driving until its new route is booked.
    if (r.mode === 'travel') r.replan = true;
    else r.mode = 'plan';
  }

  sendToPark(r) {
    const P = this.planner;
    let best;
    let bestD = Infinity;
    for (const c of this.layout.parking) {
      if (this.claims.has(c)) continue;
      const d = P.dist(c)[r.cell];
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best === undefined) return;
    this.claims.set(best, r.id);
    r.task = { type: 'park', steps: [{ goal: best }], i: 0, claims: [best] };
    r.mode = 'plan';
    r.retryAt = this.tick;
  }

  // Robots that need a route get one from the traffic planner.
  planRoutes() {
    const t = this.tick;
    for (const r of this.robots) {
      if (!(r.mode === 'plan' || r.replan) || t < r.retryAt) continue;
      const goal = r.task.steps[r.task.i].goal;
      const cells = this.planner.plan(r.id, r.cell, t, goal);
      if (!cells) {
        r.retryAt = t + 2 + Math.floor(this.rng.next() * 4);
        r.blockedSince ??= t;
        // Stuck for a while? Step aside so the robot blocking us can move.
        if (r.mode === 'plan' && t - r.blockedSince > 25 && !r.task.steps[r.task.i].sidestep) {
          const side = this.findSidestep(r);
          if (side !== undefined) {
            r.task.steps.splice(r.task.i, 0, { goal: side, sidestep: true });
            r.blockedSince = undefined;
            r.retryAt = t;
          }
        }
        continue;
      }
      r.blockedSince = undefined;
      r.replan = false;
      this.planner.release(r.id, t);
      this.planner.commit(r.id, cells, t);
      r.plan = { t0: t, cells };
      r.mode = 'travel';
    }
  }

  // A nearby plain floor cell that nobody needs right now.
  findSidestep(r) {
    const L = this.layout;
    const P = this.planner;
    const seen = new Set([r.cell]);
    let frontier = [r.cell];
    for (let depth = 0; depth < 6; depth++) {
      const next = [];
      for (const c of frontier) {
        for (const n of P.neighbors[c]) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
          if (L.type[n] === CELL.FLOOR && !this.claims.has(n) && P.holder[n] === -1 && this.rng.next() < 0.6) return n;
        }
      }
      frontier = next;
    }
    return undefined;
  }

  // ---------- numbers for the screens ----------
  summary() {
    const open = this.orders.filter((o) => o.status === 'open');
    const now = this.time;
    let oldest = 0;
    for (const b of this.boxes.values()) if (b.state === 'stored') oldest = Math.max(oldest, now - b.storedAt);
    return {
      time: now,
      stored: this.stored,
      capacity: this.capacity,
      rows: this.rowFill(),
      openOrders: open.length,
      overdueOrders: open.filter((o) => now > o.due).length,
      backorderLines: open.reduce((s, o) => s + o.lines.filter((l) => l.state === 'backorder').length, 0),
      trucksWaiting: this.yard.length,
      trucksAtDock: this.docks.filter((d) => d.truck).length,
      onDocks: this.docks.reduce((s, d) => s + d.buffer.length, 0),
      busyRobots: this.robots.filter((r) => r.task && r.task.type !== 'park').length,
      avgDwell: this.stats.dwellCount ? this.stats.dwellSum / this.stats.dwellCount : 0,
      oldestBox: oldest,
      ...this.stats,
    };
  }

  // Next trucks for the arrivals board.
  arrivals() {
    return this.trucks
      .filter((t) => t.status !== 'gone')
      .sort((a, b) => a.planned - b.planned)
      .slice(0, 6);
  }

  rowName(i) {
    return ROW_NAMES[i];
  }
}
