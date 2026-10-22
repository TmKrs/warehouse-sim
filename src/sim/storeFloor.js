// The inside of one store: shelves that show what the store has in stock,
// customers who walk in from the car park, shop, queue and pay, cashiers at
// the tills, and staff who carry delivered boxes from the back room to the
// shelves. It only mirrors world.js (sales, stock and deliveries stay there)
// and has no 3D code, so tests can run it.
//
// Everything is in the store's own frame: u runs along the road (the building
// spans u = -19..19), v points away from it. The building starts at the
// delivery wall (v = faceV, facing the road) and is 22 m deep; the shop front
// at the far end faces the customers' car park. In the layout below `w` is the
// distance from the delivery wall, so v = faceV + w.

export const STORE = {
  halfWidth: 19,
  depth: 22,
  backWall: 5.4, // w of the wall between the back room and the shop
  staffDoorU: -8, // opening in that wall, in line with the delivery door
  staffDoorWidth: 2.4,
  // Shelves: double-sided gondolas running from the back aisle to the front
  // aisle, with two steps on each side so you can see every box from above.
  gondolas: [-13, -8, -3],
  gondolaHalf: 0.8,
  shelfFrom: 8.2,
  shelfTo: 13.0,
  bayLen: 2.4, // one bay per product, two bays on each side of a gondola
  aisles: [-16.2, -10.5, -5.5, -0.6], // u of the aisle centres
  backAisle: 6.8,
  frontAisle: 14.4,
  box: 0.34, // product boxes on the shelves
  tiers: [{ y: 0.3, d: 0.62 }, { y: 0.75, d: 0.27 }], // step top and box distance from the middle
  perLevel: 5,
  // Checkouts near the shop front; customers pay on the right of each counter.
  tills: [3, 7.5, 12],
  counterFrom: 16.8,
  counterTo: 19.2,
  laneOffset: 0.85, // customer lane, right of the counter
  cashierOffset: -0.85, // cashier, left of the counter
  payW: 18.0,
  queueW: 16.2, // first waiting spot, then every 0.8 m further back
  afterTill: 20.6,
  // Doors in the shop front: in on the left, out past the tills on the right.
  entranceU: -10.5,
  exitU: 15.5,
  doorWidth: 3,
  // Decoration that people walk around: fruit stands and wall fridges.
  produce: [6.1, 10.6, 15.1],
  produceFrom: 9.0,
  produceTo: 11.4,
  corridor: 7.6, // w of the walkway between the fridges and the fruit stands
  fridgeFrom: 1.5,
  fridgeTo: 18.5,
  fridgeDepth: 0.8,
  wallShelf: [6.0, 18.8], // goods along the left wall, from and to w
  promos: [[-13.6, 17.4], [-5.4, 17.6]], // special-offer islands near the front, 1.6 m square
  // Back room: pallets for delivered boxes either side of the delivery door.
  pallets: [[-10.4, 2.0], [-5.6, 2.0], [-12.8, 2.0], [-3.2, 2.0]],
  palletBoxes: 16, // 2 x 2 boxes, 4 layers
  // Outside: pavement along the shop front and two rows of parking.
  sidewalk: 24,
  rows: [31, 41],
  lotLane: 36,
  carSlots: [-21.5, -18.5, -15.5, -5.5, -2.5, 0.5, 3.5, 6.5, 9.5, 12.5, 18.5, 21.5],
};

const L = STORE;
const MAX_CUSTOMERS = 25; // people drawn in one store at most
const CARRY = 4; // boxes a member of staff carries at once
const KEEP_RIGHT = 0.35; // people walk this far right of a path, so two directions pass
const SHIFT_START = 7.75; // cashiers come in a quarter of an hour early
const OPEN = 8;
const CLOSE = 20;
const STAFF = 2;
const CASHIER_ROOM = [15, 2.8];
const IDLE = [[-16.8, 2.2], [1.8, 2.6]];
const PICKUP = [[-9.0, 3.6], [-7.0, 3.6]];
const RECEIVE = [-8, 1.5];

