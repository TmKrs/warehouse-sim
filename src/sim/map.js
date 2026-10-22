// The region around the warehouse: factories, stores, a truck depot and the
// roads between them. Everything is in metres with the warehouse at (0, 0).
//
// A ring road runs around the warehouse. Factories and stores sit at random
// spots outside the ring, on any side, some closer and some further back.
// Trucks drive on the right. The ring is a graph; the access and service
// roads inside each site are fixed one-way loops added to a truck's route.

const LANE = 1.9; // offset of each driving lane from the road centre
export const TRUCK_HALF = 5.5; // centre of a truck to its rear doors

// Every site is laid out the same way in its own frame: u runs along the ring
// road, v points away from it. Access roads at u = ±25 lead to a service road
// in front of the building; trucks enter on the left, leave on the right.
const ACCESS = 25;
const SERVICE = 32; // service road distance from the ring (plus the setback)
const SITE_LEFT = -60; // footprint along the road, including the garage
const SITE_RIGHT = 30;
export const SITE_DEPTH = { factory: 24, store: 22 };

export function buildMap(C, factoryCount, storeCount, rng) {
  // The ring starts small and grows until every site finds a free spot.
  const total = factoryCount + storeCount;
  for (let grow = 0; ; grow += 10) {
    const map = tryBuild(C, factoryCount, storeCount, rng, 125 + grow, 110 + grow);
    if (map) return map;
  }
}

