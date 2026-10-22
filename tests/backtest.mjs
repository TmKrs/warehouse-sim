// Long backtest: many random maps and settings, several simulated days each.
// Checks that the whole chain keeps running: no truck crashes or jams, the
// warehouse never overflows, and stores rarely run out.
// Run with: npm run backtest (takes a few minutes). Optional: node tests/backtest.mjs <runs> <days>
import { World, CLOCK_SPEED } from '../src/sim/world.js';
import { TICK } from '../src/sim/sim.js';
import { makeRng } from '../src/sim/random.js';
import { yardPose } from '../src/sim/yard.js';

const runs = Number(process.argv[2] ?? 12);
const days = Number(process.argv[3] ?? 5);
const pick = makeRng(2026);
const touching = (a, b) => {
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
};

let failed = 0;
console.log(`${runs} runs, ${days} days each`);
for (let r = 0; r < runs; r++) {
  const settings = {
    seed: pick.int(1, 1e6),
    factories: pick.int(3, 8),
    stores: pick.int(3, 8),
    robots: pick.int(6, 16),
    customersPerHour: pick.int(6, 30),
    targetFill: pick.pick([0.6, 0.7, 0.8, 0.9]),
    trucksPerFactory: pick.pick([1, 2, 2, 3]),
  };
  const w = new World(settings);
  const ticks = Math.round((days * 86400) / CLOCK_SPEED / TICK);
  let crashes = 0;
  let maxWait = 0;
  let maxTrucks = 0;
  let maxStored = 0;
  let yardCrashes = 0;
  let maxFleet = 0;
  const t0 = Date.now();
  for (let i = 0; i < ticks; i++) {
    w.step();
    for (let a = 0; a < w.trucks.length; a++) {
      const A = w.trucks[a];
      maxWait = Math.max(maxWait, A.waited);
      for (let b = a + 1; b < w.trucks.length; b++) {
        const B = w.trucks[b];
        if (Math.hypot(A.x - B.x, A.z - B.z) < 12 && touching(A, B)) crashes++;
      }
    }
    // Trucks in the warehouse's parking lot, at its docks and at the exit.
    const Y = w.sim.yardPlan;
    const yard = w.sim.trucks
      .filter((t) => t.status !== 'planned' && (t.status !== 'gone' || t.atExit))
      .map((t) => { const p = yardPose(Y, t, w.time - t.statusSince); return { x: p.x, z: p.z, heading: p.h }; });
    for (let a = 0; a < yard.length; a++) {
      for (let b = a + 1; b < yard.length; b++) {
        if (Math.hypot(yard[a].x - yard[b].x, yard[a].z - yard[b].z) < 12 && touching(yard[a], yard[b])) yardCrashes++;
      }
    }
    for (const f of w.factories) maxFleet = Math.max(maxFleet, w.fleetInUse(f));
    maxTrucks = Math.max(maxTrucks, w.trucks.length);
    maxStored = Math.max(maxStored, w.sim.stored);
  }
  const s = w.summary();
  const lost = (100 * s.lost) / Math.max(1, s.sold + s.lost);
  const problems = [];
  if (crashes) problems.push(`${crashes} truck crashes`);
  if (yardCrashes) problems.push(`${yardCrashes} overlaps in the warehouse yard`);
  if (maxFleet > settings.trucksPerFactory) problems.push(`a factory had ${maxFleet} trucks out`);
  // Queues are normal in heavy traffic; a wait this long would mean a jam.
  if (maxWait >= 300) problems.push(`a truck waited ${maxWait.toFixed(0)} s`);
  if (maxStored > w.sim.capacity * 0.95) problems.push('warehouse overflow');
  if (lost > 15) problems.push(`${lost.toFixed(1)}% missed sales`);
  if (maxTrucks > 4 * (settings.factories + settings.stores)) problems.push(`${maxTrucks} trucks at once`);
  if (problems.length) failed++;
  console.log(
    `${problems.length ? 'FAIL' : 'ok  '} ${JSON.stringify(settings)} | ${((Date.now() - t0) / 1000).toFixed(0)} s | ` +
      `sold ${s.sold}, missed ${lost.toFixed(1)}% | longest truck wait ${maxWait.toFixed(0)} s | most trucks ${maxTrucks} | ` +
      `warehouse max ${maxStored}/${w.sim.capacity}${problems.length ? ' | ' + problems.join(', ') : ''}`,
  );
}
console.log(failed ? `${failed} of ${runs} runs had problems` : 'all runs ok');
process.exit(failed ? 1 : 0);