export const SHIRTS = [0x1e3a8a, 0xb91c1c, 0x15803d, 0xeab308, 0xf8fafc, 0x6b7280, 0xea580c, 0x7c3aed, 0x0d9488, 0xdb2777, 0x0ea5e9, 0x374151];
export const TROUSERS = [0x1e40af, 0x111827, 0xa8956b, 0x4b5563, 0x334155, 0x7c2d12];
export const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
export const HAIR = [0x111111, 0x3b2314, 0x8a5a2b, 0xd6b370, 0x9ca3af, 0x7c2d12];
export const STAFF_SHIRT = 0xdc2626;

// Which car park spots have a car, the same for the renderer and the customers.
export function parkedCars(storeId) {
  const cars = [];
  L.rows.forEach((w, row) => {
    L.carSlots.forEach((u, k) => {
      if ((k * 7 + storeId * 5 + row * 3) % 3 === 0) return;
      // People get in and out at the front of the car, on the shop side.
      cars.push({ u, w, row, color: (k * 3 + row * 5 + storeId) % 7, du: u + 0.5, dw: w - 2.7 });
    });
  });
  return cars;
}

// Product j sits in one bay: gondola, side (aisle) and position along it.
export function bayOf(j) {
  const k = Math.floor(j / 4) % L.gondolas.length;
  const side = (j >> 1) & 1;
  const b = j & 1;
  const g = L.gondolas[k];
  const faceU = g + (side ? L.gondolaHalf : -L.gondolaHalf);
  const dir = side ? 1 : -1; // from the shelf into the aisle
  return {
    k, side, b, faceU, dir,
    aisle: k + side,
    w: L.shelfFrom + L.bayLen * (b + 0.5),
    standU: faceU + dir * 0.6,
    face: side ? Math.PI : 0, // heading that looks at the shelf
  };
}

export class StoreFloor {
  constructor(store, rng) {
    const s = (this.store = store);
    this.rng = rng;
    this.n = s.stock.length;
    this.bays = s.stock.map((_, j) => bayOf(j));
    this.shelf = [...s.stock]; // boxes you see on each product's shelf
    this.reserved = s.stock.map(() => 0); // sold, but the customer has not picked it yet
    this.back = []; // delivered boxes in the back room, in order of arrival
    this.cars = parkedCars(s.id);
    this.lanes = L.tills.map((u) => ({ u, laneU: u + L.laneOffset, queue: [], coming: 0 }));
    this.customers = [];
    this.nextId = 1;
    this.spawned = 0; // visits that became a walking customer
    this.dropped = 0; // visits not drawn because the store was full
    this.served = 0;
    this.unloading = false;
    this.isOpen = false;

    const person = (role, u, w, extra) => {
      const p = {
        id: this.nextId++, role, u, v: s.faceV + w, pu: u, pv: s.faceV + w, heading: Math.PI / 2, pheading: Math.PI / 2,
        phase: rng.next() * 6, pphase: 0, walking: false, working: false, r: 0.3, speed: 1.25,
        steps: [], waited: 0, present: true, load: [], items: [],
        shirt: STAFF_SHIRT, trousers: 0x111827, skin: rng.pick(SKINS), hair: rng.pick(HAIR), size: 0.95 + rng.next() * 0.1,
        ...extra,
      };
      p.pphase = p.phase;
      return p;
    };
    this.staff = [];
    for (let k = 0; k < STAFF; k++) this.staff.push(person('staff', IDLE[k][0], IDLE[k][1], { idle: k }));
    this.cashiers = this.lanes.map((lane, i) => person('cashier', CASHIER_ROOM[0], CASHIER_ROOM[1], { till: i, present: false, onDuty: false }));
    this.people = [...this.staff, ...this.cashiers];
  }

  V(w) {
    return this.store.faceV + w;
  }