function tryBuild(C, factoryCount, storeCount, rng, RX, RZ) {
  // Warehouse hand-over points, matching the yard animation in render/trucks.js.
  const dockZ = C.frontZ - 1.6;
  const yardIn = { x: -C.width / 2 - 40, z: C.frontZ - 30 + 4.5 };
  const yardOut = { x: C.rightX + 30, z: dockZ - 16 };
  const backYardZ = C.backZ + 20;
  const westLinkX = C.leftX - 20;
  const eastLinkX = C.rightX + 25;

  // The four sides of the ring. `along` gives a world point for a distance
  // along the side, `V` points away from the warehouse, `U` along the road.
  const sides = [
    { name: 'north', V: [0, -1], start: [-RX, -RZ], len: 2 * RX, keepOut: [yardIn.x - 15, yardOut.x + 15] },
    { name: 'east', V: [1, 0], start: [RX, -RZ], len: 2 * RZ, keepOut: [RZ] },
    { name: 'south', V: [0, 1], start: [RX, RZ], len: 2 * RX, keepOut: [westLinkX, eastLinkX, RX] },
    { name: 'west', V: [-1, 0], start: [-RX, RZ], len: 2 * RZ, keepOut: [] },
  ];
  for (const s of sides) {
    s.U = [-s.V[1], s.V[0]];
    s.at = (t) => ({ x: s.start[0] + s.U[0] * t, z: s.start[1] + s.U[1] * t });
    // Distance along the side for a world x (north/south) or z (east/west).
    s.tOf = (x, z) => (s.U[0] !== 0 ? (x - s.start[0]) / s.U[0] : (z - s.start[1]) / s.U[1]);
    s.taken = s.keepOut.map((v) => {
      const t = s.U[0] !== 0 ? s.tOf(v, 0) : s.tOf(0, v);
      // Wide enough that every crossing on the ring is at least 50 m from the next.
      return [t - 38, t + 38];
    });
  }

  // Place every site at a random free spot on a random side.
  const kinds = [...Array(factoryCount).fill('factory'), ...Array(storeCount).fill('store')];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const placed = [];
  for (const kind of kinds) {
    let spot = null;
    for (let attempt = 0; attempt < 400 && !spot; attempt++) {
      const side = sides[Math.floor(rng.next() * 4)];
      // Keep the site's road crossings at least 50 m from the corners.
      const t = 75 + rng.next() * (side.len - 150);
      const lo = t + SITE_LEFT - 8;
      const hi = t + SITE_RIGHT + 8;
      if (side.taken.some(([a, b]) => hi > a && lo < b)) continue;
      side.taken.push([lo, hi]);
      spot = { side, t, setback: Math.round(rng.next() * 45) };
    }
    if (!spot) return null;
    placed.push({ kind, ...spot });
  }

  // ---------- road graph ----------
  const nodes = [];
  const edges = [];
  const key = new Map();
  const node = (x, z) => {
    const k = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    if (!key.has(k)) {
      key.set(k, nodes.length);
      nodes.push({ id: nodes.length, x, z, adj: [] });
    }
    return key.get(k);
  };
  const edge = (a, b) => {
    if (a === b) return;
    const A = nodes[a];
    const B = nodes[b];
    const len = Math.hypot(A.x - B.x, A.z - B.z);
    A.adj.push({ to: b, len });
    B.adj.push({ to: a, len });
    edges.push([a, b]);
  };
  const sidePoints = sides.map(() => [0]);

  // A site's frame: world point for (u, v).
  const frame = (side, t, setback) => {
    const o = side.at(t);
    const toWorld = (u, v) => ({ x: o.x + side.U[0] * u + side.V[0] * v, z: o.z + side.U[1] * u + side.V[1] * v });
    return { origin: o, toWorld, setback, angle: Math.atan2(-side.V[0], -side.V[1]), U: side.U, V: side.V };
  };

  const factories = [];
  const stores = [];
  for (const p of placed) {
    const si = sides.indexOf(p.side);
    sidePoints[si].push(p.t - ACCESS, p.t + ACCESS);
    const fr = frame(p.side, p.t, p.setback);
    const serviceV = SERVICE + p.setback;
    const faceV = serviceV + 16;
    const depth = SITE_DEPTH[p.kind];
    const centre = fr.toWorld(0, faceV + depth / 2);
    const site = {
      ...fr, kind: p.kind, side: p.side.name, serviceV, faceV, depth,
      x: centre.x, z: centre.z,
      west: { t: p.t - ACCESS, si },
      east: { t: p.t + ACCESS, si },
    };
    if (p.kind === 'factory') {
      site.docks = [-7, 7].map((u) => ({ u }));
      site.garageU = -42;
      site.id = factories.length;
      factories.push(site);
    } else {
      site.dockU = -8;
      site.id = stores.length;
      stores.push(site);
    }
  }
  // Warehouse junctions on the ring.
  const north = 0;
  const south = 2;
  for (const x of [yardIn.x - 15, yardOut.x + 15]) sidePoints[north].push(sides[north].tOf(x, 0));
  for (const x of [westLinkX, eastLinkX]) sidePoints[south].push(sides[south].tOf(x, 0));
  // Build the ring: corners plus every junction, in order.
  const sideNodes = sides.map((s, i) => {
    const ts = [...new Set([...sidePoints[i], s.len])].sort((a, b) => a - b);
    const ids = ts.map((t) => {
      const p = s.at(t);
      return node(p.x, p.z);
    });
    for (let k = 1; k < ids.length; k++) edge(ids[k - 1], ids[k]);
    return { ts, ids };
  });
  const nodeAt = (si, t) => {
    const p = sides[si].at(t);
    return node(p.x, p.z);
  };
  for (const s of [...factories, ...stores]) {
    s.westNode = nodeAt(s.west.si, s.west.t);
    s.eastNode = nodeAt(s.east.si, s.east.t);
  }
  const inJunction = node(yardIn.x - 15, -RZ);
  const outJunction = node(yardOut.x + 15, -RZ);
  const westLink = node(westLinkX, RZ);
  const eastLink = node(eastLinkX, RZ);
  const depotNode = node(RX, RZ);
  const depot = { x: RX + 22, z: RZ + 16 };
  // The depot road has a lane each way: out on one side, back on the other.
  const depotDir = (() => {
    const dx = RX - depot.x;
    const dz = RZ - depot.z;
    const len = Math.hypot(dx, dz);
    return { x: dx / len, z: dz / len };
  })();
  const depotLane = (p, sign) => ({ x: p.x - depotDir.z * LANE * sign, z: p.z + depotDir.x * LANE * sign });
  void sideNodes;

  // Shortest route between two graph nodes (Dijkstra).
  const route = (from, to) => {
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = [from];
    const done = new Set();
    while (open.length) {
      open.sort((a, b) => dist.get(a) - dist.get(b));
      const n = open.shift();
      if (n === to) break;
      if (done.has(n)) continue;
      done.add(n);
      for (const { to: m, len } of nodes[n].adj) {
        const d = dist.get(n) + len;
        if (!dist.has(m) || d < dist.get(m)) {
          dist.set(m, d);
          prev.set(m, n);
          open.push(m);
        }
      }
    }
    const ids = [to];
    if (from !== to && !prev.has(to)) throw new Error(`No road from node ${from} to ${to}`);
    while (ids[0] !== from) ids.unshift(prev.get(ids[0]));
    return ids.map((id) => ({ x: nodes[id].x, z: nodes[id].z, road: true }));
  };

  // Move road points to the right-hand lane.
  const keepRight = (pts) => {
    const out = pts.map((p) => ({ ...p }));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      let rx = -dz;
      let rz = dx;
      if (i > 0 && i < pts.length - 1) {
        const ux = pts[i].x - a.x;
        const uz = pts[i].z - a.z;
        const vx = b.x - pts[i].x;
        const vz = b.z - pts[i].z;
        const lu = Math.hypot(ux, uz) || 1;
        const lv = Math.hypot(vx, vz) || 1;
        const n1 = [-uz / lu, ux / lu];
        const n2 = [-vz / lv, vx / lv];
        rx = n1[0] + n2[0];
        rz = n1[1] + n2[1];
        const ln = Math.hypot(rx, rz) || 1;
        const cos = (n1[0] * rx + n1[1] * rz) / ln;
        rx = rx / ln / Math.max(0.5, cos);
        rz = rz / ln / Math.max(0.5, cos);
      }
      out[i].x += rx * LANE;
      out[i].z += rz * LANE;
    }
    return out;
  };
  const drive = (fromNode, toNode) => keepRight(route(fromNode, toNode));

  // ---------- routes; each point is where the truck's centre goes ----------
  const site = (p, extra = {}) => ({ x: p.x, z: p.z, site: true, ...extra });
  // Into a site: access road, along the service road past the dock, then back in.
  const intoSite = (s, dockU) => [
    site(s.toWorld(-ACCESS, 0)),
    site(s.toWorld(-ACCESS, s.serviceV)),
    site(s.toWorld(dockU + 13, s.serviceV)),
    site(s.toWorld(dockU, s.faceV - TRUCK_HALF - 0.4), { rev: true, dock: true }),
  ];
  // Out of a site: forward to the service road, along it and up the exit road.
  const outOfSite = (s, dockU) => [
    site(s.toWorld(dockU + 2, s.serviceV)),
    site(s.toWorld(ACCESS, s.serviceV)),
    site(s.toWorld(ACCESS, 0)),
  ];

  const paths = {
    garageStart(f) {
      // Out of the garage on the right-hand lane (right of +u is -v).
      const p = f.toWorld(f.garageU - 6, f.serviceV - LANE);
      return { x: p.x, z: p.z, heading: Math.atan2(f.U[1], f.U[0]) };
    },
    garageToDock(f, d) {
      const u = f.docks[d].u;
      return [
        site(f.toWorld(u + 13, f.serviceV)),
        site(f.toWorld(u, f.faceV - TRUCK_HALF - 0.4), { rev: true, dock: true }),
      ];
    },
    factoryToWarehouse(f, d) {
      return [
        ...outOfSite(f, f.docks[d].u),
        ...drive(f.eastNode, inJunction),
        site({ x: yardIn.x - 15, z: yardIn.z }),
        site({ x: yardIn.x + TRUCK_HALF, z: yardIn.z }, { handoff: true }),
      ];
    },
    warehouseToGarage(f) {
      return [
        site({ x: yardOut.x + 15, z: yardOut.z }),
        ...drive(outJunction, f.westNode),
        site(f.toWorld(-ACCESS, 0)),
        site(f.toWorld(-ACCESS, f.serviceV)),
        site(f.toWorld(f.garageU + 8, f.serviceV + LANE)),
        site(f.toWorld(f.garageU, f.serviceV + LANE), { end: true }),
      ];
    },
    depotStart() {
      const p = depotLane(depot, 1);
      return { x: p.x, z: p.z, heading: Math.atan2(depotDir.z, depotDir.x) };
    },
    depotToLane(laneX) {
      return [
        site(depotLane({ x: RX - depotDir.x * 10, z: RZ - depotDir.z * 10 }, 1)),
        site({ x: RX, z: RZ }),
        ...drive(depotNode, westLink),
        site({ x: westLinkX, z: backYardZ }),
        // Swing out onto the apron so the truck backs in straight, clear of its neighbours.
        site({ x: laneX + 8, z: backYardZ }),
        site({ x: laneX, z: backYardZ + 12 }),
        site({ x: laneX, z: C.backZ + 0.3 + TRUCK_HALF }, { rev: true, dock: true }),
      ];
    },
    laneToStore(laneX, s) {
      return [
        site({ x: laneX, z: backYardZ + 1 }), // straight out until clear of the neighbours, the lanes are tight
        site({ x: laneX + 8, z: backYardZ }),
        site({ x: eastLinkX, z: backYardZ }),
        ...drive(eastLink, s.westNode),
        ...intoSite(s, s.dockU),
      ];
    },
    storeToDepot(s) {
      return [
        ...outOfSite(s, s.dockU),
        ...drive(s.eastNode, depotNode),
        site({ x: RX, z: RZ }),
        site(depotLane({ x: RX - depotDir.x * 10, z: RZ - depotDir.z * 10 }, -1)),
        site(depotLane(depot, -1), { end: true }),
      ];
    },
  };

  const yardExitCentre = { x: yardOut.x + TRUCK_HALF, z: yardOut.z };

  // Drawable road pieces: the ring plus every site's access and service roads.
  const roads = edges.map(([a, b]) => ({ a: nodes[a], b: nodes[b], width: 9 }));
  const piece = (a, b, width = 7) => roads.push({ a, b, width });
  for (const s of [...factories, ...stores]) {
    piece(s.toWorld(-ACCESS, 0), s.toWorld(-ACCESS, s.serviceV));
    piece(s.toWorld(ACCESS, 0), s.toWorld(ACCESS, s.serviceV));
    piece(s.toWorld(s.kind === 'factory' ? s.garageU - 8 : -ACCESS, s.serviceV), s.toWorld(ACCESS, s.serviceV));
  }
  piece({ x: yardIn.x - 15, z: -RZ }, { x: yardIn.x - 15, z: yardIn.z }, 9);
  piece({ x: yardOut.x + 15, z: -RZ }, { x: yardOut.x + 15, z: yardOut.z }, 9);
  piece({ x: yardIn.x - 15, z: yardIn.z }, { x: yardIn.x, z: yardIn.z }, 9);
  piece({ x: yardOut.x, z: yardOut.z }, { x: yardOut.x + 15, z: yardOut.z }, 9);
  piece({ x: westLinkX, z: RZ }, { x: westLinkX, z: backYardZ }, 9);
  piece({ x: eastLinkX, z: RZ }, { x: eastLinkX, z: backYardZ }, 9);
  piece({ x: westLinkX, z: backYardZ }, { x: eastLinkX, z: backYardZ }, 9);
  piece({ x: westLinkX + 4, z: backYardZ + 10 }, { x: eastLinkX - 4, z: backYardZ + 10 }, 8.9); // apron for turning
  piece({ x: RX, z: RZ }, depot, 9);

  // Traffic zones: only one truck at a time may be inside a crossing, a site's
  // dock area or the back yard, so trucks never meet head-on or cut each other off.
  const zones = [];
  // The corners count as crossings too, so trucks turning there never meet.
  const corners = [node(-RX, -RZ), node(RX, -RZ), node(-RX, RZ)];
  const crossings = [inJunction, outJunction, westLink, eastLink, depotNode, ...corners];
  for (const s of [...factories, ...stores]) crossings.push(s.westNode, s.eastNode);
  for (const id of new Set(crossings)) {
    const n = nodes[id];
    zones.push({ kind: 'crossing', x: n.x, z: n.z, contains: (x, z) => Math.hypot(x - n.x, z - n.z) < 13 });
  }
  for (const s of [...factories, ...stores]) {
    const lo = s.serviceV - 6;
    zones.push({
      kind: 'site', x: s.toWorld(0, s.serviceV).x, z: s.toWorld(0, s.serviceV).z,
      contains: (x, z) => {
        const dx = x - s.origin.x;
        const dz = z - s.origin.z;
        const u = dx * s.U[0] + dz * s.U[1];
        const v = dx * s.V[0] + dz * s.V[1];
        return u > -ACCESS - 6 && u < ACCESS + 6 && v > lo && v < s.faceV;
      },
    });
  }
  const yardTop = C.backZ + 12;
  zones.push({
    kind: 'backyard', x: (westLinkX + eastLinkX) / 2, z: backYardZ,
    contains: (x, z) => x > westLinkX - 6 && x < eastLinkX + 6 && z > yardTop && z < backYardZ + 20,
  });
  zones.forEach((zn, i) => { zn.id = i; });

  const reach = 45 + SERVICE + 16 + 24 + 30;
  return {
    factories, stores, depot, roads, paths, zones, yardExitCentre, ring: { RX, RZ },
    bounds: { minX: -RX - reach, maxX: RX + reach, minZ: -RZ - reach, maxZ: RZ + reach },
  };
}
