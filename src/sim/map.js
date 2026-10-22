// The region around the warehouse: factories, stores, a truck depot and the
// roads between them. Everything is in metres; the warehouse sits at (0, 0),
// factories lie to the north (negative z) and stores to the south (positive z).
//
// Trucks drive on the right. Main roads form a graph; the short service
// roads inside each site are fixed one-way loops added to a truck's route.

const FRONT_Z = -80; // road in front of the warehouse docks, linking the factories
const BACK_Z = 80; // road behind the warehouse, linking the stores
const SPACING = 75; // distance between neighbouring sites
const SERVICE = 32; // service road distance from the main road
const LANE = 1.9; // offset of each driving lane from the road centre
export const TRUCK_HALF = 5.5; // centre of a truck to its rear doors

export function buildMap(C, factoryCount, storeCount) {
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
  const line = (z, xs) => {
    const ids = [...new Set(xs)].sort((a, b) => a - b).map((x) => node(x, z));
    for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i]);
  };
  const spread = (n) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * SPACING);

  // Warehouse hand-over points, matching the yard animation in render/trucks.js.
  const dockZ = C.frontZ - 1.6;
  const yardIn = { x: -C.width / 2 - 40, z: C.frontZ - 30 + 4.5 }; // rear of the truck, facing +x
  const yardOut = { x: C.rightX + 30, z: dockZ - 16 }; // where a leaving truck's rear ends up
  const backYardZ = C.backZ + 20;
  const westLinkX = C.leftX - 20;
  const eastLinkX = C.rightX + 25;

  // Factories along the north road.
  const factories = spread(factoryCount).map((x, i) => {
    const faceZ = FRONT_Z - SERVICE - 16; // front wall of the building
    const serviceZ = FRONT_Z - SERVICE;
    const f = {
      id: i, x, z: faceZ - 12, faceZ, serviceZ,
      west: node(x - 25, FRONT_Z), east: node(x + 25, FRONT_Z),
      garage: { x: x - 40, z: serviceZ },
      docks: [x - 7, x + 7].map((dx) => ({ x: dx, z: faceZ })),
    };
    return f;
  });
  // Stores along the south road.
  const stores = spread(storeCount).map((x, i) => {
    const faceZ = BACK_Z + SERVICE + 16;
    const serviceZ = BACK_Z + SERVICE;
    return {
      id: i, x, z: faceZ + 11, faceZ, serviceZ,
      west: node(x - 25, BACK_Z), east: node(x + 25, BACK_Z),
      dock: { x: x - 8, z: faceZ },
    };
  });

  const inJunction = node(yardIn.x - 15, FRONT_Z);
  const outJunction = node(yardOut.x + 15, FRONT_Z);
  const westLink = node(westLinkX, BACK_Z);
  const eastLink = node(eastLinkX, BACK_Z);
  const fxs = factories.flatMap((f) => [f.x - 25, f.x + 25]);
  const sxs = stores.flatMap((s) => [s.x - 25, s.x + 25]);
  const frontEnds = [Math.min(...fxs, yardIn.x - 15) - 30, Math.max(...fxs, yardOut.x + 15) + 30];
  const backMax = Math.max(...sxs, eastLinkX) + 30;
  const depot = { x: backMax + 18, z: BACK_Z + 14 };
  const depotNode = node(backMax, BACK_Z);
  line(FRONT_Z, [...fxs, yardIn.x - 15, yardOut.x + 15, ...frontEnds]);
  line(BACK_Z, [...sxs, westLinkX, eastLinkX, Math.min(...sxs, westLinkX) - 30, backMax]);

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
      // Right of the driving direction, seen from above.
      let rx = -dz;
      let rz = dx;
      // At corners, push the point out so both lanes stay parallel.
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
        rx = (rx / ln) / Math.max(0.5, cos);
        rz = (rz / ln) / Math.max(0.5, cos);
      }
      out[i].x += rx * LANE;
      out[i].z += rz * LANE;
    }
    return out;
  };
  const drive = (fromNode, toNode) => keepRight(route(fromNode, toNode));

  // ---- site manoeuvres; each point is where the truck's centre goes ----
  const site = (x, z, extra = {}) => ({ x, z, site: true, ...extra });
  // Back up to a dock: drive past it along the service road, then reverse in.
  // facing: direction the cab points when docked (+1 = +z, -1 = -z).
  const dockIn = (dx, faceZ, serviceZ, facing) => [
    site(dx + 13, serviceZ),
    site(dx, faceZ + facing * TRUCK_HALF + facing * 0.4, { rev: true, dock: true }),
  ];
  const dockOut = (dx, faceZ, serviceZ, facing, exitX) => [
    site(dx + 2, serviceZ - facing * 0),
    site(exitX, serviceZ),
  ];

  const paths = {
    // Garage -> factory dock.
    garageToDock(f, d) {
      return [site(f.garage.x, f.serviceZ), ...dockIn(f.docks[d].x, f.faceZ, f.serviceZ, 1)];
    },
    // Factory dock -> warehouse yard gate.
    factoryToWarehouse(f, d) {
      return [
        ...dockOut(f.docks[d].x, f.faceZ, f.serviceZ, 1, f.x + 25),
        ...drive(f.east, inJunction),
        site(yardIn.x - 15, yardIn.z),
        site(yardIn.x + TRUCK_HALF, yardIn.z, { handoff: true }),
      ];
    },
    // Warehouse exit -> factory garage.
    warehouseToGarage(f) {
      return [
        site(yardOut.x + 15, yardOut.z),
        ...drive(outJunction, f.west),
        site(f.x - 25, f.serviceZ),
        site(f.garage.x, f.serviceZ, { end: true }),
      ];
    },
    // Depot -> shipping lane at the back of the warehouse.
    depotToLane(laneX) {
      return [
        ...drive(depotNode, westLink),
        site(westLinkX, backYardZ),
        site(laneX + 13, backYardZ),
        site(laneX, C.backZ + 0.3 + TRUCK_HALF, { rev: true, dock: true }),
      ];
    },
    // Shipping lane -> store dock.
    laneToStore(laneX, s) {
      return [
        site(laneX + 2, backYardZ),
        site(eastLinkX, backYardZ),
        ...drive(eastLink, s.west),
        site(s.x - 25, s.serviceZ),
        ...dockIn(s.dock.x, s.faceZ, s.serviceZ, -1),
      ];
    },
    // Store dock -> depot.
    storeToDepot(s) {
      return [
        ...dockOut(s.dock.x, s.faceZ, s.serviceZ, -1, s.x + 25),
        ...drive(s.east, depotNode),
        site(depot.x, depot.z, { end: true }),
      ];
    },
  };

  // Where the truck's rear is after leaving a warehouse dock (render/trucks.js).
  const yardExitCentre = { x: yardOut.x + TRUCK_HALF, z: yardOut.z };

  // Drawable road pieces: main roads plus every site's service roads.
  const roads = edges.map(([a, b]) => ({ a: nodes[a], b: nodes[b], width: 9 }));
  const piece = (x1, z1, x2, z2, width = 7) => roads.push({ a: { x: x1, z: z1 }, b: { x: x2, z: z2 }, width });
  for (const f of factories) {
    piece(f.x - 25, FRONT_Z, f.x - 25, f.serviceZ);
    piece(f.x + 25, FRONT_Z, f.x + 25, f.serviceZ);
    piece(f.garage.x - 6, f.serviceZ, f.x + 25, f.serviceZ);
  }
  for (const s of stores) {
    piece(s.x - 25, BACK_Z, s.x - 25, s.serviceZ);
    piece(s.x + 25, BACK_Z, s.x + 25, s.serviceZ);
    piece(s.x - 25, s.serviceZ, s.x + 25, s.serviceZ);
  }
  piece(yardIn.x - 15, FRONT_Z, yardIn.x - 15, yardIn.z, 9);
  piece(yardOut.x + 15, FRONT_Z, yardOut.x + 15, yardOut.z, 9);
  piece(yardIn.x - 15, yardIn.z, yardIn.x, yardIn.z, 9);
  piece(yardOut.x, yardOut.z, yardOut.x + 15, yardOut.z, 9);
  piece(westLinkX, BACK_Z, westLinkX, backYardZ, 9);
  piece(eastLinkX, BACK_Z, eastLinkX, backYardZ, 9);
  piece(westLinkX, backYardZ, eastLinkX, backYardZ, 9);
  piece(backMax, BACK_Z, depot.x, depot.z, 9);

  return {
    factories, stores, depot, roads, paths, yardExitCentre,
    frontZ: FRONT_Z, backZ: BACK_Z, backYardZ,
    bounds: {
      minX: Math.min(frontEnds[0], -C.width) - 40,
      maxX: Math.max(frontEnds[1], depot.x) + 40,
      minZ: factories[0].z - 40,
      maxZ: stores[0].z + 50,
    },
  };
}
