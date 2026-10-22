// Displays inside the warehouse: the big capacity board, a sign on every rack row,
// and a sign above every dock door.
import * as THREE from 'three';
import { CS, LEVEL_H, SHELF0 } from './coords.js';

function canvasPanel(w, h, pxPerM = 110) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * pxPerM);
  cv.height = Math.round(h * pxPerM);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return { cv, g: cv.getContext('2d'), tex, mesh };
}

const fillColor = (f) => (f < 0.7 ? '#22c55e' : f < 0.9 ? '#f59e0b' : '#ef4444');
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function bar(g, x, y, w, h, frac) {
  g.fillStyle = '#1e293b';
  g.fillRect(x, y, w, h);
  g.fillStyle = fillColor(frac);
  g.fillRect(x, y, w * Math.min(1, frac), h);
}

export class Screens {
  constructor(scene, L, C) {
    this.L = L;
    this.C = C;
    const group = (this.group = new THREE.Group());
    scene.add(group);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5, metalness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.6, roughness: 0.4 });

    // Big board hanging above the shipping side, facing the docks.
    const bw = 12;
    const bh = 4.6;
    this.board = canvasPanel(bw, bh, 120);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.3, bh + 0.3, 0.2), frameMat);
    const boardY = 7.2;
    const boardZ = C.backZ - 0.6;
    frame.position.set(0, boardY, boardZ + 0.12);
    this.board.mesh.position.set(0, boardY, boardZ);
    this.board.mesh.rotation.y = Math.PI;
    group.add(frame, this.board.mesh);
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, boardY - bh / 2, 0.18), steel);
      pole.position.set(s * (bw / 2 - 0.5), (boardY - bh / 2) / 2, boardZ + 0.2);
      pole.castShadow = true;
      group.add(pole);
    }

    // Row signs at the front end of every rack row (facing the docks) and the back end.
    this.rowSigns = L.rows.map((r) => {
      const panels = [];
      for (const end of [-1, 1]) {
        const p = canvasPanel(CS * 2 - 0.1, 1.0, 160);
        const x = (C.x(r.xa) + C.x(r.xb)) / 2;
        const y = SHELF0 + r.levels * LEVEL_H + 0.75;
        const z = end < 0 ? C.z(L.zRack0) - CS / 2 - 0.05 : C.z(L.zRack1) + CS / 2 + 0.05;
        p.mesh.position.set(x, y, z);
        if (end > 0) p.mesh.rotation.y = 0;
        else p.mesh.rotation.y = Math.PI;
        const back = new THREE.Mesh(new THREE.BoxGeometry(CS * 2, 1.06, 0.06), frameMat);
        back.position.set(x, y, z - end * 0.04);
        group.add(back, p.mesh);
        panels.push(p);
      }
      return panels;
    });

    // Dock signs above each door, facing into the hall.
    this.dockSigns = L.docks.map((d) => {
      const p = canvasPanel(CS * 2.2, 0.8, 160);
      p.mesh.position.set(C.x(d.x), 4.25, C.frontZ + 0.18);
      const back = new THREE.Mesh(new THREE.BoxGeometry(CS * 2.3, 0.86, 0.06), frameMat);
      back.position.set(C.x(d.x), 4.25, C.frontZ + 0.12);
      group.add(back, p.mesh);
      return p;
    });
    this.lastDraw = -1;
  }

  update(sim, realTime) {
    if (realTime - this.lastDraw < 0.4) return;
    this.lastDraw = realTime;
    const s = sim.summary();
    this.drawBoard(s);
    s.rows.forEach((row, i) => {
      for (const p of this.rowSigns[i]) this.drawRow(p, row);
    });
    sim.docks.forEach((d, i) => this.drawDock(this.dockSigns[i], d));
  }

  drawBoard(s) {
    const { g, cv, tex } = this.board;
    const W = cv.width;
    const H = cv.height;
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, W, H);
    const frac = s.stored / s.capacity;
    g.fillStyle = '#94a3b8';
    g.font = `600 ${H * 0.07}px ${FONT}`;
    g.fillText('STORAGE CAPACITY', W * 0.04, H * 0.13);
    g.fillStyle = '#f8fafc';
    g.font = `700 ${H * 0.2}px ${FONT}`;
    const amount = `${s.stored} / ${s.capacity}`;
    g.fillText(amount, W * 0.04, H * 0.34);
    const amountW = g.measureText(amount).width;
    g.fillStyle = fillColor(frac);
    g.font = `700 ${H * 0.13}px ${FONT}`;
    g.fillText(`${Math.round(frac * 100)}%`, W * 0.04 + amountW + W * 0.025, H * 0.34);
    bar(g, W * 0.04, H * 0.39, W * 0.46, H * 0.06, frac);

    // Per row.
    const rowsY = H * 0.53;
    const rowH = (H * 0.43) / s.rows.length;
    g.font = `600 ${rowH * 0.6}px ${FONT}`;
    s.rows.forEach((r, i) => {
      const y = rowsY + i * rowH;
      const f = r.filled / r.capacity;
      g.fillStyle = '#e2e8f0';
      g.fillText(`Row ${r.name}`, W * 0.04, y + rowH * 0.65);
      bar(g, W * 0.15, y + rowH * 0.2, W * 0.22, rowH * 0.55, f);
      g.fillStyle = '#cbd5e1';
      g.fillText(`${r.filled}/${r.capacity}`, W * 0.39, y + rowH * 0.65);
    });

    // Right side: flow numbers.
    const items = [
      ['Orders open', s.openOrders, s.overdueOrders ? '#f59e0b' : '#f8fafc'],
      ['Overdue', s.overdueOrders, s.overdueOrders ? '#ef4444' : '#f8fafc'],
      ['Waiting for stock', s.backorderLines, s.backorderLines ? '#f59e0b' : '#f8fafc'],
      ['Shipped on time', s.ordersOnTime, '#22c55e'],
      ['Shipped late', s.ordersLate, s.ordersLate ? '#ef4444' : '#f8fafc'],
      ['Trucks waiting', s.trucksWaiting, s.trucksWaiting ? '#f59e0b' : '#f8fafc'],
    ];
    const colX = [W * 0.56, W * 0.79];
    items.forEach(([label, value, color], i) => {
      const x = colX[i % 2];
      const y = H * 0.12 + Math.floor(i / 2) * H * 0.29;
      g.fillStyle = '#94a3b8';
      g.font = `600 ${H * 0.055}px ${FONT}`;
      g.fillText(label.toUpperCase(), x, y);
      g.fillStyle = color;
      g.font = `700 ${H * 0.15}px ${FONT}`;
      g.fillText(String(value), x, y + H * 0.16);
    });
    tex.needsUpdate = true;
  }

  drawRow(p, r) {
    const { g, cv, tex } = p;
    const W = cv.width;
    const H = cv.height;
    const f = r.filled / r.capacity;
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f8fafc';
    g.font = `700 ${H * 0.42}px ${FONT}`;
    g.fillText(`ROW ${r.name}`, W * 0.06, H * 0.48);
    g.font = `600 ${H * 0.3}px ${FONT}`;
    g.fillStyle = fillColor(f);
    const txt = `${r.filled}/${r.capacity}`;
    g.fillText(txt, W * 0.94 - g.measureText(txt).width, H * 0.46);
    bar(g, W * 0.06, H * 0.64, W * 0.88, H * 0.18, f);
    tex.needsUpdate = true;
  }

  drawDock(p, d) {
    const { g, cv, tex } = p;
    const W = cv.width;
    const H = cv.height;
    const t = d.truck;
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#facc15';
    g.font = `700 ${H * 0.36}px ${FONT}`;
    g.fillText(`DOCK ${d.id + 1}`, W * 0.05, H * 0.42);
    g.font = `600 ${H * 0.26}px ${FONT}`;
    if (t) {
      const what = t.status === 'unloading' ? `unloading ${t.unloaded}/${t.load.length}` : t.status === 'docking' ? 'docking' : 'leaving';
      g.fillStyle = t.late ? '#f59e0b' : '#e2e8f0';
      g.fillText(`${t.name} · ${what}`, W * 0.05, H * 0.82);
    } else {
      g.fillStyle = '#64748b';
      g.fillText(d.buffer.length ? `${d.buffer.length} boxes on dock` : 'free', W * 0.05, H * 0.82);
    }
    tex.needsUpdate = true;
  }
}
