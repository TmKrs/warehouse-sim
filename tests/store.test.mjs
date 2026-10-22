// Runs the chain for a day and checks the store insides: customers and staff
// stay in the store or its car park, never walk into each other or through
// shelves, every sale becomes a walking customer, and the shelves show the
// store's stock without ever changing it.
// Run with: node tests/store.test.mjs
import assert from 'node:assert/strict';
import { World, CLOCK_SPEED } from '../src/sim/world.js';
import { TICK } from '../src/sim/sim.js';
import { STORE, obstacles } from '../src/sim/storeFloor.js';

const LAG = 300; // seconds a shelf may show something else than the stock

for (const settings of [{ seed: 7 }, { seed: 3, factories: 8, stores: 8, robots: 16, customersPerHour: 20 }]) {
  const w = new World(settings);
  const ticks = Math.round(86400 / CLOCK_SPEED / TICK);
  const t0 = Date.now();
  let minGap = Infinity;
  let close = 0;
  let maxPeople = 0;
  let visits = 0;
  let maxLag = 0;
  let restocked = 0;
  let inShelf = 0;
  let longestWait = 0;
  const firstSeen = new Map();
  const visitTimes = [];
  const offSince = w.stores.map((s) => s.stock.map(() => null));
  const solid = obstacles();
  for (let i = 0; i < ticks; i++) {
    // The floors run before the customers of this tick shop, so count visits now.
    for (const st of w.stores) visits += st.visits.length;
    const floorsBefore = w.storeFloors.map((fl) => fl.shelf.reduce((a, b) => a + b, 0));
    w.step();
    w.storeFloors.forEach((fl, k) => {
      const st = w.stores[k];
      const now = w.time;
      // 1. Stock only changes through sales and deliveries in world.js: a floor
      //    step alone never changes it (checked by stepping a floor on its own).
      if (i % 500 === 0) {
        const copy = [...st.stock];
        const pending = st.visits;
        st.visits = [];
        fl.step(0, w);
        st.visits = pending;
        assert.deepEqual(st.stock, copy, 'the floor never changes the stock');
      }
      // 2. The floor's boxes add up to the stock, minus sales it has not seen
      //    yet, plus at most one box a truck unloaded after the floor's turn.
      let unseen = 0;
      for (const v of st.visits) unseen += v.bought.length;
      const off = st.stock.reduce((a, b) => a + b, 0) - (fl.totalStock() - unseen);
      const unloading = w.trucks.some((t) => t.dest === st.id && t.state === 'unloading');
      assert.ok(off === 0 || (off === 1 && unloading), `${st.name}: floor mirrors the stock (off by ${off})`);
      // 3. Each shelf shows the stock, with a short lag while boxes are carried in or picked.
      st.stock.forEach((n, p) => {
        const shown = fl.shelf[p];
        assert.ok(shown >= 0 && fl.reserved[p] >= 0 && fl.reserved[p] <= shown, 'shelf counts are sane');
        if (shown === n) offSince[k][p] = null;
        else {
          offSince[k][p] ??= now;
          maxLag = Math.max(maxLag, now - offSince[k][p]);
        }
      });
      if (fl.shelf.reduce((a, b) => a + b, 0) > floorsBefore[k]) restocked++;
      // 4. Everybody stays in the store or its car park and keeps their distance.
      const people = fl.people.filter((p) => p.present);
      maxPeople = Math.max(maxPeople, fl.customers.length);
      assert.ok(fl.customers.length <= 25, 'customer cap');
      for (const c of fl.customers) if (!firstSeen.has(c)) firstSeen.set(c, now);
      for (const [c, t] of firstSeen) {
        if (c.gone) {
          visitTimes.push(now - t);
          firstSeen.delete(c);
        }
      }
      for (const p of people) {
        longestWait = Math.max(longestWait, p.waited);
        assert.ok(Number.isFinite(p.u) && Number.isFinite(p.v) && Number.isFinite(p.heading) && Number.isFinite(p.phase),
          `${p.role} in ${st.name} has no position`);
        const u = p.u;
        const pw = p.v - st.faceV;
        assert.ok(Math.abs(u) <= 25 && pw >= 0 && pw <= 48, `${p.role} left ${st.name} at ${u.toFixed(1)},${pw.toFixed(1)}`);
        if (pw < STORE.depth) assert.ok(Math.abs(u) < STORE.halfWidth, `${p.role} walked through a wall of ${st.name}`);
        if (solid.some(([u0, u1, w0, w1]) => u > u0 + 0.05 && u < u1 - 0.05 && pw > w0 + 0.05 && pw < w1 - 0.05)) inShelf++;
      }
      for (let a = 0; a < people.length; a++) {
        for (let b = a + 1; b < people.length; b++) {
          const d = Math.hypot(people[a].u - people[b].u, people[a].v - people[b].v);
          minGap = Math.min(minGap, d);
          if (d < 0.5) close++;
          assert.ok(d > 0.35, `${people[a].role} and ${people[b].role} bumped into each other in ${st.name} at tick ${i}`);
        }
      }
    });
  }
  // Let the last customers finish (the stores are closed by now).
  const spawned = w.storeFloors.reduce((a, fl) => a + fl.spawned, 0);
  const dropped = w.storeFloors.reduce((a, fl) => a + fl.dropped, 0);
  const served = w.storeFloors.reduce((a, fl) => a + fl.served, 0);
  const left = w.storeFloors.reduce((a, fl) => a + fl.customers.length, 0);
  const sold = w.stores.reduce((a, s) => a + s.soldTotal, 0);
  console.log(
    `${w.stores.length} stores: ${Date.now() - t0} ms | visits ${visits}, walking customers ${spawned}, dropped ${dropped}, ` +
      `paid ${served}, still inside ${left} | most customers in one store ${maxPeople} | closest people ${minGap.toFixed(2)} m, ` +
      `ticks under 0.5 m ${close} | longest wait ${longestWait.toFixed(1)} s | ` +
      `visit takes ${(visitTimes.reduce((a, b) => a + b, 0) / visitTimes.length).toFixed(0)} s on average, at most ${Math.max(...visitTimes).toFixed(0)} s | in a shelf ${inShelf} | longest shelf lag ${maxLag.toFixed(0)} s | restock ticks ${restocked} | sold ${sold}`,
  );
  assert.ok(visits > 20, 'customers came');
  assert.equal(spawned + dropped, visits, 'every visit becomes a walking customer unless the store is full');
  assert.ok(dropped <= visits * 0.05, 'the cap is rarely hit');
  assert.ok(served > visits * 0.5, 'customers pay at the tills');
  assert.equal(left, 0, 'everybody went home after closing');
  assert.equal(inShelf, 0, 'nobody walks through shelves or counters');
  assert.ok(maxLag <= LAG, 'shelves catch up with the stock');
  assert.ok(restocked > 0, 'staff fill the shelves');
  assert.ok(Math.max(...visitTimes) < 600, 'nobody gets stuck in the store');
  for (const fl of w.storeFloors) {
    assert.ok(fl.cashiers.every((c) => !c.present || w.hour >= 7.75), 'cashiers go home at night');
    assert.equal(fl.lanes.reduce((a, l) => a + l.queue.length, 0), 0, 'queues are empty at night');
  }
}
console.log('store floors ok');
