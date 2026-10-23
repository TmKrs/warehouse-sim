// Trucks driving in, parking in the lot, backing up to a dock and leaving.
import * as THREE from 'three';
import { Batch } from './merge.js';
import { shiny } from './look.js';
import { yardPose } from '../sim/yard.js';
import { TRUCK_HALF } from '../sim/map.js';

const TRAILER_LEN = 8.5;

// Every truck shares the same few merged geometries and materials; only the trailer colour differs.
// A truck is a group of four meshes: painted parts, trailer box, glass and lights.
let parts = null;
const trailerMats = new Map();

function truckParts() {
  if (parts) return parts;
  const paint = shiny(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }));
  const glass = shiny(new THREE.MeshStandardMaterial({ color: 0x1b2533, roughness: 0.08, metalness: 0.9 }));
  const lights = new THREE.MeshBasicMaterial({ vertexColors: true });
  const trailerKey = 'trailer';
  const b = new Batch();
  const CAB = 0x1d4ed8;
  const DARK = 0x16191e;
  const METAL = 0xb8bec6;
  const GREY = 0x6b7280;
  const ORANGE = 0xf97316;
  const L = TRAILER_LEN;

  // Chassis, rear bumper and side guards.
  b.box(paint, 2.1, 0.35, L + 2.6, 0, 0.95, -(L + 2.6) / 2, 0, DARK);
  b.box(paint, 2.4, 0.22, 0.18, 0, 0.75, -0.1, 0, DARK);
  for (const s of [-1, 1]) {
    b.box(paint, 0.05, 0.12, 4.4, s * 1.2, 0.95, -5.0, 0, GREY);
    b.box(paint, 0.05, 0.12, 4.4, s * 1.2, 0.68, -5.0, 0, GREY);
    // Legs that hold the trailer up when it stands alone.
    b.box(paint, 0.12, 0.7, 0.12, s * 0.9, 0.8, -L + 1.6, 0, GREY);
  }
  // Trailer: frame rails along the bottom and top edge, an orange stripe, and the rear doors.
  b.box(paint, 2.56, 0.16, L, 0, 1.3, -L / 2, 0, METAL);
  b.box(paint, 2.56, 0.1, L, 0, 4.12, -L / 2, 0, METAL);
  b.box(paint, 2.54, 0.3, L * 0.9, 0, 1.9, -L / 2, 0, ORANGE);
  b.box(paint, 0.06, 2.7, 0.04, 0, 2.7, 0.02, 0, GREY);
  for (const s of [-1, 1]) {
    b.box(paint, 0.05, 2.5, 0.06, s * 0.6, 2.7, 0.03, 0, METAL); // locking bars
    b.box(paint, 0.3, 0.16, 0.06, s * 0.9, 1.15, 0.0, 0, 0xe5e7eb); // number plate area
  }
  // Cab: body, roof fairing up to trailer height, grille, bumper, steps, mirrors, fuel tanks.
  const cz = -L - 1.4; // cab centre
  const front = cz - 1.1; // front face of the cab
  b.box(paint, 2.4, 2.3, 2.2, 0, 2.25, cz, 0, CAB);
  b.add(paint, wedge(), 0, 3.4, cz + 0.1, 0, 0, 0, CAB);
  b.box(paint, 2.42, 0.12, 2.22, 0, 3.4, cz, 0, 0xe2e8f0);
  b.box(paint, 1.5, 0.75, 0.06, 0, 1.7, front - 0.02, 0, DARK);
  for (let k = 0; k < 4; k++) b.box(paint, 1.4, 0.05, 0.05, 0, 1.45 + k * 0.17, front - 0.06, 0, METAL);
  b.box(paint, 2.5, 0.35, 0.25, 0, 1.15, front - 0.08, 0, GREY);
  for (const s of [-1, 1]) {
    b.box(paint, 0.35, 0.08, 0.3, s * 1.05, 0.95, front + 0.4, 0, METAL);
    b.box(paint, 0.04, 0.04, 0.45, s * 1.32, 2.95, front + 0.15, 0, DARK);
    b.box(paint, 0.06, 0.5, 0.2, s * 1.52, 2.8, front - 0.05, 0, DARK);
    const tank = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12);
    b.add(paint, tank, s * 1.0, 1.1, cz + 0.75, Math.PI / 2, 0, 0, METAL);
  }
  // Wheels: dark tyres with silver rims and a hub.
  const tyre = new THREE.CylinderGeometry(0.5, 0.5, 0.36, 12);
  const rim = new THREE.CylinderGeometry(0.3, 0.3, 0.38, 10);
  const hub = new THREE.CylinderGeometry(0.1, 0.12, 0.42, 6);
  for (const z of [-1.2, -2.3, -L - 0.6, -L - 2.0]) {
    for (const s of [-1, 1]) {
      b.add(paint, tyre, s * 1.12, 0.5, z, 0, 0, Math.PI / 2, DARK);
      b.add(paint, rim, s * 1.12, 0.5, z, 0, 0, Math.PI / 2, METAL);
      b.add(paint, hub, s * 1.12, 0.5, z, 0, 0, Math.PI / 2, GREY);
    }
  }
  // Glass: windscreen, side windows.
  b.box(glass, 2.15, 0.95, 0.05, 0, 2.8, front - 0.01);
  for (const s of [-1, 1]) b.box(glass, 0.05, 0.8, 1.1, s * 1.21, 2.8, cz - 0.45);
  // Lights: headlights, roof marker lights, red tail lights.
  const WHITE = 0xfff7e0;
  const RED = 0xef2b2b;
  const AMBER = 0xffb020;
  for (const s of [-1, 1]) {
    b.box(lights, 0.4, 0.18, 0.05, s * 0.95, 1.55, front - 0.04, 0, WHITE);
    b.box(lights, 0.2, 0.12, 0.05, s * 0.95, 1.15, front - 0.22, 0, AMBER);
    b.box(lights, 0.3, 0.14, 0.05, s * 1.0, 1.0, 0.03, 0, RED);
  }
  for (let k = -2; k <= 2; k++) b.box(lights, 0.14, 0.07, 0.1, k * 0.35, 3.6, front + 0.4, 0, AMBER);
  // The trailer box with thin vertical ribs; it gets each truck's own colour.
  b.box(trailerKey, 2.5, 2.8, L, 0, 2.75, -L / 2);
  for (let z = -0.5; z > -L + 0.2; z -= 0.85) {
    for (const s of [-1, 1]) b.box(trailerKey, 0.04, 2.7, 0.08, s * 1.26, 2.75, z);
  }
  const geos = b.geometries();
  parts = { geos, paint, glass, lights, trailer: geos.get(trailerKey) };
  return parts;
}