  // ---------- one tick ----------
  step(dt, world) {
    const s = this.store;
    const hour = world ? world.hour : 12;
    this.isOpen = hour >= OPEN && hour < CLOSE;
    this.unloading = !!world?.trucks.some((t) => t.dest === s.id && t.state === 'unloading');
    for (const p of this.people) {
      p.pu = p.u;
      p.pv = p.v;
      p.pheading = p.heading;
      p.pphase = p.phase;
    }
    this.takeVisits();
    this.reconcile();
    this.planCashiers(hour);
    for (const p of this.staff) if (!p.steps.length) this.planStaff(p);
    for (const p of this.people) if (p.present) this.act(p, dt);
    // Customers who reached their car drive off.
    if (this.customers.some((c) => c.gone)) {
      this.customers = this.customers.filter((c) => !c.gone);
      this.people = this.people.filter((c) => !c.gone);
    }
  }

  // ---------- stock ----------
  // Every sale in world.js leaves a note; it becomes a customer who walks in
  // and picks those boxes from the shelves.
  takeVisits() {
    const s = this.store;
    if (!s.visits?.length) return;
    for (const visit of s.visits.splice(0)) {
      if (this.customers.length >= MAX_CUSTOMERS) {
        this.dropped++;
        continue;
      }
      const list = [];
      for (const p of visit.bought) {
        // Normally the box is on the shelf; if it is still in the back room the
        // customer gets one of those (world.js already sold it).
        let reserved = false;
        if (this.shelf[p] - this.reserved[p] > 0) {
          this.reserved[p]++;
          reserved = true;
        } else {
          this.removeInbound(p, 1);
        }
        list.push({ p, reserved, missed: false });
      }
      for (const p of visit.missed) list.push({ p, reserved: false, missed: true });
      this.spawn(list);
    }
  }

  // Boxes of a product in the store that are not sold yet.
  stockOf(p) {
    let n = this.shelf[p] - this.reserved[p];
    for (const q of this.back) if (q === p) n++;
    for (const st of this.staff) for (const q of st.load) if (q === p) n++;
    return n;
  }

  totalStock() {
    let n = 0;
    for (let p = 0; p < this.n; p++) n += this.stockOf(p);
    return n;
  }

  // Keep the floor's count of every product equal to the store's stock: new
  // boxes from the truck appear in the back room.
  reconcile() {
    const s = this.store;
    for (let p = 0; p < this.n; p++) {
      const diff = s.stock[p] - this.stockOf(p);
      if (diff > 0) for (let k = 0; k < diff; k++) this.back.push(p);
      else if (diff < 0) {
        let left = -diff;
        const free = Math.min(left, this.shelf[p] - this.reserved[p]);
        this.shelf[p] -= free;
        left -= free;
        if (left > 0) this.removeInbound(p, left);
      }
    }
  }

  // Take boxes of a product from the back room or from staff's arms.
  removeInbound(p, n) {
    for (let k = this.back.length - 1; k >= 0 && n > 0; k--) {
      if (this.back[k] === p) {
        this.back.splice(k, 1);
        n--;
      }
    }
    for (const st of this.staff) {
      for (let k = st.load.length - 1; k >= 0 && n > 0; k--) {
        if (st.load[k] === p) {
          st.load.splice(k, 1);
          n--;
        }
      }
    }
    return n;
  }

  // ---------- customers ----------
  spawn(list) {
    const rng = this.rng;
    // Arrive at a parked car whose door is free.
    let car = null;
    for (let k = 0; k < 8 && !car; k++) {
      const c = rng.pick(this.cars);
      if (this.spotFree(c.du, this.V(c.dw), 0.7)) car = c;
    }
    car ??= rng.pick(this.cars);
    const n = list.filter((it) => !it.missed).length;
    const carrier = n >= 3 ? 'trolley' : n === 2 || rng.next() < 0.3 ? 'basket' : 'none';
    const c = {
      id: this.nextId++, role: 'customer', u: car.du, v: this.V(car.dw), pu: 0, pv: 0,
      heading: -Math.PI / 2, pheading: 0, phase: rng.next() * 6, pphase: 0, walking: false, working: false,
      r: carrier === 'trolley' ? 0.42 : 0.28, speed: carrier === 'trolley' ? 1.0 : 1.1 + rng.next() * 0.3,
      steps: [], waited: 0, present: true, load: [], items: [], list, car, carrier, gone: false,
      shirt: rng.pick(SHIRTS), trousers: rng.pick(TROUSERS), skin: rng.pick(SKINS), hair: rng.pick(HAIR),
      size: 0.9 + rng.next() * 0.16, born: 0,
    };
    c.pu = c.u;
    c.pv = c.v;
    c.pheading = c.heading;
    c.pphase = c.phase;
    this.planCustomer(c);
    this.customers.push(c);
    this.people.push(c);
    this.spawned++;
  }

