// Starts everything: the warehouse brain, the 3D scene and the controls on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sim, TICK } from './sim/sim.js';
import { makeCoords } from './render/coords.js';
import { buildBuilding } from './render/building.js';
import { RobotViews } from './render/robots.js';
import { BoxViews } from './render/boxes.js';
import { TruckViews } from './render/trucks.js';
import { Screens } from './render/screens.js';
import { CameraDirector } from './render/cameras.js';
import { Ui } from './ui.js';

const sim = new Sim();
const L = sim.layout;
const C = makeCoords(L);

// ---------- renderer and scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 120;

const hemi = new THREE.HemisphereLight(0xdbeafe, 0x4b5563, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-25, 45, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 140;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const THEMES = {
  day: { bg: 0xc9d6e3, fog: 0xc9d6e3, hemi: 1.0, sun: 2.4, exposure: 1.0 },
  night: { bg: 0x0b1222, fog: 0x0b1222, hemi: 0.35, sun: 0.55, exposure: 1.25 },
};
function setTheme(name) {
  const t = THEMES[name] || THEMES.day;
  scene.background = new THREE.Color(t.bg);
  scene.fog = new THREE.Fog(t.fog, 90, 220);
  hemi.intensity = t.hemi;
  sun.intensity = t.sun;
  renderer.toneMappingExposure = t.exposure;
}
setTheme('day');

buildBuilding(scene, L, C);
const robots = new RobotViews(scene, sim, C);
const boxes = new BoxViews(scene, C);
boxes.setProducts(sim.products);
const trucks = new TruckViews(scene, C);
const screens = new Screens(scene, L, C);
const director = new CameraDirector(camera, controls, C);

// ---------- clicking on things ----------
const ui = new Ui(sim, {
  onView: (name) => {
    if (name === 'ride') {
      if (ui.selected?.type !== 'robot') ui.select({ type: 'robot', index: 0 });
      director.ride(ui.selected.index);
    } else {
      director.go(name);
    }
  },
  onRestart: (settings) => {
    sim.reset(settings);
    robots.rebuild(sim);
    boxes.setProducts(sim.products);
    trucks.clear();
    ui.select(null);
    director.go('overview');
  },
  onTheme: setTheme,
  onShadows: (on) => {
    renderer.shadowMap.enabled = on;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  },
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...robots.meshes(), boxes.mesh], true);
  for (const h of hits) {
    if (h.object === boxes.mesh) {
      const id = boxes.boxIdAt(h.instanceId);
      if (id !== null) return ui.select({ type: 'box', id });
    } else if (h.object.userData.robotIndex !== undefined) {
      return ui.select({ type: 'robot', index: h.object.userData.robotIndex });
    }
  }
  ui.select(null);
  if (director.mode === 'ride') director.go('overview');
});

// ---------- main loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let acc = 0;
let frames = 0;
let fpsTime = 0;
let realTime = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  realTime += dt;
  if (!ui.paused) acc += dt * ui.speed;
  let steps = 0;
  while (acc >= TICK && steps < 30) {
    sim.step();
    acc -= TICK;
    steps++;
  }
  if (steps === 30) acc = 0;
  const alpha = Math.min(acc / TICK, 1);

  const selectedRobot = ui.selected?.type === 'robot' ? ui.selected.index : -1;
  robots.update(sim, alpha, dt, selectedRobot);
  boxes.update(sim, robots.state, alpha);
  trucks.update(sim, sim.time + alpha * TICK);
  screens.update(sim, realTime);
  director.update(dt, robots.state);
  renderer.render(scene, camera);

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    ui.setFps(Math.round(frames / fpsTime));
    frames = 0;
    fpsTime = 0;
  }
  ui.update(realTime);
  requestAnimationFrame(frame);
}
director.go('overview', true);
requestAnimationFrame(frame);

// Handy for debugging in the browser console.
window.warehouse = { sim, camera, renderer, director, ui };
