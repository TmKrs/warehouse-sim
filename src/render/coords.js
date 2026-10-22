// Turns grid cells into positions in the 3D world (metres).

export const CS = 1.4; // size of one grid cell
export const SHELF0 = 0.2; // height of the lowest shelf
export const LEVEL_H = 0.9; // height between shelves

export const BOX_DIMS = [
  [0.55, 0.38, 0.55], // S
  [0.8, 0.52, 0.75], // M
  [1.0, 0.68, 0.98], // L
];

export function makeCoords(L) {
  const ox = ((L.W - 1) / 2) * CS;
  const oz = ((L.D - 1) / 2) * CS;
  return {
    x: (gx) => gx * CS - ox,
    z: (gz) => gz * CS - oz,
    cellX: (c) => L.xOf(c) * CS - ox,
    cellZ: (c) => L.zOf(c) * CS - oz,
    levelY: (level) => SHELF0 + level * LEVEL_H,
    width: L.W * CS,
    depth: L.D * CS,
    // Outer faces of the building.
    frontZ: -oz - CS / 2,
    backZ: oz + CS / 2,
    leftX: -ox - CS / 2,
    rightX: ox + CS / 2,
  };
}

export function boxSize(box) {
  const d = BOX_DIMS[box.size];
  return [d[0] * box.scale[0], d[1] * box.scale[1], d[2] * box.scale[2]];
}

export const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