  // The whole visit: from the car to the shelves, the till, and back.
  planCustomer(c) {
    const steps = c.steps;
    const go = (u, w, exact = false) => steps.push({ kind: 'go', u, v: this.V(w), exact });
    // To the entrance.
    if (c.car.row === 0) {
      go(c.car.du, L.sidewalk);
      go(L.entranceU, L.sidewalk);
    } else {
      go(c.car.du, L.lotLane);
      go(L.entranceU, L.lotLane);
    }
    go(L.entranceU, L.depth - 1);
    go(L.aisles[1], L.frontAisle);
    // The shelves with what they came for, and maybe a look at the fruit,
    // the fridges or the wall shelf on the way; aisle by aisle.
    const stops = c.list.map((it) => {
      const bay = this.bays[it.p];
      return { it, aisle: bay.aisle, w: bay.w, via: [], u: bay.standU, sw: bay.w, face: bay.face };
    });
    for (const spot of this.browseSpots()) stops.push(spot);
    stops.sort((a, b) => a.aisle - b.aisle || a.w - b.w);
    let at = { a: 1, w: L.frontAisle };
    for (const st of stops) {
      for (const [u, w] of this.gridPath(at.a, at.w, st.aisle, st.w)) go(u, w);
      for (const [u, w] of st.via) go(u, w);
      go(st.u, st.sw, true);
      if (!st.it) steps.push({ kind: 'browse', face: st.face, t: 2.5 + this.rng.next() * 3, t0: 0 });
      else if (st.it.missed) steps.push({ kind: 'look', face: st.face, t: 2.5 + this.rng.next() * 1.5, t0: 0 });
      else steps.push({ kind: 'pick', face: st.face, t: 1.6, it: st.it, done: false });
      for (const [u, w] of [...st.via].reverse()) go(u, w);
      go(L.aisles[st.aisle], st.w);
      at = { a: st.aisle, w: st.w };
    }
    for (const [u, w] of this.gridPath(at.a, at.w, at.a, L.frontAisle)) go(u, w);
    const bought = c.list.some((it) => !it.missed);
    let outU = L.entranceU;
    if (bought) {
      steps.push({ kind: 'queue', lane: null });
      outU = L.exitU;
    } else {
      // Nothing to buy: leave the way they came.
      go(L.aisles[1], L.frontAisle);
      go(L.entranceU, L.depth - 1);
    }
    go(outU, L.sidewalk);
    if (c.car.row === 0) {
      go(c.car.du, L.sidewalk);
    } else {
      go(outU, L.lotLane);
      go(c.car.du, L.lotLane);
    }
    go(c.car.du, c.car.dw, true);
    steps.push({ kind: 'gone' });
  }

  // Places customers like to look at on the way, without buying anything here.
  browseSpots() {
    const rng = this.rng;
    const spots = [];
    if (rng.next() < 0.45) {
      // A fruit stand, reached along the walkway by the fridges.
      const u = rng.pick(L.produce) + (rng.next() - 0.5) * 1.4;
      spots.push({ aisle: L.aisles.length - 1, w: L.corridor, via: [[u, L.corridor]], u, sw: L.produceFrom - 0.55, face: Math.PI / 2 });
    }
    if (rng.next() < 0.35) {
      const u = L.fridgeFrom + 0.6 + rng.next() * (L.fridgeTo - L.fridgeFrom - 1.2);
      spots.push({ aisle: L.aisles.length - 1, w: L.corridor, via: [[u, L.corridor]], u, sw: L.backWall + L.fridgeDepth + 0.55, face: -Math.PI / 2 });
    }
    if (rng.next() < 0.35) {
      const w = L.wallShelf[0] + 0.8 + rng.next() * (L.wallShelf[1] - L.wallShelf[0] - 1.6);
      spots.push({ aisle: 0, w, via: [], u: -L.halfWidth + 1.55, sw: w, face: Math.PI });
    }
    return spots;
  }

