// The truck yard in front of the warehouse: a parking lot with drive-through
// stalls, and the routes between the gate, the stalls, the docks and the exit.
//
//   gate ──▶ entry lane ──▶ turn into a free stall (nose north) and wait
//   stall ──▶ pull out north ──▶ exit lane east ──▶ reverse into the dock
//   dock ──▶ pull out north ──▶ leaving lane east ──▶ yard exit
//
// Every truck moves along a fixed route at a fixed speed, so the sim knows how
// long each move takes and the 3D view can draw the truck anywhere on it.
// Routes trace the rear axle, like a real trailer: the rear follows the road
// and the cab swings wide on the outside of a turn. Poses are truck centres;
// heading h means the truck points along (cos h, sin h).

export const STALLS = 8;
const HALF = 5.5; // truck centre to its rear doors
const AXLE = 1.8; // rear doors to the rear axle
const AHEAD = HALF - AXLE; // rear axle to the truck centre
const TURN = 6; // turning radius in the yard
const FORWARD = 6; // m/s
const SLOW = 4; // m/s, pulling into a stall
const REVERSE = 3; // m/s

export class Yard {
  constructor(C, docks) {
    this.dockZ = C.frontZ - 1.6; // where the rear doors stop
    // Where the road hands trucks over (truck centres, matching sim/map.js).
    this.gate = { x: -C.width / 2 - 40 + HALF, z: C.frontZ - 25.5 };
    this.exit = { x: C.rightX + 30 + HALF, z: this.dockZ - 16 };
    // Stalls sit well back from the entry lane so a turning cab clears the parked trucks.
    this.stallZ = this.gate.z - 20; // stall centre
    this.exitLaneZ = this.stallZ - HALF - 4;
    this.stallX = [];
    for (let i = 0; i < STALLS; i++) this.stallX.push(C.leftX - 26.5 + 4.2 * i);
    this.dockX = docks.map((d) => C.x(d.x));
    this.cache = new Map();
  }

  // Gate to stall: along the entry lane, then a left turn into the stall.
  park(stall) {
    return this.route(`p${stall}`, () => {
      const x = this.stallX[stall];
      const z = this.gate.z;
      return [
        line({ x: this.gate.x - AHEAD, z }, { x: x - TURN, z }, FORWARD),
        curve({ x: x - TURN, z }, { x, z }, { x, z: z - TURN }, SLOW),
        line({ x, z: z - TURN }, { x, z: this.stallZ + AHEAD }, SLOW),
      ];
    });
  }

  // Stall to dock: out of the stall, east on the exit lane, then back up to the dock.
  dock(stall, dock) {
    return this.route(`d${stall}-${dock}`, () => {
      const x = this.stallX[stall];
      const dx = this.dockX[dock];
      const lane = this.exitLaneZ;
      const swing = 14;
      return [
        line({ x, z: this.stallZ + AHEAD }, { x, z: lane + TURN }, SLOW),
        curve({ x, z: lane + TURN }, { x, z: lane }, { x: x + TURN, z: lane }, FORWARD),
        line({ x: x + TURN, z: lane }, { x: dx + swing, z: lane }, FORWARD),
        curve({ x: dx + swing, z: lane }, { x: dx, z: lane }, { x: dx, z: lane + 12 }, REVERSE, true),
        line({ x: dx, z: lane + 12 }, { x: dx, z: this.dockZ - AXLE }, REVERSE, true),
      ];
    });
  }

  // Dock to exit: pull forward, turn right onto the leaving lane and drive off.
  leave(dock) {
    return this.route(`l${dock}`, () => {
      const dx = this.dockX[dock];
      const z = this.exit.z;
      return [
        line({ x: dx, z: this.dockZ - AXLE }, { x: dx, z: z + TURN }, SLOW),
        curve({ x: dx, z: z + TURN }, { x: dx, z }, { x: dx + TURN, z }, FORWARD),
        line({ x: dx + TURN, z }, { x: this.exit.x - AHEAD, z }, FORWARD),
      ];
    });
  }

  // Where a truck stands when it is parked, docked or waiting at the exit.
  stallPose(stall) {
    return { x: this.stallX[stall], z: this.stallZ, h: -Math.PI / 2 };
  }

  dockPose(dock) {
    return { x: this.dockX[dock], z: this.dockZ - HALF, h: -Math.PI / 2 };
  }

  exitPose() {
    return { ...this.exit, h: 0 };
  }

  route(key, build) {
    let r = this.cache.get(key);
    if (!r) {
      r = makeRoute(build());
      this.cache.set(key, r);
    }
    return r;
  }
}

// Where a warehouse truck is, `since` seconds after its status last changed.
export function yardPose(Y, t, since) {
  if (t.status === 'yard') return since < t.moveTime ? onRoute(Y.park(t.stall), since) : Y.stallPose(t.stall);
  if (t.status === 'docking') return onRoute(Y.dock(t.stall, t.dock), since);
  if (t.status === 'unloading') return Y.dockPose(t.dock);
  if (t.status === 'leaving') return onRoute(Y.leave(t.dock), since);
  return Y.exitPose();
}

// The truck's centre, a little ahead of the rear axle that follows the route.
function onRoute(route, t) {
  const p = sample(route, t);
  return { x: p.x + Math.cos(p.h) * AHEAD, z: p.z + Math.sin(p.h) * AHEAD, h: p.h };
}

// ---------- routes ----------
function line(a, b, speed, rev = false) {
  return { pts: [a, b], speed, rev };
}

// A quadratic curve from a to b that leaves a towards c and arrives at b from c.
function curve(a, c, b, speed, rev = false) {
  const pts = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z });
  }
  return { pts, speed, rev };
}

// Flattens the pieces into short steps, each with its start time.
function makeRoute(pieces) {
  const steps = [];
  let time = 0;
  for (const p of pieces) {
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1];
      const b = p.pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      let h = Math.atan2(b.z - a.z, b.x - a.x);
      if (p.rev) h += Math.PI;
      steps.push({ a, b, h, t0: time, dur: len / p.speed, rev: p.rev });
      time += len / p.speed;
    }
  }
  // The moment the truck starts its last straight reverse: from then on it only
  // moves inside its own dock lane.
  let clear = time;
  for (let i = steps.length - 1; i >= 0 && steps[i].rev && Math.abs(steps[i].a.x - steps[i].b.x) < 1e-6; i--) clear = steps[i].t0;
  return { steps, time, clear };
}

// Position and heading `t` seconds into a route.
export function sample(route, t) {
  const { steps } = route;
  if (t <= 0) return pose(steps[0], 0);
  if (t >= route.time) return pose(steps[steps.length - 1], 1);
  let lo = 0;
  let hi = steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (steps[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return pose(steps[lo], (t - steps[lo].t0) / steps[lo].dur);
}

function pose(s, f) {
  return { x: s.a.x + (s.b.x - s.a.x) * f, z: s.a.z + (s.b.z - s.a.z) * f, h: s.h };
}
