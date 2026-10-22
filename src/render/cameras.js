// Camera spots (region, overview, docks, shipping, top-down, factories, stores),
// the robot ride-along view and following a truck.
import * as THREE from 'three';
import { ease } from './coords.js';

export class CameraDirector {
  constructor(camera, controls, C, map) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'overview';
    this.presets = {
      overview: { pos: [C.width * 0.55, 27, C.frontZ - 16], target: [0, 0, 1] },
      docks: { pos: [C.width * 0.28, 7.5, C.frontZ + 10], target: [-2, 1.2, C.frontZ - 8] },
      shipping: { pos: [-C.width * 0.3, 7, C.backZ - 10], target: [2, 0.8, C.backZ + 4] },
      top: { pos: [0, 52, 0.01], target: [0, 0, 0] },
    };
    if (map) {
      const b = map.bounds;
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
      // From high up on the south side, looking across the whole ring.
      const midX = (b.minX + b.maxX) / 2;
      const midZ = (b.minZ + b.maxZ) / 2;
      this.presets.region = { pos: [midX + span * 0.12, span * 0.78, midZ + span * 0.62], target: [midX + span * 0.08, 0, midZ + span * 0.02] };
      // The factory view looks over the low front wall into the open hall.
      const f0 = map.factories[0];
      const fp = f0.toWorld(14, f0.faceV - 24);
      const ft = f0.toWorld(10, f0.faceV + 12);
      this.presets.factories = { pos: [fp.x, 32, fp.z], target: [ft.x, 0, ft.z] };
      // The store view looks from above the car park over the open shop front.
      const s0 = map.stores[0];
      const sp = s0.toWorld(-6, s0.faceV + s0.depth + 17);
      const st = s0.toWorld(-5, s0.faceV + s0.depth / 2 + 1);
      this.presets.stores = { pos: [sp.x, 38, sp.z], target: [st.x, 0, st.z] };
    }
    this.tween = null;
    this.rideIndex = 0;
    this.ridePos = new THREE.Vector3();
    this.rideLook = new THREE.Vector3();
  }

  go(name, instant = false) {
    const p = this.presets[name];
    if (!p) return;
    this.mode = name;
    this.controls.enabled = true;
    const to = { pos: new THREE.Vector3(...p.pos), target: new THREE.Vector3(...p.target) };
    if (instant) {
      this.camera.position.copy(to.pos);
      this.controls.target.copy(to.target);
      this.tween = null;
      return;
    }
    this.tween = {
      from: { pos: this.camera.position.clone(), target: this.controls.target.clone() },
      to,
      t: 0,
    };
  }

  follow(truckId) {
    this.mode = 'follow';
    this.followId = truckId;
    this.controls.enabled = false;
    this.tween = null;
    this.rideFresh = true;
  }

  ride(index) {
    this.mode = 'ride';
    this.rideIndex = index;
    this.controls.enabled = false;
    this.tween = null;
    this.rideFresh = true;
  }

  update(dt, robotState, world, alpha = 0) {
    if (this.mode === 'follow') {
      const t = world?.trucks.find((x) => x.id === this.followId);
      if (!t) return this.go('region');
      const h = t.pheading + angleDiff(t.heading, t.pheading) * alpha;
      const cx = t.px + (t.x - t.px) * alpha;
      const cz = t.pz + (t.z - t.pz) * alpha;
      const fx = Math.cos(h);
      const fz = Math.sin(h);
      // Chase camera: behind and above the truck.
      const want = new THREE.Vector3(cx - fx * 22, 11, cz - fz * 22);
      const look = new THREE.Vector3(cx + fx * 8, 1.5, cz + fz * 8);
      const k = this.rideFresh ? 1 : Math.min(1, dt * 3);
      this.rideFresh = false;
      this.ridePos.lerp(want, k);
      this.rideLook.lerp(look, k);
      this.camera.position.copy(this.ridePos);
      this.camera.lookAt(this.rideLook);
      this.controls.target.copy(this.rideLook);
      return;
    }
    if (this.mode === 'ride') {
      const r = robotState[this.rideIndex];
      if (!r) return;
      const fx = Math.cos(r.heading);
      const fz = Math.sin(r.heading);
      // The robot's own eyes: on top of the robot, looking where it drives.
      const want = new THREE.Vector3(r.x + fx * 0.15, 1.4, r.z + fz * 0.15);
      const look = new THREE.Vector3(r.x + fx * 5, 0.9 + r.lift * 0.5, r.z + fz * 5);
      const k = this.rideFresh ? 1 : Math.min(1, dt * 8);
      this.rideFresh = false;
      this.ridePos.lerp(want, k);
      this.rideLook.lerp(look, k);
      if (k === 1) {
        this.ridePos.copy(want);
        this.rideLook.copy(look);
      }
      this.camera.position.copy(this.ridePos);
      this.camera.lookAt(this.rideLook);
      return;
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 1.2);
      const k = ease(tw.t);
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