  // From one aisle to another: along the front or back cross aisle, whichever is shorter.
  gridPath(a1, w1, a2, w2) {
    const A = L.aisles;
    if (a1 === a2) return Math.abs(w1 - w2) > 0.01 ? [[A[a2], w2]] : [];
    const front = Math.abs(w1 - L.frontAisle) + Math.abs(w2 - L.frontAisle);
    const back = Math.abs(w1 - L.backAisle) + Math.abs(w2 - L.backAisle);
    const c = front <= back ? L.frontAisle : L.backAisle;
    const pts = [];
    if (Math.abs(w1 - c) > 0.01) pts.push([A[a1], c]);
    pts.push([A[a2], c]);
    if (Math.abs(w2 - c) > 0.01) pts.push([A[a2], w2]);
    return pts;
  }

  // Pick the till with the shortest queue whose cashier is there.
  chooseLane(c) {
    let best = null;
    for (let i = 0; i < this.lanes.length; i++) {
      const lane = this.lanes[i];
      if (!this.cashiers[i].onDuty) continue;
      const score = (lane.queue.length + lane.coming) * 10 + Math.abs(lane.laneU - c.u) * 0.1;
      if (!best || score < best.score) best = { i, score };
    }
    return best ? best.i : 0;
  }

  // Waiting spot k in a lane: 0 is paying at the counter.
  slot(lane, k) {
    return k === 0 ? [lane.laneU, L.payW] : [lane.laneU, L.queueW - 0.8 * (k - 1)];
  }

  // ---------- staff ----------
  planStaff(p) {
    const go = (u, w, exact = false) => p.steps.push({ kind: 'go', u, v: this.V(w), exact });
    const [iu, iw] = IDLE[p.idle];
    if (this.back.length && (!this.unloading || this.back.length >= CARRY)) {
      const [pu, pw] = PICKUP[p.idle];
      go(pu, pw, true);
      p.steps.push({ kind: 'load', face: -Math.PI / 2, t: 1.8, done: false });
      return;
    }
    if (this.unloading && p.idle === 0) {
      go(RECEIVE[0], RECEIVE[1], true);
      p.steps.push({ kind: 'receive', face: -Math.PI / 2 });
      return;
    }
    if (Math.hypot(p.u - iu, p.v - this.V(iw)) > 0.05) go(iu, iw, true);
    p.steps.push({ kind: 'idle', face: Math.PI / 2, t: 1 });
  }

  // Took boxes from the back room: walk them to their shelves and come back.
  planRestock(p) {
    const go = (u, w, exact = false) => p.steps.push({ kind: 'go', u, v: this.V(w), exact });
    const D = L.staffDoorU;
    go(D, L.backWall - 1);
    go(D, L.backAisle);
    const bays = [...new Set(p.load)].map((q) => ({ q, bay: this.bays[q] }))
      .sort((a, b) => a.bay.aisle - b.bay.aisle || a.bay.w - b.bay.w);
    let at = { a: -1, w: L.backAisle };
    for (const { q, bay } of bays) {
      const path = at.a < 0 ? [[L.aisles[bay.aisle], L.backAisle], [L.aisles[bay.aisle], bay.w]]
        : this.gridPath(at.a, at.w, bay.aisle, bay.w);
      for (const [u, w] of path) go(u, w);
      go(bay.standU, bay.w, true);
      p.steps.push({ kind: 'put', face: bay.face, q, t: 1.0 });
      go(L.aisles[bay.aisle], bay.w);
      at = { a: bay.aisle, w: bay.w };
    }
    if (at.a >= 0) {
      for (const [u, w] of this.gridPath(at.a, at.w, at.a, L.backAisle)) go(u, w);
    }
    go(D, L.backAisle);
    go(D, L.backWall - 1);
  }

