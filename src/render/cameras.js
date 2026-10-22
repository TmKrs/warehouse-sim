// Camera spots (overview, docks, shipping, top-down) and the ride-along view.
import * as THREE from 'three';
import { ease } from './coords.js';

export class CameraDirector {
  constructor(camera, controls, C) {
    this.camera = camera;
    this.controls = controls;
    this.mode = 'overview';
    this.presets = {
      overview: { pos: [C.width * 0.55, 27, C.frontZ - 16], target: [0, 0, 1] },
      docks: { pos: [C.width * 0.28, 7.5, C.frontZ + 10], target: [-2, 1.2, C.frontZ - 8] },
      shipping: { pos: [-C.width * 0.3, 7, C.backZ - 10], target: [2, 0.8, C.backZ + 4] },
      top: { pos: [0, 52, 0.01], target: [0, 0, 0] },
    };
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

  ride(index) {
    this.mode = 'ride';
    this.rideIndex = index;
    this.controls.enabled = false;
    this.tween = null;
    this.rideFresh = true;
  }

  update(dt, robotState) {
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
