// Runs the whole supply chain for a few warehouse days without graphics and
// checks that goods flow from factories through the warehouse to the stores,
// that robots never crash, and that trucks never pile up.
// Run with: node tests/world.test.mjs
import assert from 'node:assert/strict';
import { World, CLOCK_SPEED } from '../src/sim/world.js';
import { TICK } from '../src/sim/sim.js';
import { yardPose } from '../src/sim/yard.js';

// Two trucks (11 m by 2.5 m boxes) touch? Separating axis test.
function touching(a, b) {
  const corners = (t) => [[5.5, 1.25], [5.5, -1.25], [-5.5, -1.25], [-5.5, 1.25]].map(([l, s]) => [
    t.x + Math.cos(t.heading) * l - Math.sin(t.heading) * s,
    t.z + Math.sin(t.heading) * l + Math.cos(t.heading) * s,
  ]);
  const ca = corners(a);
  const cb = corners(b);
  for (const t of [a, b]) {
    for (const [nx, nz] of [[Math.cos(t.heading), Math.sin(t.heading)], [-Math.sin(t.heading), Math.cos(t.heading)]]) {
      const pa = ca.map(([x, z]) => x * nx + z * nz);
      const pb = cb.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

function run(settings, days) {
  const w = new World(settings);
  const ticks = Math.round((days * 86400) / CLOCK_SPEED / TICK);
  let maxTrucks = 0;
  let firstMinute = 0;
  let maxStored = 0;
  let maxFleet = 0;
  let maxGate = 0;
  const t0 = Date.now();
  for (let i = 0; i < ticks; i++) {
    w.step();
    const seen = new Set();
    for (const r of w.sim.robots) {
      assert.ok(!seen.has(r.cell), `robots crashed at tick ${w.sim.tick}`);
      seen.add(r.cell);
    }
    for (const t of w.trucks) {
      assert.ok(Number.isFinite(t.x) && Number.isFinite(t.z), `${t.name} has no position`);
      assert.ok(t.waited < 120, `${t.name} stuck for 2 minutes (${t.label}) at ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
    }
    // Trucks never drive into each other.
    for (let a = 0; a < w.trucks.length; a++) {
      for (let b = a + 1; b < w.trucks.length; b++) {
        const A = w.trucks[a];
        const B = w.trucks[b];
        if (Math.hypot(A.x - B.x, A.z - B.z) < 12) assert.ok(!touching(A, B), `${A.name} and ${B.name} crashed at ${A.x.toFixed(1)},${A.z.toFixed(1)}`);
      }
    }
    // Nor in the warehouse's parking lot, at the docks or at the exit.
    const Y = w.sim.yardPlan;
    const yard = w.sim.trucks
      .filter((t) => t.status !== 'planned' && (t.status !== 'gone' || t.atExit))
      .map((t) => {
        const p = yardPose(Y, t, w.time - t.statusSince);
        return { name: `${t.name} (${t.status})`, x: p.x, z: p.z, heading: p.h };
      });
    const all = [...yard, ...w.trucks.filter((t) => !(t.kind === 'return' && Math.hypot(t.x - Y.exit.x, t.z - Y.exit.z) < 0.5))];
    for (let a = 0; a < yard.length; a++) {
      for (let b = a + 1; b < all.length; b++) {
        const A = yard[a];
        const B = all[b];
        if (Math.hypot(A.x - B.x, A.z - B.z) < 12) assert.ok(!touching(A, B), `${A.name} and ${B.name} overlap in the yard at ${A.x.toFixed(1)},${A.z.toFixed(1)} (t=${w.time.toFixed(1)})`);
      }
    }
    for (const f of w.factories) maxFleet = Math.max(maxFleet, w.fleetInUse(f));
    for (const t of w.trucks) {
      if (t.state === 'gate') t.gateWait = (t.gateWait ?? 0) + TICK;
      maxGate = Math.max(maxGate, t.gateWait ?? 0);
    }
    if (w.time < 60) firstMinute = Math.max(firstMinute, w.trucks.filter((t) => t.kind === 'in').length);
    maxTrucks = Math.max(maxTrucks, w.trucks.length);
    maxStored = Math.max(maxStored, w.sim.stored);
  }
  return { w, ms: Date.now() - t0, maxTrucks, maxStored, firstMinute, maxFleet, maxGate };
}

for (const [label, settings] of [
  ['3 factories, 3 stores', { seed: 7 }],
  ['8 factories, 8 stores, 16 robots', { seed: 3, factories: 8, stores: 8, robots: 16, customersPerHour: 20 }],
  ['3 factories, 8 stores', { seed: 11, factories: 3, stores: 8 }],
  ['5 factories, 5 stores', { seed: 21, factories: 5, stores: 5 }],
  ['8 factories, 3 stores, 3 trucks each', { seed: 5, factories: 8, stores: 3, trucksPerFactory: 3, customersPerHour: 30 }],
]) {
  const { w, ms, maxTrucks, maxStored, firstMinute, maxFleet, maxGate } = run(settings, 3);
  const s = w.summary();
  const ws = w.sim.summary();
  const lostPct = (100 * s.lost) / Math.max(1, s.sold + s.lost);
  console.log(
    `${label}: ${ms} ms | sold ${s.sold}, lost ${s.lost} (${lostPct.toFixed(1)}%) | warehouse max ${maxStored}/${ws.capacity} | ` +
      `orders on time ${ws.ordersOnTime} late ${ws.ordersLate} | trips ${w.stats.trips} | most trucks at once ${maxTrucks} | ` +
      `longest wait at the gate ${maxGate.toFixed(0)} s`,
  );
  assert.ok(s.sold > 300, 'stores should sell');
  assert.ok(lostPct < 15, 'stores should rarely run out');
  assert.ok(maxStored <= ws.capacity * 0.9, 'warehouse should never overflow');
  assert.ok(maxTrucks <= 4 * (w.factories.length + w.stores.length), 'no unnecessary trucks');
  assert.ok(maxFleet <= w.settings.trucksPerFactory, 'a factory has no more trucks than allowed');
  assert.ok(maxGate < 120, 'trucks should not wait long at the warehouse gate');
  assert.ok(firstMinute <= Math.ceil(w.factories.length / 2) + 1, 'factories should not all send trucks at the start');
}
console.log('all good');

// Every random map must connect every site to the warehouse and the depot.
for (let seed = 1; seed <= 200; seed++) {
  for (const [factories, stores] of [[3, 3], [8, 8], [3, 8], [8, 3]]) {
    const w = new World({ seed, factories, stores });
    const P = w.map.paths;
    for (const f of w.factories) { P.factoryToWarehouse(f, 0); P.warehouseToGarage(f); }
    for (const s of w.stores) { P.laneToStore(w.lanes[0].x, s); P.storeToDepot(s); }
    P.depotToLane(w.lanes[0].x);
  }
}
console.log('800 random maps: every road connects');