  // ---------- cashiers ----------
  planCashiers(hour) {
    const work = (this.tillsOpen = (hour >= SHIFT_START && hour < CLOSE) || this.customers.length > 0);
    for (const p of this.cashiers) {
      if (p.steps.length) continue;
      if (work && p.present) {
        p.steps.push({ kind: 'till' });
      } else if (work && !p.present) {
        // Into work: from the staff room through the back room to the till,
        // one after the other.
        const v = this.V(CASHIER_ROOM[1]);
        if (!this.spotFree(CASHIER_ROOM[0], v, 0.9)) continue;
        p.present = true;
        p.onDuty = true;
        p.u = p.pu = CASHIER_ROOM[0];
        p.v = p.pv = v;
        this.cashierPath(p, false);
        p.steps.push({ kind: 'till' });
      } else if (!work && p.present) {
        p.onDuty = false;
        this.cashierPath(p, true);
        p.steps.push({ kind: 'home' });
      }
    }
  }

  cashierPath(p, back) {
    const till = L.tills[p.till] + L.cashierOffset;
    const pts = [
      [CASHIER_ROOM[0], L.backWall - 1], [L.staffDoorU, L.backWall - 1], [L.staffDoorU, L.backAisle],
      [L.aisles[3], L.backAisle], [L.aisles[3], L.frontAisle], [till, L.frontAisle], [till, L.payW],
    ];
    if (back) pts.reverse().push(CASHIER_ROOM);
    pts.forEach(([u, w], k) => p.steps.push({ kind: 'go', u, v: this.V(w), exact: k === pts.length - 1 }));
  }

  // ---------- doing things ----------
  act(p, dt) {
    const s = p.steps[0];
    p.walking = false;
    p.working = false;
    if (!s) return;
    if (s.kind === 'go') {
      // Someone stands by the car: get in from the other side. Blocked for
      // very long (should not happen): head for the next point instead.
      const atCar = p.steps[1]?.kind === 'gone' && p.waited > 1;
      if (this.goTo(p, s, dt) || atCar || p.waited > 20) p.steps.shift();
      return;
    }
    if (s.kind === 'queue') return this.queue(p, s, dt);
    if (s.kind === 'gone') {
      p.gone = true;
      p.steps.length = 0;
      return;
    }
    if (s.kind === 'till') {
      this.turn(p, 0, dt);
      const lane = this.lanes[p.till];
      p.working = !!lane.queue[0]?.paying;
      p.phase += dt * (p.working ? 4 : 1);
      if (!this.tillsOpen) p.steps.shift();
      return;
    }
    if (s.kind === 'home') {
      p.present = false;
      p.steps.shift();
      return;
    }
    // The rest are things done standing, facing one way.
    if (!this.turn(p, s.face, dt)) return;
    if (s.kind === 'look' || s.kind === 'browse') {
      // An empty shelf: look up and down the aisle, then give up. Browsing:
      // a slow look along the goods.
      s.t0 += dt;
      p.heading = wrap(s.face + (s.kind === 'look' ? Math.sin(s.t0 * 2.6) * 0.9 : Math.sin(s.t0 * 0.9) * 0.35));
      p.phase += dt;
      s.t -= dt;
      if (s.t <= 0) {
        p.heading = s.face;
        p.steps.shift();
      }
      return;
    }
    if (s.kind === 'idle') {
      p.phase += dt;
      s.t -= dt;
      if (s.t <= 0) p.steps.shift();
      return;
    }
    p.working = true;
    p.phase += dt * 4;
    if (s.kind === 'pick') {
      s.t -= dt;
      if (!s.done && s.t <= 0.8) {
        s.done = true;
        if (s.it.reserved) {
          this.shelf[s.it.p]--;
          this.reserved[s.it.p]--;
        }
        p.items.push(s.it.p);
      }
      if (s.t <= 0) p.steps.shift();
    } else if (s.kind === 'load') {
      s.t -= dt;
      if (s.t > 0) return;
      p.steps.shift();
      // Take the newest boxes; one trip carries a few.
      p.load = this.back.splice(Math.max(0, this.back.length - CARRY), CARRY);
      if (p.load.length) this.planRestock(p);
    } else if (s.kind === 'put') {
      s.t -= dt;
      if (s.t > 0) return;
      const k = p.load.indexOf(s.q);
      if (k >= 0) {
        p.load.splice(k, 1);
        this.shelf[s.q]++;
        s.t = 0.8;
      }
      if (!p.load.includes(s.q)) p.steps.shift();
    } else if (s.kind === 'receive') {
      if (!this.unloading || this.back.length >= CARRY * 2) p.steps.shift();
    }
  }

