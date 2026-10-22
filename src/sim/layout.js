// The warehouse floor plan as a grid of cells.
//
//   z = 0          truck docks (robots pick up incoming boxes here)
//   z = 1..2       front road
//   z = 3..        rack rows with one-cell aisles between them
//   z = D-3..D-2   back road
//   z = D-1        shipping stations (robots drop boxes for orders here)
//
// Left and right walls have parking spots where idle robots wait.

export const CELL = { FLOOR: 0, RACK: 1, WALL: 2, DOCK: 3, SHIP: 4, PARK: 5 };

export const ROW_NAMES = 'ABCDEFGHIJ';

export function buildLayout({ rowLevels = [2, 3, 4, 5, 4, 3], rackLength = 12 } = {}) {
  const rows = rowLevels.length;
  const W = 3 * rows + 7;
  const D = rackLength + 6;
  const N = W * D;
  const type = new Uint8Array(N);
  const idx = (x, z) => z * W + x;
  const zRack0 = 3;
  const zRack1 = zRack0 + rackLength - 1;

  // Walls along the dock side and shipping side; doors are opened below.
  for (let x = 0; x < W; x++) {
    type[idx(x, 0)] = CELL.WALL;
    type[idx(x, D - 1)] = CELL.WALL;
  }

  // Rack rows: each row is two rack columns back to back.
  const slots = [];
  const rowInfo = [];
  for (let r = 0; r < rows; r++) {
    const xa = 4 + 3 * r;
    const xb = xa + 1;
    const levels = rowLevels[r];
    const info = { id: r, name: ROW_NAMES[r], levels, xa, xb, capacity: 0 };
    for (let z = zRack0; z <= zRack1; z++) {
      for (const [x, aisleX, side] of [[xa, xa - 1, 1], [xb, xb + 1, -1]]) {
        type[idx(x, z)] = CELL.RACK;
        for (let level = 0; level < levels; level++) {
          slots.push({
            id: slots.length,
            row: r,
            x,
            z,
            level,
            access: idx(aisleX, z),
            // Which way the robot faces (in x) to reach into this rack.
            side,
            boxId: null,
            reservedFor: null,
          });
          info.capacity++;
        }
      }
    }
    rowInfo.push(info);
  }

  // Truck docks: each dock has two cells where robots collect boxes.
  const docks = [];
  for (let k = 0; k < 3; k++) {
    const x = Math.floor((W * (k + 1)) / 4) - 1;
    const cells = [idx(x, 0), idx(x + 1, 0)];
    for (const c of cells) type[c] = CELL.DOCK;
    docks.push({ id: k, x: x + 0.5, cells });
  }

  // Shipping stations: each has three drop-off cells.
  const ships = [];
  for (let k = 0; k < 2; k++) {
    const x = Math.round((W * (k + 1)) / 3);
    const cells = [idx(x - 1, D - 1), idx(x, D - 1), idx(x + 1, D - 1)];
    for (const c of cells) type[c] = CELL.SHIP;
    ships.push({ id: k, x, cells });
  }

  // Parking spots along the side walls.
  const parking = [];
  for (let z = zRack0; z <= zRack1; z++) {
    for (const x of [0, W - 1]) {
      type[idx(x, z)] = CELL.PARK;
      parking.push(idx(x, z));
    }
  }
  // Side wall cells outside the rack zone are walls too.
  for (let z = 1; z < D - 1; z++) {
    for (const x of [0, W - 1]) {
      if (type[idx(x, z)] !== CELL.PARK) type[idx(x, z)] = CELL.WALL;
    }
  }

  return {
    W, D, N, type, slots, rows: rowInfo, docks, ships, parking,
    zRack0, zRack1, rackLength,
    idx,
    xOf: (c) => c % W,
    zOf: (c) => Math.floor(c / W),
    walkable: (c) => type[c] !== CELL.RACK && type[c] !== CELL.WALL,
  };
}
