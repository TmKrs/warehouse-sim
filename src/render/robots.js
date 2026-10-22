// Robot models and their smooth movement between grid cells.
import * as THREE from 'three';
import { CS, clamp01, ease } from './coords.js';

const BODY_H = 0.32;
export const DECK_Y = BODY_H + 0.04; // height of the lift platform when lowered

const STATUS_COLORS = {
  moving: 0x22c55e,
  lifting: 0x38bdf8,
  waiting: 0xf59e0b,
  idle: 0x64748b,
};

function makeRobot(index) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf5b301, roughness: 0.45, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6, metalness: 0.3 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xaab2bd, roughness: 0.35, metalness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.98, BODY_H - 0.06, 0.86), bodyMat);
  body.position.y = 0.06 + (BODY_H - 0.06) / 2;
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.88), darkMat);
  skirt.position.y = 0.06;
  // Light strip shows what the robot is doing.
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.4 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.035, 0.89), stripMat);
  strip.position.y = BODY_H - 0.04;
  // Lidar on top at the back.
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 16), darkMat);
  lidar.position.set(0.47, 0.2, 0);
  // Mast: fixed lower part and a sliding upper part.
  const mastLow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.5), steelMat);
  mastLow.position.set(-0.44, BODY_H + 0.65, 0);
  const mastHigh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.42), steelMat);
  mastHigh.position.set(-0.4, BODY_H + 0.65, 0);
  // Lift platform carrying the box.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.72), darkMat);
  platform.position.set(0.08, DECK_Y, 0);
  // Little "eyes" at the front so you can see where it is heading.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.12), eyeMat);
    eye.position.set(0.5, 0.2, s * 0.25);
    g.add(eye);
  }
  for (const m of [body, skirt, lidar, mastLow, mastHigh, platform]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  g.add(body, skirt, strip, lidar, mastLow, mastHigh, platform);

  // Ring shown under the selected robot.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.85, 40),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  g.add(ring);

  g.traverse((o) => { o.userData.robotIndex = index; });
  return { group: g, platform, mastHigh, strip, stripMat, ring, heading: 0 };
}

export class RobotViews {
  constructor(scene, sim, C) {
    this.scene = scene;
    this.C = C;
    this.views = [];
    this.rebuild(sim);
  }

  rebuild(sim) {
    for (const v of this.views) this.scene.remove(v.group);
    this.views = sim.robots.map((r, i) => {
      const v = makeRobot(i);
      v.heading = r.heading;
      this.scene.add(v.group);
      return v;
    });
  }

  // alpha: 0..1, how far we are between the last tick and the next one.
  update(sim, alpha, dt, selected) {
    const C = this.C;
    const t = sim.tick + alpha;
    this.state = [];
    sim.robots.forEach((r, i) => {
      const v = this.views[i];
      const x = C.cellX(r.prev) + (C.cellX(r.cell) - C.cellX(r.prev)) * alpha;
      const z = C.cellZ(r.prev) + (C.cellZ(r.cell) - C.cellZ(r.prev)) * alpha;
      // Turn smoothly toward the heading.
      let diff = r.heading - v.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      v.heading += diff * Math.min(1, dt * 10);
      v.group.position.set(x, 0, z);
      v.group.rotation.y = -v.heading;

      // Lift height and how far the box is pushed in or out of the rack.
      let lift = 0;
      let reach = 0;
      let status = r.mode === 'travel' ? (r.cell === r.prev && r.plan ? 'waiting' : 'moving') : r.mode === 'act' ? 'lifting' : r.mode === 'idle' ? 'idle' : 'waiting';
      if (r.mode === 'act' && r.action) {
        const p = clamp01((t - r.actStart) / (r.actUntil - r.actStart));
        const a = r.action;
        if (a.kind === 'store' || a.kind === 'pickup') {
          const top = C.levelY(a.level) + 0.05 - DECK_Y;
          lift = top * (p < 0.4 ? ease(p / 0.4) : p > 0.6 ? 1 - ease((p - 0.6) / 0.4) : 1);
          // reach: 0 = box on the robot, 1 = box in the rack
          const push = p < 0.4 ? 0 : p < 0.6 ? ease((p - 0.4) / 0.2) : 1;
          reach = a.kind === 'store' ? push : 1 - push;
        } else {
          // Load: box slides from the dock onto the robot. Drop: onto the conveyor.
          reach = a.kind === 'load' ? 1 - ease(p) : ease(p);
        }
      }
      if (r.mode === 'plan' && r.task && r.task.type === 'park' && r.blockedSince === undefined) status = 'idle';
      v.platform.position.y = DECK_Y + lift;
      v.mastHigh.position.y = BODY_H + 0.65 + Math.max(0, lift - 0.2);
      const color = STATUS_COLORS[status];
      v.stripMat.color.setHex(color);
      v.stripMat.emissive.setHex(color);
      v.ring.visible = selected === i;
      this.state.push({ x, z, lift, reach, heading: v.heading, status });
    });
  }

  meshes() {
    return this.views.map((v) => v.group);
  }
}

export { CS };