  // In the queue: move up as people ahead pay, pay, then go on.
  queue(p, s, dt) {
    if (s.lane === null) {
      // Walk to the side of the queue first, never through the people waiting.
      s.lane = this.chooseLane(p);
      const lane = this.lanes[s.lane];
      const [qu, qw] = this.slot(lane, lane.queue.length + lane.coming);
      lane.coming++;
      s.approach = { kind: 'go', u: qu - 1.2, v: this.V(Math.min(L.frontAisle, qw)), exact: false };
    }
    const lane = this.lanes[s.lane];
    if (s.approach) {
      if (!this.goTo(p, s.approach, dt)) return;
      // At the queue: join it at the end, then step in from the side.
      s.approach = null;
      lane.coming--;
      lane.queue.push(p);
      const [qu, qw] = this.slot(lane, lane.queue.length - 1);
      s.enter = { kind: 'go', u: qu, v: this.V(Math.min(L.queueW, qw)), exact: true };
    }
    if (s.enter) {
      if (this.goTo(p, s.enter, dt)) s.enter = null;
      if (s.enter && lane.queue.indexOf(p) === 0 && p.v > s.enter.v - 0.5) s.enter = null;
      return;
    }
    const k = lane.queue.indexOf(p);
    const [qu, qw] = this.slot(lane, k);
    const there = this.moveTo(p, qu, this.V(qw), dt);
    if (!there) return;
    const ready = k === 0 && this.cashiers[s.lane].steps[0]?.kind === 'till';
    if (!ready) {
      this.turn(p, Math.PI / 2, dt);
      return;
    }
    if (!this.turn(p, Math.PI, dt)) return;
    s.pay ??= 2.5 + p.items.length * 0.8;
    p.paying = true;
    p.working = true;
    p.phase += dt * 3;
    s.pay -= dt;
    if (s.pay > 0) return;
    p.paying = false;
    lane.queue.shift();
    p.steps.shift();
    this.served++;
    // Out past the end of the counter, then to the exit.
    p.steps.unshift(
      { kind: 'go', u: lane.laneU, v: this.V(L.afterTill), exact: false },
      { kind: 'go', u: L.exitU, v: this.V(L.afterTill), exact: false },
    );
  }

  // ---------- walking ----------
  goTo(p, s, dt) {
    if (s.tu === undefined) {
      s.tu = s.u;
      s.tv = s.v;
      if (!s.exact) {
        // Keep right of the line, so people going opposite ways pass each other.
        const du = s.u - p.u;
        const dv = s.v - p.v;
        const len = Math.hypot(du, dv);
        if (len > 0.01) {
          s.tu += (dv / len) * KEEP_RIGHT;
          s.tv -= (du / len) * KEEP_RIGHT;
        }
      }
    }
    return this.moveTo(p, s.tu, s.tv, dt);
  }

  // One step toward (tu, tv); true once there.
  moveTo(p, tu, tv, dt) {
    const du = tu - p.u;
    const dv = tv - p.v;
    const dist = Math.hypot(du, dv);
    if (dist < 0.02) {
      p.waited = 0;
      return true;
    }
    this.turn(p, Math.atan2(dv, du), dt);
    const stepLen = Math.min(p.speed * dt, dist);
    let nu = p.u + (du / dist) * stepLen;
    let nv = p.v + (dv / dist) * stepLen;
    // Never into a shelf or counter: slide along its side instead.
    const f = this.store.faceV;
    if (this.solid(nu, nv - f)) {
      if (!this.solid(nu, p.v - f)) nv = p.v;
      else if (!this.solid(p.u, nv - f)) nu = p.u;
      else {
        nu = p.u;
        nv = p.v;
      }
    }
    if ((nu !== p.u || nv !== p.v) && this.free(p, nu, nv)) {
      p.u = nu;
      p.v = nv;
      p.walking = true;
      p.waited = 0;
      p.sideWait = 0;
      p.phase += stepLen * 3.2;
      return Math.hypot(tu - p.u, tv - p.v) < 0.02;
    }
    p.waited += dt;
    // Someone stands on the spot: close enough.
    if (p.waited > 2.5 && dist < 1.0) {
      p.waited = 0;
      return true;
    }
    p.sideWait = (p.sideWait ?? 0) + dt;
    if (p.sideWait > 0.9) this.sidestep(p, du / dist, dv / dist, stepLen);
    return false;
  }

