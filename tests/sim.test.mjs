// Runs the warehouse for a long time without graphics and checks that
// robots never crash, nothing gets stuck, and the warehouse never overflows.
// Run with: node tests/sim.test.mjs
import assert from 'node:assert/strict';
import { Sim, TICK } from '../src/sim/sim.js';

function run({ seed, minutes, robots = 10, ...rest }) {
  const sim = new Sim({ seed, robots, ...rest });
  const ticks = Math.round((minutes * 60) / TICK);
  let maxStored = 0;
  const lastProgress = new Map();
  const t0 = Date.now();
  for (let i = 0; i < ticks; i++) {
    sim.step();
    const seen = new Map();
    for (const r of sim.robots) {
      assert.ok(!seen.has(r.cell), `tick ${sim.tick}: ${r.name} and ${seen.get(r.cell)} in the same cell`);
      seen.set(r.cell, r.name);
    }
    for (const a of sim.robots) {
      for (const b of sim.robots) {
        if (a !== b && a.cell === b.prev && b.cell === a.prev && a.cell !== a.prev) {
          assert.fail(`tick ${sim.tick}: ${a.name} and ${b.name} swapped places`);
        }
      }
    }
    for (const r of sim.robots) {
      const key = `${r.mode}:${r.cell}:${r.task?.i}:${r.task?.box}`;
      const last = lastProgress.get(r.id);
      if (!last || last.key !== key || r.mode === 'idle') lastProgress.set(r.id, { key, tick: sim.tick });
      else assert.ok(sim.tick - last.tick < 600, `${r.name} stuck for 3 minutes at tick ${sim.tick} (${key})`);
    }
    maxStored = Math.max(maxStored, sim.stored);
  }
  const s = sim.summary();
  return { s, maxStored, ms: Date.now() - t0, sim };
}

for (const seed of [1, 7, 42]) {
  const { s, maxStored, ms } = run({ seed, minutes: 60 });
  const shipped = s.ordersOnTime + s.ordersLate;
  console.log(
    `seed ${seed}: ${ms} ms | stored ${s.stored}/${s.capacity} (max ${maxStored}) | boxes in ${s.boxesIn} out ${s.boxesOut} | ` +
      `orders on time ${s.ordersOnTime} late ${s.ordersLate} open ${s.openOrders} (backorder lines ${s.backorderLines}) | ` +
      `trucks ${s.trucksDone} (late ${s.trucksLate}, yard ${s.trucksWaiting}) | wait ${(100 * s.waitTicks / (s.waitTicks + s.moveTicks)).toFixed(1)}%`,
  );
  assert.ok(maxStored <= s.capacity * 0.9, 'warehouse should never overflow');
  assert.ok(shipped > 100, 'orders should flow');
  assert.ok(s.ordersOnTime > s.ordersLate, 'most orders should be on time');
}

// Many robots in the same space: still no crashes or gridlock.
const busy = run({ seed: 3, minutes: 30, robots: 16, ordersPerMinute: 10, truckEverySeconds: 30 });
console.log(`16 robots: ${busy.ms} ms | shipped ${busy.s.ordersOnTime + busy.s.ordersLate} | stored ${busy.s.stored}`);
console.log('all good');
