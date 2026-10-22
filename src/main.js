// Starts everything: the supply chain brain, the 3D scene and the controls on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TICK } from './sim/sim.js';
import { World, DEFAULT_WORLD } from './sim/world.js';
import { buildBuilding } from './render/building.js';
import { RobotViews } from './render/robots.js';
import { BoxViews } from './render/boxes.js';
import { TruckViews } from './render/trucks.js';
import { Screens } from './render/screens.js';
import { Region } from './render/region.js';
import { CameraDirector } from './render/cameras.js';
import { Ui } from './ui.js';

// Settings that change the map (robots, factories, stores) come from the address bar,
// so "start again" simply reloads the page with new numbers.
const params = new URLSearchParams(location.search);
const num = (key, min, max) => {
  const v = Number(params.get(key));
  return Number.isFinite(v) && v >= min && v <= max ? v : DEFAULT_WORLD[key];
};
const world = new World({
  robots: num('robots', 4, 16),
  factories: num('factories', 3, 8),
  stores: num('stores', 3, 8),
  customersPerHour: num('customersPerHour', 4, 40),
  // A new random map on every start, unless the address bar names one.
  seed: params.has('seed') ? num('seed', 1, 1e9) : 1 + Math.floor(Math.random() * 1e6),
});
const sim = world.sim;
const L = sim.layout;
const C = world.C;

// ---------- renderer and scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
  // Keeps far-away flat surfaces (roads on grass) from flickering.
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 1000;

const hemi = new THREE.HemisphereLight(0xdbeafe, 0x4b5563, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 220;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
// The sun's shadow follows what you look at, so nearby things always get shadows.
const SUN_OFFSET = new THREE.Vector3(-35, 70, -45);

const THEMES = {
  day: { bg: 0xc9d6e3, fog: 0xc9d6e3, hemi: 1.0, sun: 2.4, exposure: 1.0 },
  night: { bg: 0x0b1222, fog: 0x0b1222, hemi: 0.35, sun: 0.55, exposure: 1.25 },
};
function setTheme(name) {
  const t = THEMES[name] || THEMES.day;
  scene.background = new THREE.Color(t.bg);
  // Fog starts beyond the region, so bigger maps stay clear.
  const b = world.map.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  scene.fog = new THREE.Fog(t.fog, span * 1.1, span * 3.5);
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
const region = new Region(scene, world);
const director = new CameraDirector(camera, controls, C, world.map);

const ui = new Ui(world, {
  onView: (name) => {
    if (name === 'ride') {
      if (ui.selected?.type !== 'robot') ui.select({ type: 'robot', index: 0 });
      director.ride(ui.selected.index);
    } else {
      director.go(name);
    }
  },
  onRestart: (settings) => {
    const q = new URLSearchParams({
      robots: settings.robots, factories: settings.factories, stores: settings.stores,
      customersPerHour: world.settings.customersPerHour,
    });
    location.search = q.toString();
  },
  onFollow: (id) => director.follow(id),
  onTheme: setTheme,
  onShadows: (on) => {
    renderer.shadowMap.enabled = on;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  },
});

// ---------- clicking on things ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = [...region.truckMeshes()];
  if (robots.visible) targets.push(...robots.meshes(), boxes.mesh);
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    if (h.object === boxes.mesh) {
      const id = boxes.boxIdAt(h.instanceId);
      if (id !== null) return ui.select({ type: 'box', id });
    } else if (h.object.userData.robotIndex !== undefined) {
      return ui.select({ type: 'robot', index: h.object.userData.robotIndex });
    } else {
      let o = h.object;
      while (o && o.userData.truckId === undefined) o = o.parent;
      if (o) return ui.select({ type: 'truck', id: o.userData.truckId });
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
const NEAR_WAREHOUSE = 170; // closer than this, robots and boxes are drawn

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  realTime += dt;
  if (!ui.paused) acc += dt * ui.speed;
  let steps = 0;
  while (acc >= TICK && steps < 30) {
    world.step();
    acc -= TICK;
    steps++;
  }
  if (steps === 30) acc = 0;
  const alpha = Math.min(acc / TICK, 1);

  // Level of detail: robots and boxes only when the camera is near the warehouse.
  const near = director.mode === 'ride' || camera.position.length() < NEAR_WAREHOUSE;
  robots.visible = near;
  for (const m of robots.meshes()) m.visible = near;
  boxes.mesh.visible = near;

  const selectedRobot = ui.selected?.type === 'robot' ? ui.selected.index : -1;
  robots.update(sim, alpha, dt, selectedRobot);
  if (near) boxes.update(sim, robots.state, alpha);
  trucks.update(sim, sim.time + alpha * TICK);
  screens.update(sim, realTime);
  region.update(world, alpha, realTime);
  director.update(dt, robots.state, world, alpha);

  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).add(SUN_OFFSET);
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
window.warehouse = { world, sim, camera, renderer, director, ui };
