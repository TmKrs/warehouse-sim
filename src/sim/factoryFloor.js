// The inside of one factory: boxes on the conveyors, forklifts and workers
// that you can watch when you zoom in. It only mirrors world.js (production,
// stock and orders stay there) and has no 3D code, so tests can run it.
//
// Everything is in the factory's own frame: u runs along the road (the hall
// spans u = -23..23), v points away from it. The hall starts at the front wall
// (v = faceV, with the dock doors) and is 24 m deep. In the layout below `w` is
// the distance from the front wall, so v = faceV + w.

const CYCLE = 7; // seconds per box on a line, as in world.js

export const FLOOR = {
  halfWidth: 23,
  depth: 24,
  lines: [19.5, 14.5], // w of each production line
  machineU: -16, // centre of each line's machine
  machineLen: 4, // along u
  machineDepth: 2.6, // along w
  beltFrom: -14, // conveyor from the machine ...
  beltTo: 4.4, // ... to the pallet at the end of the line
  endU: 5.3,
  beltY: 0.8, // top of the belt
  rows: [12, 15, 18, 21], // w of each finished-goods rack row, one per product
  slots: [12.4, 14.0, 15.6, 17.2, 18.8, 20.4], // pallet spots in a row, from the aisle
  levels: 2,
  beamY: 1.35, // top of the rack beam for the upper pallets
  box: 0.55,
  palletBoxes: 8, // 2 x 2 boxes, 2 layers
  palletH: 0.14,
  // Forklift aisles: one-way loop, so forklifts only ever follow each other.
  westLane: 7,
  eastLane: 10,
  frontLane: 3,
  crossLane: 6.5,
  backLane: 22.6,
};

const BELT_SPEED = 0.9; // metres per second
const BOX_GAP = 0.62; // spacing of boxes queued on a belt
const DRIVE = 3.6; // forklift top speed
const SAFE = 2.0; // forklift centres never get closer than this
const LOOK = 4.2; // a forklift stops when another is this close in front
const FORKLIFTS = 3;
const WALK = 1.3;

export class FactoryFloor {
  constructor(factory, rng) {
    const L = FLOOR;
    const f = (this.factory = factory);
    this.rng = rng;
    const at = (u, w, stop = null) => ({ u, v: f.faceV + w, stop });

    // Production lines: boxes on the belt and on the pallet at the end.
    this.lines = f.lines.map((line, i) => ({
      w: L.lines[i],
      belt: [], // { p, x, px }: x = metres from the machine
      pallet: [], // products waiting at the end of the line
      product: line.product,
      progress: line.progress,
      running: false,
    }));
    this.beltLen = L.beltTo - L.beltFrom;

    // Finished goods: one rack row per product. `reserved` boxes are already
    // sold to a truck and wait for a forklift to take them to the dock.
    this.rows = f.products.map((p, k) => ({ product: p, w: L.rows[k % L.rows.length], count: f.stock[p], reserved: 0 }));
    this.rowOf = new Map(this.rows.map((r) => [r.product, r]));
    this.jobs = []; // { p, dock, n }: boxes to bring to a dock
    this.seenPo = [];

    // The forklift loop: down the west aisle past the line ends, along the
    // front past the dock doors, up the east aisle past the racks.
    const docks = f.docks.map((d, i) => ({ u: d.u, i })).sort((a, b) => a.u - b.u);
    const corner = docks[0].u - 4;
    this.route = [
      at(L.westLane, L.backLane),
      ...L.lines.map((w, i) => at(L.westLane, w, { kind: 'line', i, face: Math.PI })),
      at(L.westLane, L.crossLane),
      at(corner, L.crossLane),
      at(corner, L.frontLane),
      ...docks.map((d) => at(d.u, L.frontLane, { kind: 'dock', i: d.i, face: -Math.PI / 2 })),
      at(L.eastLane, L.frontLane),
      ...this.rows.map((r, k) => ({ r, k })).sort((a, b) => a.r.w - b.r.w)
        .map(({ r, k }) => at(L.eastLane, r.w, { kind: 'row', i: k, face: 0 })),
      at(L.eastLane, L.backLane),
    ];
    // Spread the forklifts around the loop.
    this.forklifts = [];
    for (let k = 0; k < FORKLIFTS; k++) {
      const n = Math.floor((k * this.route.length) / FORKLIFTS);
      const wp = this.route[n];
      const next = this.route[(n + 1) % this.route.length];
      const heading = Math.atan2(next.v - wp.v, next.u - wp.u);
      this.forklifts.push({
        id: k, u: wp.u, v: wp.v, pu: wp.u, pv: wp.v, heading, pheading: heading,
        speed: 0, next: (n + 1) % this.route.length, state: 'drive', waited: 0,
        fork: 0.08, pfork: 0.08, forkGoal: 0.08, load: [], kind: null, dock: -1,
        face: 0, timer: 0, done: false, stop: null,
      });
    }

    // Workers: one at each machine, one checking boxes at the end of each
    // line, and two walking between the stations.
    this.workers = [];
    const person = (u, w, heading, extra) => {
      const p = { u, v: f.faceV + w, pu: 0, pv: 0, heading, pheading: heading, phase: rng.next() * 6, pphase: 0, walking: false, working: false, ...extra };
      p.pu = p.u;
      p.pv = p.v;
      p.pphase = p.phase;
      this.workers.push(p);
    };
    L.lines.forEach((w, i) => {
      person(L.machineU + 0.6, w - L.machineDepth / 2 - 0.6, Math.PI / 2, { line: i });
      person(2.6, w - 1.25, Math.PI / 2, { line: i });
    });
    const walk = (pts) => pts.map(([u, w, wait = 0]) => ({ u, v: f.faceV + w, wait }));
    person(-3, 9.6, 0, {
      route: walk([[-3, 9.6, 4], [-20.6, 9.6], [-17, 3.6, 5], [-20.6, 9.6], [-20.6, 16.6], [-7, 16.6, 4], [-20.6, 16.6], [-20.6, 9.6]]),
      next: 1, wait: 0,
    });
    person(-20.4, 22.6, 0, {
      route: walk([[-20.4, 22.6], [3, 22.6, 5], [-20.4, 22.6], [-21.4, 11.2], [-8, 11.2, 4], [-21.4, 11.2]]),
      next: 1, wait: 0,
    });
  }

