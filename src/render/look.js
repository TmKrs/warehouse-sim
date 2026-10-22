// The look of the world: sky, sun, fog, the soft sky reflections on metal,
// and the lamps and windows that glow at night.
import * as THREE from 'three';

// A soft round spot of light, painted on the ground under the street lamps at night.
function poolTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,214,150,0.55)');
  r.addColorStop(0.5, 'rgba(255,200,130,0.2)');
  r.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Shared by every street lamp and lit window, so a theme change is one switch.
export const GLOW = {
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 0.2, roughness: 0.4 }),
  window: new THREE.MeshStandardMaterial({ color: 0x5b7186, emissive: 0xffc56b, emissiveIntensity: 0, roughness: 0.15, metalness: 0.6 }),
  // Added on top of the ground, no real light: costs one draw call for all lamps.
  pool: new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, visible: false }),
};

// Only shiny materials (glass, chrome, metal) reflect the sky; the big surfaces skip it to keep frames cheap.
const shinyMats = new Set();
let currentEnv = null;
export function shiny(material) {
  shinyMats.add(material);
  material.envMap = currentEnv;
  return material;
}

// Direction the sunlight comes from (towards the sun).
export const SUN_DIR = new THREE.Vector3(-35, 70, -45).normalize();

export const THEMES = {
  day: {
    zenith: '#3f78c2', horizon: '#d6e3ee', ground: '#a7b49a', sunGlow: 'rgba(255,244,214,',
    hemiSky: 0xdbeafe, hemiGround: 0x6b7558, hemi: 1.0, sun: 2.6, sunColor: 0xfff1d6,
    env: 0.9, exposure: 1.0, glow: 0,
  },
  night: {
    zenith: '#030712', horizon: '#1c2a45', ground: '#0d1420', sunGlow: 'rgba(160,190,255,',
    hemiSky: 0x7a8fbf, hemiGround: 0x111827, hemi: 0.3, sun: 0.45, sunColor: 0x9db4ff,
    env: 0.4, exposure: 1.2, glow: 1,
    stars: true,
  },
};

// A sky painted as an equirectangular picture: gradient, a glow around the sun (or moon), and stars at night.
// dim darkens the picture; the reflection copy uses it to set how strongly materials pick up the sky.
function skyTexture(t, dim = 0) {
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  // Row y looks at elevation (0.5 - y / H) * PI; the horizon is the middle row.
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, t.zenith);
  grad.addColorStop(0.32, t.zenith);
  grad.addColorStop(0.47, t.horizon);
  grad.addColorStop(0.5, t.horizon);
  grad.addColorStop(0.53, t.ground);
  grad.addColorStop(1, t.ground);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Soft haze band right at the horizon.
  const haze = g.createLinearGradient(0, H * 0.38, 0, H * 0.5);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(1, t.stars ? 'rgba(80,100,140,0.25)' : 'rgba(255,255,255,0.35)');
  g.fillStyle = haze;
  g.fillRect(0, H * 0.38, W, H * 0.12);
  if (t.stars) {
    for (let i = 0; i < 500; i++) {
      const y = Math.random() * H * 0.45;
      const a = 0.25 + Math.random() * 0.75 * (1 - y / (H * 0.5));
      g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      g.fillRect(Math.random() * W, y, 1, 1);
    }
  }
  // Glow around the sun, at the same spot as the light that casts shadows.
  const u = Math.atan2(SUN_DIR.z, SUN_DIR.x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(SUN_DIR.y) / Math.PI + 0.5;
  const sx = u * W;
  const sy = (1 - v) * H;
  for (const dx of [-W, 0, W]) {
    const r = g.createRadialGradient(sx + dx, sy, 0, sx + dx, sy, H * 0.45);
    r.addColorStop(0, t.sunGlow + '0.9)');
    r.addColorStop(0.08, t.sunGlow + '0.55)');
    r.addColorStop(1, t.sunGlow + '0)');
    g.fillStyle = r;
    g.fillRect(0, 0, W, H);
  }
  if (dim) {
    g.fillStyle = `rgba(0,0,0,${dim})`;
    g.fillRect(0, 0, W, H);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// Builds each theme's sky and its blurred copy for reflections once, on first use.
export class Look {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.cache = {};
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  sky(name) {
    if (!this.cache[name]) {
      const t = THEMES[name];
      const bg = skyTexture(t);
      const src = skyTexture(t, 1 - t.env);
      const env = this.pmrem.fromEquirectangular(src).texture;
      src.dispose();
      this.cache[name] = { bg, env };
    }
    return this.cache[name];
  }

  apply(name, { hemi, sun, fogNear, fogFar }) {
    const t = THEMES[name] || THEMES.day;
    const { bg, env } = this.sky(THEMES[name] ? name : 'day');
    const scene = this.scene;
    scene.background = bg;
    currentEnv = env;
    for (const m of shinyMats) {
      m.envMap = env;
      m.needsUpdate = true;
    }
    if (!scene.fog) scene.fog = new THREE.Fog(t.horizon, fogNear, fogFar);
    scene.fog.color.set(t.horizon);
    scene.fog.near = fogNear;
    scene.fog.far = fogFar;
    hemi.color.set(t.hemiSky);
    hemi.groundColor.set(t.hemiGround);
    hemi.intensity = t.hemi;
    sun.color.set(t.sunColor);
    sun.intensity = t.sun;
    this.renderer.toneMappingExposure = t.exposure;
    GLOW.lamp.emissiveIntensity = t.glow ? 2.2 : 0.15;
    GLOW.window.emissiveIntensity = t.glow ? 1.1 : 0;
    GLOW.pool.visible = !!t.glow;
  }
}

// Grass seen from above: speckles and small tufts in a few greens, tiled across the ground.
export function grassTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#7d8a69';
  g.fillRect(0, 0, S, S);
  const greens = ['#6f7d5c', '#8a9873', '#748660', '#93a079', '#66734f', '#87906a'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = greens[i % greens.length];
    g.globalAlpha = 0.35 + Math.random() * 0.4;
    const x = Math.random() * S;
    const y = Math.random() * S;
    // Draw near the edges twice so the tile repeats without seams.
    for (const dx of [0, -S]) for (const dy of [0, -S]) {
      if ((dx && x < S - 4) || (dy && y < S - 4)) continue;
      g.fillRect(x + dx, y + dy, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
