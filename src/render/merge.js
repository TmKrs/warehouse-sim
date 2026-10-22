// Joins many small parts into one mesh per material, so a detailed model
// costs a few draw calls instead of one per part.
import * as THREE from 'three';

// Merges geometries that have position, normal and uv (and optionally color).
export function mergeGeometries(geos) {
  let verts = 0;
  let idx = 0;
  for (const g of geos) {
    verts += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const hasColor = geos.every((g) => g.attributes.color);
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const col = hasColor ? new Float32Array(verts * 3) : null;
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(idx);
  let v = 0;
  let i = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, v * 2);
    if (col) col.set(g.attributes.color.array, v * 3);
    if (g.index) {
      const a = g.index.array;
      for (let k = 0; k < a.length; k++) index[i++] = a[k] + v;
    } else {
      for (let k = 0; k < n; k++) index[i++] = k + v;
    }
    v += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

const tmpM = new THREE.Matrix4();
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpC = new THREE.Color();

// Collects parts by material. add() places a copy of a geometry; meshes() builds one mesh per material.
// With color, the part is painted with vertex colours (the material needs vertexColors: true).
export class Batch {
  constructor() {
    this.parts = new Map();
  }

  add(material, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color = null) {
    const g = geometry.clone();
    tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
    g.applyMatrix4(tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS));
    if (color !== null) {
      tmpC.set(color);
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { c[k * 3] = tmpC.r; c[k * 3 + 1] = tmpC.g; c[k * 3 + 2] = tmpC.b; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
    return this;
  }

  // A box of the given size, centred at (x, y, z).
  box(material, w, h, d, x, y, z, ry = 0, color = null) {
    return this.add(material, unitBox(w, h, d), x, y, z, 0, ry, 0, color);
  }

  geometries() {
    const out = new Map();
    for (const [m, list] of this.parts) out.set(m, mergeGeometries(list));
    return out;
  }

  meshes({ cast = true, receive = true } = {}) {
    const out = [];
    for (const [m, geo] of this.geometries()) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      out.push(mesh);
    }
    return out;
  }
}

// Boxes of the same size are reused while building.
const boxCache = new Map();
function unitBox(w, h, d) {
  const key = `${w},${h},${d}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, g);
  }
  return g;
}