  // ---------- one tick ----------
  step(dt, world) {
    this.followLines(dt);
    this.followOrders(world);
    this.reconcile();
    for (const fl of this.forklifts) this.drive(fl, dt);
    for (const p of this.workers) this.walk(p, dt);
  }

  // A line that just finished a box puts it on the belt; the belt carries
  // boxes to the pallet at its end, where they queue if the pallet is full.
  followLines(dt) {
    const f = this.factory;
    f.lines.forEach((line, i) => {
      const view = this.lines[i];
      if (line.progress < view.progress) view.belt.push({ p: view.product, x: 0, px: 0 });
      view.running = line.progress !== view.progress;
      view.progress = line.progress;
      view.product = line.product;
      let limit = this.beltLen;
      for (const b of view.belt) {
        b.px = b.x;
        b.x = Math.min(b.x + BELT_SPEED * dt, limit);
        limit = b.x - BOX_GAP;
      }
      const first = view.belt[0];
      if (first && first.x >= this.beltLen && view.pallet.length < FLOOR.palletBoxes) {
        view.belt.shift();
        view.pallet.push(first.p);
      }
    });
  }

  // How far the line's current box is, 0..1 (for the machine animation).
  lineProgress(i) {
    return Math.min(1, this.lines[i].progress / CYCLE);
  }

  // A truck started loading: its boxes leave the stock. Mark them in the racks
  // for the forklifts to bring to its dock.
  followOrders(world) {
    const f = this.factory;
    for (const po of f.orders) {
      if (po.status !== 'loading' || this.seenPo.includes(po.id)) continue;
      this.seenPo.push(po.id);
      if (this.seenPo.length > 32) this.seenPo.shift();
      const t = world?.trucks.find((x) => x.kind === 'in' && x.factory === f.id && x.id === po.truck && x.state === 'docked');
      const dock = t ? t.dock : 0;
      for (const p of po.items) {
        const row = this.rowOf.get(p);
        if (row && row.count - row.reserved > 0) {
          row.reserved++;
          const job = this.jobs.find((j) => j.p === p && j.dock === dock);
          if (job) job.n++;
          else this.jobs.push({ p, dock, n: 1 });
        } else {
          this.removeInbound(p, 1);
        }
      }
    }
  }

  // Keep the floor's count of every product equal to the factory's stock.
  reconcile() {
    const f = this.factory;
    for (const p of f.products) {
      const diff = f.stock[p] - this.stockOf(p);
      const row = this.rowOf.get(p);
      if (diff > 0 && row) row.count += diff;
      else if (diff < 0) {
        const left = this.removeInbound(p, -diff);
        if (left > 0 && row) row.count -= Math.min(left, row.count - row.reserved);
      }
    }
  }