  // Never step closer to another person than both their sizes.
  free(p, nu, nv) {
    for (const o of this.people) {
      if (o === p || !o.present) continue;
      const min = p.r + o.r;
      const d = Math.hypot(nu - o.u, nv - o.v);
      if (d < min && d < Math.hypot(p.u - o.u, p.v - o.v) - 1e-6) return false;
    }
    return true;
  }

  // Blocked for a while: step a little to the right (or left) to get past.
  sidestep(p, dirU, dirV, len) {
    for (const side of [1, -1]) {
      const nu = p.u + dirV * len * side;
      const nv = p.v - dirU * len * side;
      if (this.free(p, nu, nv) && !this.solid(nu, nv - this.store.faceV, 0.3)) {
        p.u = nu;
        p.v = nv;
        p.walking = true;
        p.phase += len * 3.2;
        p.sideWait = 0.6;
        return;
      }
    }
  }

  // Is there a shelf, counter, wall or car at (u, w), with a margin?
  solid(u, w, m = 0) {
    return obstacles().some(([u0, u1, w0, w1]) => u > u0 - m && u < u1 + m && w > w0 - m && w < w1 + m);
  }

  spotFree(u, v, d) {
    return !this.people.some((o) => o.present && Math.hypot(o.u - u, o.v - v) < d);
  }

  // Turn toward a heading; true once facing it.
  turn(p, h, dt) {
    const diff = wrap(h - p.heading);
    if (Math.abs(diff) < 0.02) {
      p.heading = wrap(h);
      return true;
    }
    p.heading = wrap(p.heading + clamp(diff, -6 * dt, 6 * dt));
    return false;
  }
}

// Things people cannot walk through, as [u0, u1, w0, w1] in the store frame.
let solids = null;
export function obstacles() {
  if (solids) return solids;
  solids = [];
  for (const g of L.gondolas) solids.push([g - L.gondolaHalf, g + L.gondolaHalf, L.shelfFrom, L.shelfTo]);
  for (const t of L.tills) solids.push([t - 0.4, t + 0.4, L.counterFrom, L.counterTo]);
  for (const u of L.produce) solids.push([u - 1.0, u + 1.0, L.produceFrom, L.produceTo]);
  solids.push([L.fridgeFrom, L.fridgeTo, L.backWall, L.backWall + L.fridgeDepth]);
  solids.push([-L.halfWidth, -L.halfWidth + 1.0, L.wallShelf[0], L.wallShelf[1]]);
  for (const [u, w] of L.promos) solids.push([u - 0.8, u + 0.8, w - 0.8, w + 0.8]);
  const H = L.halfWidth;
  const D = L.staffDoorU;
  const half = L.staffDoorWidth / 2;
  // Walls: the back-room wall with its opening, the shop front with two doors.
  solids.push([-H, D - half, L.backWall - 0.1, L.backWall + 0.1], [D + half, H, L.backWall - 0.1, L.backWall + 0.1]);
  const dh = L.doorWidth / 2;
  solids.push([-H, L.entranceU - dh, L.depth - 0.15, L.depth + 0.15]);
  solids.push([L.entranceU + dh, L.exitU - dh, L.depth - 0.15, L.depth + 0.15]);
  solids.push([L.exitU + dh, H, L.depth - 0.15, L.depth + 0.15]);
  for (const w of L.rows) for (const u of L.carSlots) solids.push([u - 0.95, u + 0.95, w - 2.1, w + 2.1]);
  return solids;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
