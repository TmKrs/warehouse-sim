// Trucks driving in, waiting in the yard, backing up to a dock and leaving.
import * as THREE from 'three';
import { clamp01, ease } from './coords.js';

const TRAILER_LEN = 8.5;

export function makeTruck(color) {
  const g = new THREE.Group();
  const trailerMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.1, metalness: 0.8 });
  // The group's origin is the rear of the trailer; the truck points toward -z.
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.9, TRAILER_LEN), trailerMat);
  trailer.position.set(0, 1.25 + 1.45, -TRAILER_LEN / 2);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.35, TRAILER_LEN * 0.9), new THREE.MeshStandardMaterial({ color: 0xf97316 }));
  stripe.position.set(0, 1.9, -TRAILER_LEN / 2);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.2), cabMat);
  cab.position.set(0, 1.1 + 1.2, -TRAILER_LEN - 1.4);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.05), glassMat);
  glass.position.set(0, 2.8, -TRAILER_LEN - 2.52);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, TRAILER_LEN + 2.6), darkMat);
  chassis.position.set(0, 0.95, -(TRAILER_LEN + 2.6) / 2);
  g.add(trailer, stripe, cab, glass, chassis);
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-1.2, -2.3, -TRAILER_LEN - 0.6, -TRAILER_LEN - 2.0]) {
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.set(s * 1.15, 0.5, z);
      g.add(w);
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
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
    const C = this.C;
    const alive = new Set();
    const yardZ = C.frontZ - 30;
    const yardX = (i) => -C.width / 2 + 4 + i * 4.2;
    for (const t of sim.trucks) {
      if (t.status === 'planned' || t.status === 'gone') continue;
      alive.add(t.id);
      let v = this.views.get(t.id);
      if (!v) {
        v = makeTruck(t.color);
        this.views.set(t.id, v);
        this.scene.add(v);
      }
      const since = now - t.statusSince;
      let x;
      let z;
      let rot;
      if (t.status === 'yard') {
        const i = Math.max(0, sim.yard.indexOf(t));
        // Drive in from the road on the left, then wait in a yard bay (facing the warehouse, cab away).
        const p = ease(clamp01(since / 5));
        x = -C.width / 2 - 40 + (yardX(i) + C.width / 2 + 40) * p;
        z = yardZ + 4.5;
        rot = -Math.PI / 2;
        t._yardX = x;
      } else {
        const dock = sim.docks[t.dock];
        const dockX = C.x(dock.x);
        const dockZ = C.frontZ - 1.6;
        if (t.status === 'docking') {
          const startX = t._yardX ?? -C.width / 2 - 20;
          const p = clamp01(since / 6);
          if (p < 0.45) {
            // Pull forward from the yard to in front of the dock, turning on the way.
            const q = ease(p / 0.45);
            x = startX + (dockX - startX) * q;
            z = yardZ + 4.5 + (dockZ - 14 - (yardZ + 4.5)) * q;
            rot = -Math.PI / 2 * (1 - q);
          } else {
            // Back up to the dock.
            const q = ease((p - 0.45) / 0.55);
            x = dockX;
            z = dockZ - 14 + 14 * q;
            rot = 0;
          }
        } else if (t.status === 'unloading') {
          x = dockX;
          z = dockZ;
          rot = 0;
        } else {
          // Leaving: drive away from the dock and off to the right.
          const p = clamp01(since / 6);
          if (p < 0.5) {
            const q = ease(p / 0.5);
            x = dockX;
            z = dockZ - q * 12;
            rot = 0;
          } else {
            const q = ease((p - 0.5) / 0.5);
            rot = -Math.PI / 2 * Math.min(1, q * 3);
            x = dockX + q * (C.rightX + 30 - dockX);
            z = dockZ - 12 - Math.min(1, q * 3) * 4;
          }
        }
      }
      v.position.set(x, 0, z);
      v.rotation.y = rot;
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.scene.remove(v);
        this.views.delete(id);
      }
    }
  }
}