// A sloped roof fairing on the cab, so air flows over the trailer.
function wedge() {
  const g = new THREE.BoxGeometry(2.3, 0.75, 1.8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // Pull the top front edge back to make a slope.
    if (p.getY(i) > 0 && p.getZ(i) < 0) p.setZ(i, p.getZ(i) + 1.3);
  }
  g.translate(0, 0.37, 0);
  g.computeVertexNormals();
  return g;
}

export function makeTruck(color) {
  const P = truckParts();
  let trailerMat = trailerMats.get(color);
  if (!trailerMat) {
    trailerMat = shiny(new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 }));
    trailerMats.set(color, trailerMat);
  }
  const g = new THREE.Group();
  // The group's origin is the rear of the trailer; the truck points toward -z.
  const trailer = new THREE.Mesh(P.trailer, trailerMat);
  const body = new THREE.Mesh(P.geos.get(P.paint), P.paint);
  const glass = new THREE.Mesh(P.geos.get(P.glass), P.glass);
  const lights = new THREE.Mesh(P.geos.get(P.lights), P.lights);
  trailer.castShadow = body.castShadow = true;
  trailer.receiveShadow = body.receiveShadow = true;
  g.add(trailer, body, glass, lights);
  return g;
}

export class TruckViews {
  constructor(scene, C) {
    this.scene = scene;
    this.C = C;
    this.views = new Map();
  }

  clear() {
    for (const v of this.views.values()) this.scene.remove(v);
    this.views.clear();
  }

  // now: warehouse time in seconds, smoothed between ticks.
  update(sim, now) {
    const Y = sim.yardPlan;
    const alive = new Set();
    for (const t of sim.trucks) {
      if (t.status === 'planned' || (t.status === 'gone' && !t.atExit)) continue;
      alive.add(t.id);
      let v = this.views.get(t.id);
      if (!v) {
        v = makeTruck(t.color);
        this.views.set(t.id, v);
        this.scene.add(v);
      }
      const p = yardPose(Y, t, now - t.statusSince);
      // The model's origin is the rear doors and it points toward -z.
      v.position.set(p.x - Math.cos(p.h) * TRUCK_HALF, 0, p.z - Math.sin(p.h) * TRUCK_HALF);
      v.rotation.y = -p.h - Math.PI / 2;
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.scene.remove(v);
        this.views.delete(id);
      }
    }
  }
}