  // Boxes of a product in the factory that are not sold yet: on belts, at the
  // line ends, on forklifts heading to the racks and in the racks.
  stockOf(p) {
    let n = 0;
    for (const view of this.lines) {
      for (const b of view.belt) if (b.p === p) n++;
      for (const q of view.pallet) if (q === p) n++;
    }
    for (const fl of this.forklifts) if (fl.kind === 'in') for (const q of fl.load) if (q === p) n++;
    const row = this.rowOf.get(p);
    if (row) n += row.count - row.reserved;
    return n;
  }

  totalStock() {
    let n = 0;
    for (const p of this.factory.products) n += this.stockOf(p);
    return n;
  }

  // Boxes standing in the racks right now (what you see there).
  storedBoxes() {
    return this.rows.reduce((a, r) => a + r.count, 0);
  }

  // Take boxes that are not in the racks yet; returns how many were missing.
  removeInbound(p, n) {
    const take = (list) => {
      for (let k = list.length - 1; k >= 0 && n > 0; k--) {
        if ((list[k].p ?? list[k]) === p) {
          list.splice(k, 1);
          n--;
        }
      }
    };
    for (const view of this.lines) take(view.pallet);
    for (const view of this.lines) take(view.belt);
    for (const fl of this.forklifts) {
      if (fl.kind !== 'in') continue;
      take(fl.load);
      if (!fl.load.length) fl.kind = null;
    }
    return n;
  }

  // ---------- forklifts ----------
  drive(fl, dt) {
    fl.pu = fl.u;
    fl.pv = fl.v;
    fl.pheading = fl.heading;
    fl.pfork = fl.fork;
    fl.fork += clamp(fl.forkGoal - fl.fork, -1.2 * dt, 1.2 * dt);
    if (fl.state === 'work') return this.work(fl, dt);

    const wp = this.route[fl.next];
    const du = wp.u - fl.u;
    const dv = wp.v - fl.v;
    const dist = Math.hypot(du, dv);
    const dirU = dist > 0 ? du / dist : Math.cos(fl.heading);
    const dirV = dist > 0 ? dv / dist : Math.sin(fl.heading);
    // Turn toward the next waypoint; sharp turns are made almost on the spot.
    const diff = angleDiff(Math.atan2(dirV, dirU), fl.heading);
    if (dist > 0.01) fl.heading = wrap(fl.heading + clamp(diff, -2.4 * dt, 2.4 * dt));
    let want = Math.abs(diff) > 0.5 ? 0.4 : DRIVE;
    if (fl.waited < 6 && this.blocked(fl, dirU, dirV)) want = 0;
    want = Math.min(want, Math.max(0.8, dist * 1.2));
    fl.speed += clamp(want - fl.speed, -4 * dt, 2 * dt);
    if (want === 0) fl.speed = 0;
    const stepLen = Math.min(fl.speed * dt, dist);
    const nu = fl.u + dirU * stepLen;
    const nv = fl.v + dirV * stepLen;
    if (stepLen > 0 && this.clear(fl, nu, nv)) {
      fl.u = nu;
      fl.v = nv;
      fl.waited = 0;
    } else {
      fl.speed = 0;
      fl.waited += dt;
    }
    fl.forkGoal = fl.load.length ? 0.3 : 0.08;
    if (Math.hypot(wp.u - fl.u, wp.v - fl.v) < 0.01) this.arrive(fl, wp);
  }

  arrive(fl, wp) {
    fl.next = (fl.next + 1) % this.route.length;
    if (!wp.stop || !this.wantsStop(fl, wp.stop)) return;
    fl.state = 'work';
    fl.stop = wp.stop;
    fl.face = wp.stop.face;
    fl.timer = 3 + fl.load.length * 0.1;
    fl.done = false;
    fl.speed = 0;
    fl.forkGoal = this.forkHeight(fl, wp.stop);
  }

  wantsStop(fl, stop) {
    if (stop.kind === 'line') {
      const view = this.lines[stop.i];
      return !fl.load.length && (view.pallet.length >= 4 || (view.pallet.length > 0 && !view.belt.length));
    }
    if (stop.kind === 'dock') return fl.kind === 'out' && fl.dock === stop.i;
    const p = this.rows[stop.i].product;
    if (fl.kind === 'in') return fl.load.includes(p);
    return this.jobFor(fl, p) !== null;
  }

  // An outbound job this forklift can take at a rack row.
  jobFor(fl, p) {
    if (fl.kind === 'in' || fl.load.length >= FLOOR.palletBoxes) return null;
    for (const j of this.jobs) if (j.p === p && j.n > 0 && (fl.kind === null || j.dock === fl.dock)) return j;
    return null;
  }

