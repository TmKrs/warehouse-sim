// Traffic planner for the robots ("cooperative A*").
//
// Time moves in ticks. Each robot books the cells it will use on its way,
// one booking per (cell, tick). A new route may only use cells nobody has
// booked at that tick, and two robots may never swap cells head-on. Once a
// robot reaches its goal it "holds" that cell until it plans its next trip.
// Because every robot follows its booking exactly, robots never crash.

const INF = 0xffff;

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Lower f first; on ties prefer nodes closer to the goal.
function less(x, y) {
  return x.f < y.f || (x.f === y.f && x.h < y.h);
}

export class Planner {
  constructor(layout) {
    this.L = layout;
    this.N = layout.N;
    this.neighbors = [];
    for (let c = 0; c < this.N; c++) {
      const list = [];
      if (layout.walkable(c)) {
        const x = layout.xOf(c);
        const z = layout.zOf(c);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= layout.W || nz >= layout.D) continue;
          const n = layout.idx(nx, nz);
          if (layout.walkable(n)) list.push(n);
        }
      }
      this.neighbors.push(list);
    }
    this.bookings = new Map(); // tick * N + cell -> robot id
    this.cellBookings = Array.from({ length: this.N }, () => []); // per cell: [tick, id, tick, id, ...]
    this.owned = new Map(); // robot id -> [cell, tick, cell, tick, ...]
    this.holder = new Int32Array(this.N).fill(-1); // robot holding the cell after arriving
    this.holdFrom = new Float64Array(this.N);
    this.distCache = new Map();
  }

  // Walking distance from every cell to `goal`, ignoring other robots.
  dist(goal) {
    let d = this.distCache.get(goal);
    if (d) return d;
    d = new Uint16Array(this.N).fill(INF);
    d[goal] = 0;
    const queue = [goal];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      for (const n of this.neighbors[c]) {
        if (d[n] === INF) {
          d[n] = d[c] + 1;
          queue.push(n);
        }
      }
    }
    this.distCache.set(goal, d);
    return d;
  }

  isFree(cell, tick, id) {
    const b = this.bookings.get(tick * this.N + cell);
    if (b !== undefined && b !== id) return false;
    const h = this.holder[cell];
    return !(h !== -1 && h !== id && this.holdFrom[cell] <= tick);
  }

  // True if a move a -> b during tick -> tick+1 would swap places with another robot.
  isSwap(a, b, tick, id) {
    const other = this.bookings.get(tick * this.N + b);
    return other !== undefined && other !== id && this.bookings.get((tick + 1) * this.N + a) === other;
  }

  // Latest tick at which anyone other than `id` has booked `cell`.
  lastBookingByOthers(cell, id) {
    const list = this.cellBookings[cell];
    let last = -1;
    for (let i = 0; i < list.length; i += 2) {
      if (list[i + 1] !== id && list[i] > last) last = list[i];
    }
    return last;
  }

  // Find a collision-free route. Returns the list of cells, one per tick
  // starting at `t0`, or null if no route was found right now.
  plan(id, start, t0, goal, { maxDepth = 260, maxExpand = 14000 } = {}) {
    const h = this.holder[goal];
    if (h !== -1 && h !== id) return null;
    const dist = this.dist(goal);
    if (dist[start] === INF) return null;
    if (this.lastBookingByOthers(goal, id) > t0 + maxDepth) return null;

    const open = new MinHeap();
    const seen = new Set();
    open.push({ cell: start, t: t0, f: dist[start], h: dist[start], parent: null });
    seen.add(start);
    let expanded = 0;
    while (open.size && expanded < maxExpand) {
      const node = open.pop();
      expanded++;
      if (node.cell === goal && this.lastBookingByOthers(goal, id) < node.t) {
        const cells = [];
        for (let n = node; n; n = n.parent) cells.push(n.cell);
        return cells.reverse();
      }
      const nt = node.t + 1;
      if (nt - t0 > maxDepth) continue;
      const options = [node.cell, ...this.neighbors[node.cell]];
      for (const next of options) {
        const key = (nt - t0) * this.N + next;
        if (seen.has(key)) continue;
        if (!this.isFree(next, nt, id)) continue;
        if (next !== node.cell && this.isSwap(node.cell, next, node.t, id)) continue;
        seen.add(key);
        const g = nt - t0;
        open.push({ cell: next, t: nt, f: g + dist[next], h: dist[next], parent: node });
      }
    }
    return null;
  }

  // Remove every booking of robot `id` from tick `fromTick` on, and its hold.
  release(id, fromTick) {
    const list = this.owned.get(id) || [];
    const keep = [];
    for (let i = 0; i < list.length; i += 2) {
      const cell = list[i];
      const t = list[i + 1];
      if (t >= fromTick) this.unbook(cell, t, id);
      else keep.push(cell, t);
    }
    this.owned.set(id, keep);
    for (let c = 0; c < this.N; c++) {
      if (this.holder[c] === id) this.holder[c] = -1;
    }
  }

  // Book a planned route and hold its last cell.
  commit(id, cells, t0) {
    let list = this.owned.get(id);
    if (!list) this.owned.set(id, (list = []));
    cells.forEach((cell, i) => {
      const t = t0 + i;
      this.bookings.set(t * this.N + cell, id);
      this.cellBookings[cell].push(t, id);
      list.push(cell, t);
    });
    this.hold(id, cells[cells.length - 1], t0 + cells.length - 1);
  }

  hold(id, cell, fromTick) {
    this.holder[cell] = id;
    this.holdFrom[cell] = fromTick;
  }

  unbook(cell, t, id) {
    const key = t * this.N + cell;
    if (this.bookings.get(key) === id) this.bookings.delete(key);
    const list = this.cellBookings[cell];
    for (let i = 0; i < list.length; i += 2) {
      if (list[i] === t && list[i + 1] === id) {
        list.splice(i, 2);
        break;
      }
    }
  }

  // Forget bookings that lie in the past.
  forgetBefore(tick) {
    for (const [id, list] of this.owned) {
      const keep = [];
      for (let i = 0; i < list.length; i += 2) {
        if (list[i + 1] < tick) this.unbook(list[i], list[i + 1], id);
        else keep.push(list[i], list[i + 1]);
      }
      this.owned.set(id, keep);
    }
  }
}
