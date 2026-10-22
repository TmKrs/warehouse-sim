// Runs the whole supply chain for a few warehouse days without graphics and
// checks that goods flow from factories through the warehouse to the stores,
// that robots never crash, and that trucks never pile up.
// Run with: node tests/world.test.mjs
import assert from 'node:assert/strict';
import { World, CLOCK_SPEED } from '../src/sim/world.js';
import { TICK } from '../src/sim/sim.js';

function run(settings, days) {
  const w = new World(settings);
  const ticks = Math.round((days * 86400) / CLOCK_SPEED / TICK);
  let maxTrucks = 0;
  let maxStored = 0;
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
    maxTrucks = Math.max(maxTrucks, w.trucks.length);
    maxStored = Math.max(maxStored, w.sim.stored);
  }
  return { w, ms: Date.now() - t0, maxTrucks, maxStored };
}

for (const [label, settings] of [
  ['3 factories, 3 stores', { seed: 7 }],
  ['8 factories, 8 stores, 16 robots', { seed: 3, factories: 8, stores: 8, robots: 16, customersPerHour: 20 }],
  ['3 factories, 8 stores', { seed: 11, factories: 3, stores: 8 }],
]) {
  const { w, ms, maxTrucks, maxStored } = run(settings, 3);
  const s = w.summary();
  const ws = w.sim.summary();
  const lostPct = (100 * s.lost) / Math.max(1, s.sold + s.lost);
  console.log(
    `${label}: ${ms} ms | sold ${s.sold}, lost ${s.lost} (${lostPct.toFixed(1)}%) | warehouse max ${maxStored}/${ws.capacity} | ` +
      `orders on time ${ws.ordersOnTime} late ${ws.ordersLate} | trips ${w.stats.trips} | most trucks at once ${maxTrucks}`,
  );
  assert.ok(s.sold > 300, 'stores should sell');
  assert.ok(lostPct < 15, 'stores should rarely run out');
  assert.ok(maxStored <= ws.capacity * 0.9, 'warehouse should never overflow');
  assert.ok(maxTrucks <= 4 * (w.factories.length + w.stores.length), 'no unnecessary trucks');
}
console.log('all good');