  // Forks go to the pallet's height: the floor, or the upper rack level.
  forkHeight(fl, stop) {
    if (stop.kind !== 'row') return 0.12;
    const row = this.rows[stop.i];
    const slots = FLOOR.slots.length;
    const pallet = Math.max(0, Math.ceil(row.count / FLOOR.palletBoxes) - (fl.kind === 'in' ? 0 : 1));
    return Math.floor(Math.min(pallet, slots * FLOOR.levels - 1) / slots) ? FLOOR.beamY + 0.05 : 0.12;
  }

  work(fl, dt) {
    const diff = angleDiff(fl.face, fl.heading);
    if (Math.abs(diff) > 0.01) {
      fl.heading = wrap(fl.heading + clamp(diff, -2.4 * dt, 2.4 * dt));
      return;
    }
    fl.heading = fl.face;
    fl.timer -= dt;
    if (!fl.done && fl.timer <= 1.5) {
      fl.done = true;
      this.transfer(fl, fl.stop);
      fl.forkGoal = fl.load.length ? 0.3 : 0.08;
    }
    if (fl.timer <= 0) {
      fl.state = 'drive';
      fl.stop = null;
    }
  }

  // Hand boxes over at a station.
  transfer(fl, stop) {
    if (stop.kind === 'line') {
      const view = this.lines[stop.i];
      fl.load = view.pallet;
      view.pallet = [];
      fl.kind = fl.load.length ? 'in' : null;
      return;
    }
    if (stop.kind === 'dock') {
      // The boxes go into the truck (or wait by the door if it already left).
      fl.load.length = 0;
      fl.kind = null;
      fl.dock = -1;
      return;
    }
    const row = this.rows[stop.i];
    const p = row.product;
    if (fl.kind === 'in') {
      const before = fl.load.length;
      fl.load = fl.load.filter((q) => q !== p);
      row.count += before - fl.load.length;
      if (!fl.load.length) fl.kind = null;
    }
    let job = this.jobFor(fl, p);
    while (job) {
      const n = Math.min(job.n, FLOOR.palletBoxes - fl.load.length, row.reserved);
      if (n <= 0) break;
      job.n -= n;
      row.reserved -= n;
      row.count -= n;
      for (let k = 0; k < n; k++) fl.load.push(p);
      fl.kind = 'out';
      fl.dock = job.dock;
      job = this.jobFor(fl, p);
    }
    this.jobs = this.jobs.filter((j) => j.n > 0);
  }

  // Is another forklift right in front of us?
  blocked(fl, dirU, dirV) {
    for (const o of this.forklifts) {
      if (o === fl) continue;
      const ru = o.u - fl.u;
      const rv = o.v - fl.v;
      const along = ru * dirU + rv * dirV;
      if (along > 0 && along < LOOK && Math.abs(ru * dirV - rv * dirU) < 1.6) return true;
    }
    return false;
  }

  // Never move closer than SAFE to another forklift.
  clear(fl, nu, nv) {
    for (const o of this.forklifts) {
      if (o === fl) continue;
      const d = Math.hypot(nu - o.u, nv - o.v);
      if (d < SAFE && d < Math.hypot(fl.u - o.u, fl.v - o.v)) return false;
    }
    return true;
  }

  // ---------- workers ----------
  walk(p, dt) {
    p.pu = p.u;
    p.pv = p.v;
    p.pheading = p.heading;
    p.pphase = p.phase;
    if (!p.route) {
      // Standing at a station: busy hands while the line runs.
      p.working = this.lines[p.line].running;
      p.phase += dt * (p.working ? 4 : 1);
      return;
    }
    if (p.wait > 0) {
      p.wait -= dt;
      p.walking = false;
      p.working = true;
      p.phase += dt * 2;
      return;
    }
    const wp = p.route[p.next];
    const du = wp.u - p.u;
    const dv = wp.v - p.v;
    const dist = Math.hypot(du, dv);
    p.walking = true;
    p.working = false;
    if (dist > 0.01) p.heading = wrap(p.heading + clamp(angleDiff(Math.atan2(dv, du), p.heading), -6 * dt, 6 * dt));
    const stepLen = Math.min(WALK * dt, dist);
    if (dist > 0) {
      p.u += (du / dist) * stepLen;
      p.v += (dv / dist) * stepLen;
    }
    p.phase += stepLen * 3.2;
    if (dist - stepLen < 0.01) {
      if (wp.wait) p.wait = wp.wait + this.rng.next() * 2;
      p.next = (p.next + 1) % p.route.length;
    }
  }
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function angleDiff(a, b) {
  return wrap(a - b);
}
