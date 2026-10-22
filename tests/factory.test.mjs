// Runs the chain for a day and checks the factory insides: forklifts never
// crash into each other, nobody leaves the hall, and the boxes on the factory
// floor always add up to the factory's stock.
// Run with: node tests/factory.test.mjs
import assert from 'node:assert/strict';
import { World, CLOCK_SPEED } from '../src/sim/world.js';
import { TICK } from '../src/sim/sim.js';
import { FLOOR } from '../src/sim/factoryFloor.js';

for (const settings of [{ seed: 7 }, { seed: 3, factories: 8, stores: 8, robots: 16 }]) {
  const w = new World(settings);
  const ticks = Math.round(86400 / CLOCK_SPEED / TICK);
  const t0 = Date.now();
  let minGap = Infinity;
  let maxDiff = 0;
  let maxShown = 0;
  let pickups = 0;
  let deliveries = 0;
  const wasLoaded = w.floors.map((fl) => fl.forklifts.map(() => 0));
  for (let i = 0; i < ticks; i++) {
    w.step();
    w.floors.forEach((fl, k) => {
      const f = w.factories[k];
      const inHall = (o, name) => {
        assert.ok(Number.isFinite(o.u) && Number.isFinite(o.v) && Number.isFinite(o.heading), `${name} has no position`);
        assert.ok(Math.abs(o.u) <= FLOOR.halfWidth && o.v >= f.faceV && o.v <= f.faceV + FLOOR.depth,
          `${name} left the hall of ${f.name} at ${o.u.toFixed(1)},${(o.v - f.faceV).toFixed(1)}`);
      };
      fl.forklifts.forEach((a, n) => {
        inHall(a, `forklift ${n}`);
        assert.ok(Number.isFinite(a.fork), 'fork height is a number');
        for (const b of fl.forklifts) {
          if (b === a) continue;
          const d = Math.hypot(a.u - b.u, a.v - b.v);
          minGap = Math.min(minGap, d);
          assert.ok(d > 1.5, `forklifts crashed in ${f.name} at tick ${i}`);
        }
        const had = wasLoaded[k][n];
        if (!had && a.load.length) pickups++;
        if (had && !a.load.length) deliveries++;
        wasLoaded[k][n] = a.load.length;
      });
      fl.workers.forEach((p, n) => {
        inHall(p, `worker ${n}`);
        assert.ok(Number.isFinite(p.phase), 'walking phase is a number');
      });
      for (const view of fl.lines) for (const b of view.belt) assert.ok(Number.isFinite(b.x), 'box on belt has a position');
      // A truck that started loading after the floor's turn this tick is seen next tick.
      let stock = f.stock.reduce((a, b) => a + b, 0);
      for (const po of f.orders) if (po.status === 'loading' && !fl.seenPo.includes(po.id)) stock += po.items.length;
      maxDiff = Math.max(maxDiff, Math.abs(fl.totalStock() - stock));
      // Boxes sold to a waiting truck stay in the racks until a forklift fetches them.
      const reserved = fl.rows.reduce((a, r) => a + r.reserved, 0);
      maxShown = Math.max(maxShown, Math.abs(fl.storedBoxes() - reserved - stock));
      for (const r of fl.rows) assert.ok(r.count >= r.reserved && r.reserved >= 0, 'rack count never below what is reserved');
    });
  }
  console.log(
    `${w.factories.length} factories: ${Date.now() - t0} ms | closest forklifts ${minGap.toFixed(2)} m | ` +
      `floor vs stock off by at most ${maxDiff} | racks vs stock off by at most ${maxShown} | ` +
      `forklift pickups ${pickups}, drop-offs ${deliveries}`,
  );
  assert.ok(maxDiff <= 1, 'the floor mirrors the factory stock');
  // The rest are on belts, pallets and forklifts on their way to the racks.
  assert.ok(maxShown <= 60, 'the racks roughly show the factory stock');
  assert.ok(pickups > 50 && deliveries > 50, 'forklifts keep busy');
}
console.log('factory floors ok');
