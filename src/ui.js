// Everything on screen that is not 3D: top bar, side panel, info card, settings.
import { SIZES } from './sim/sim.js';
import { CLOCK_SPEED, START_HOUR } from './sim/world.js';

const $ = (id) => document.getElementById(id);

// Wall clock text for a warehouse time in seconds (the clock runs 30x faster).
export function clockText(simSeconds) {
  const s = Math.floor(START_HOUR * 3600 + simSeconds * CLOCK_SPEED);
  const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
const hm = clockText;
const dayText = (simSeconds) => `Day ${1 + Math.floor((START_HOUR * 3600 + simSeconds * CLOCK_SPEED) / 86400)} · ${clockText(simSeconds)}`;
// A stretch of warehouse time as wall-clock time ("2 h 15 min").
const minutes = (simSeconds) => {
  const m = Math.round((simSeconds * CLOCK_SPEED) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Ui {
  constructor(world, handlers) {
    this.world = world;
    this.sim = world.sim;
    this.h = handlers;
    this.speed = 1;
    this.paused = false;
    this.selected = null;
    this.lastUpdate = -1;
    this.lastLogCount = -1;

    $('speed').addEventListener('input', (e) => {
      this.speed = Number(e.target.value);
      $('speedLabel').textContent = `${this.speed}x`;
    });
    $('pause').addEventListener('click', () => this.togglePause());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !$('settings').open) {
        e.preventDefault();
        this.togglePause();
      }
    });

    for (const b of document.querySelectorAll('#views button')) {
      b.addEventListener('click', () => {
        this.setView(b.dataset.view);
        this.h.onView(b.dataset.view);
      });
    }

    $('panelToggle').addEventListener('click', () => {
      const p = $('panel');
      p.classList.toggle('collapsed');
      $('panelToggle').textContent = p.classList.contains('collapsed') ? 'Show' : 'Hide';
    });
    if (window.innerWidth < 900) $('panelToggle').click();

    this.setupSettings();
    this.buildRows();
    $('arrivals').addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-truck]');
      if (row) this.select({ type: 'truck', id: Number(row.dataset.truck) });
    });
  }

  togglePause() {
    this.paused = !this.paused;
    $('pause').textContent = this.paused ? '▶' : '❚❚';
  }

  setView(name) {
    for (const b of document.querySelectorAll('#views button')) b.classList.toggle('active', b.dataset.view === name);
  }

  setFps(fps) {
    const el = $('fps');
    el.textContent = `${fps} FPS`;
    el.className = fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad';
  }

  // ---------- settings (no code needed) ----------
  setupSettings() {
    const sim = this.sim;
    const world = this.world;
    const dlg = $('settings');
    const bind = (input, out, get, set, fmt) => {
      const el = $(input);
      const show = () => { $(out).textContent = fmt(Number(el.value)); };
      el.addEventListener('input', () => { show(); set(Number(el.value)); });
      this.refreshers.push(() => { el.value = get(); show(); });
    };
    this.refreshers = [];
    bind('setRobots', 'robotsOut', () => world.settings.robots, () => {}, (v) => v);
    bind('setFactories', 'factoriesOut', () => world.settings.factories, () => {}, (v) => v);
    bind('setStores', 'storesOut', () => world.settings.stores, () => {}, (v) => v);
    bind('setFleet', 'fleetOut', () => world.settings.trucksPerFactory, (v) => { world.settings.trucksPerFactory = v; }, (v) => v);
    bind('setCustomers', 'customersOut', () => world.settings.customersPerHour, (v) => { world.settings.customersPerHour = v; }, (v) => v);
    bind('setFill', 'fillOut', () => Math.round(world.settings.targetFill * 100), (v) => { world.settings.targetFill = v / 100; }, (v) => `${v}%`);
    $('settingsBtn').addEventListener('click', () => {
      for (const r of this.refreshers) r();
      dlg.showModal();
    });
    $('setTheme').addEventListener('change', (e) => this.h.onTheme(e.target.value));
    $('setShadows').addEventListener('change', (e) => this.h.onShadows(e.target.value === 'on'));
    $('restart').addEventListener('click', () => {
      this.h.onRestart({
        robots: Number($('setRobots').value),
        factories: Number($('setFactories').value),
        stores: Number($('setStores').value),
      });
    });
  }

  buildRows() {
    const rows = $('rows');
    rows.innerHTML = '';
    for (const r of this.sim.layout.rows) {
      rows.insertAdjacentHTML(
        'beforeend',
        `<span>Row ${r.name} <small class="muted">(${r.levels} levels)</small></span><div class="bar"><div id="rowBar${r.id}"></div></div><span class="num" id="rowNum${r.id}"></span>`,
      );
    }
  }

  // ---------- selection ----------
  select(sel) {
    this.selected = sel;
    const box = $('info');
    if (!sel) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    // Buttons are drawn once per selection so clicks are never lost on a refresh.
    box.innerHTML = '<div id="infoBody"></div><div class="actions" id="infoActions"></div>';
    this.lastInfo = null;
    const extra = sel.type === 'robot' ? '<button id="rideBtn" class="primary">Ride along</button>'
      : sel.type === 'truck' ? '<button id="followBtn" class="primary">Follow</button>' : '';
    $('infoActions').innerHTML = `${extra}<button id="closeInfo">Close</button>`;
    if (sel.type === 'robot') $('rideBtn').onclick = () => { this.setView('ride'); this.h.onView('ride'); };
    if (sel.type === 'truck') $('followBtn').onclick = () => { this.setView(''); this.h.onFollow(sel.id); };
    $('closeInfo').onclick = () => this.select(null);
    this.renderInfo();
  }

  renderInfo() {
    const sel = this.selected;
    const sim = this.sim;
    if (!sel) return;
    const box = $('infoBody');
    let html;
    if (sel.type === 'robot') {
      const r = sim.robots[sel.index];
      if (!r) return this.select(null);
      html = `
        <h3>🤖 Robot ${esc(r.name)}</h3>
        <dl>
          <dt>Doing</dt><dd>${esc(this.robotJob(r))}</dd>
          <dt>Status</dt><dd>${esc(this.robotStatus(r))}</dd>
          <dt>Jobs done</dt><dd>${r.tasksDone}</dd>
        </dl>`;
    } else if (sel.type === 'truck') {
      const t = this.world.trucks.find((x) => x.id === sel.id);
      if (!t) {
        html = '<h3>🚚 Truck parked</h3><p class="muted">This truck finished its trip.</p>';
      } else {
        const counts = new Map();
        for (const p of t.cargo) counts.set(p, (counts.get(p) || 0) + 1);
        const what = [...counts].map(([p, n]) => `${n} × ${sim.products[p].name}`).join(', ') || 'Empty';
        html = `
          <h3>🚚 Truck ${esc(t.name)}</h3>
          <dl>
            <dt>Route</dt><dd>${esc(t.label)}</dd>
            <dt>Cargo</dt><dd>${esc(what)}</dd>
            <dt>Speed</dt><dd>${Math.round(t.speed * 3.6)} km/h</dd>
          </dl>`;
      }
    } else {
      const b = sim.boxes.get(sel.id);
      if (!b) {
        html = '<h3>📦 Box shipped</h3><p class="muted">This box has left the warehouse.</p>';
      } else {
        const p = sim.products[b.product];
        const slot = b.slot !== null ? sim.slots[b.slot] : null;
        const where = slot
          ? `Row ${sim.rowName(slot.row)}, spot ${slot.z - sim.layout.zRack0 + 1}, level ${slot.level + 1}`
          : b.state === 'dock' ? `Dock ${b.dock + 1}, waiting to be stored` : 'On a robot';
        const order = b.order ? sim.orders.find((o) => o.id === b.order) : null;
        html = `
          <h3><span class="swatch" style="background:hsl(${Math.round(p.hue * 360)} ${Math.round(p.sat * 100)}% ${Math.round(p.light * 100)}%)"></span>📦 ${esc(p.name)}</h3>
          <dl>
            <dt>Box</dt><dd>#${b.id}, size ${SIZES[b.size]}</dd>
            <dt>Where</dt><dd>${esc(where)}</dd>
            <dt>Came on</dt><dd>${esc(b.truck)} at ${hm(b.arrivedAt)}</dd>
            ${b.storedAt !== null ? `<dt>On shelf</dt><dd>${minutes(sim.time - b.storedAt)}</dd>` : ''}
            <dt>Order</dt><dd>${order ? `${esc(order.name)} for ${esc(order.store ?? 'a store')}, due ${hm(order.due)}` : 'Free stock'}</dd>
          </dl>`;
      }
    }
    if (html !== this.lastInfo) box.innerHTML = this.lastInfo = html;
  }

  robotJob(r) {
    const sim = this.sim;
    const t = r.task;
    if (!t || t.type === 'park') return r.mode === 'idle' ? 'Charging, waiting for a job' : 'Driving to a charging spot';
    const box = sim.boxes.get(t.box);
    const name = box ? sim.products[box.product].name : 'a box';
    if (t.type === 'put') {
      const slot = sim.slots[t.steps[1].action.slot];
      return t.i === 0
        ? `Collecting ${name} from dock ${t.steps[0].action.dock + 1}`
        : `Storing ${name} in row ${sim.rowName(slot.row)}, level ${slot.level + 1}`;
    }
    const order = sim.orders.find((o) => o.id === t.order);
    return t.i === 0
      ? `Picking ${name} for order ${order?.name ?? ''}`
      : `Bringing ${name} to the truck for ${order?.store ?? `lane ${(order?.ship ?? 0) + 1}`}`;
  }

  robotStatus(r) {
    if (r.mode === 'act') return r.action.kind === 'store' || r.action.kind === 'pickup' ? `Lifting to level ${r.action.level + 1}` : 'Handling a box';
    if (r.mode === 'travel') return r.cell === r.prev && r.plan ? 'Letting another robot pass' : 'Driving';
    if (r.mode === 'plan' && r.blockedSince !== undefined) return 'Waiting for a free route';
    return r.mode === 'idle' ? 'Parked' : 'Planning route';
  }

  // ---------- side panel ----------
  update(realTime) {
    $('clock').textContent = dayText(this.sim.time);
    if (realTime - this.lastUpdate < 0.25) return;
    this.lastUpdate = realTime;
    const sim = this.sim;
    const s = sim.summary();
    const frac = s.stored / s.capacity;
    const cls = (f) => (f < 0.7 ? 'var(--good)' : f < 0.9 ? 'var(--warn)' : 'var(--bad)');
    $('stored').textContent = s.stored;
    $('capacity').textContent = s.capacity;
    $('fillPct').textContent = `${Math.round(frac * 100)}%`;
    $('fillPct').style.color = cls(frac);
    $('fillBar').style.width = `${frac * 100}%`;
    $('fillBar').style.background = cls(frac);
    s.rows.forEach((r, i) => {
      const f = r.filled / r.capacity;
      const bar = $(`rowBar${i}`);
      if (!bar) return;
      bar.style.width = `${f * 100}%`;
      bar.style.background = cls(f);
      $(`rowNum${i}`).textContent = `${r.filled}/${r.capacity}`;
    });

    const set = (id, v, state) => {
      const el = $(id);
      el.textContent = v;
      el.className = state || '';
    };
    set('openOrders', s.openOrders);
    set('overdue', s.overdueOrders, s.overdueOrders ? 'bad' : '');
    set('backorders', s.backorderLines, s.backorderLines ? 'warn' : '');
    set('onTime', s.ordersOnTime, 'good');
    set('late', s.ordersLate, s.ordersLate ? 'bad' : '');
    const shipped = s.ordersOnTime + s.ordersLate;
    const rate = shipped ? s.ordersOnTime / shipped : null;
    set('onTimePct', rate === null ? '–' : `${Math.round(rate * 100)}%`, rate === null ? '' : rate > 0.9 ? 'good' : rate > 0.75 ? 'warn' : 'bad');
    set('busy', `${s.busyRobots}/${sim.robots.length}`);
    const moved = s.waitTicks + s.moveTicks;
    set('waitPct', moved ? `${((100 * s.waitTicks) / moved).toFixed(1)}%` : '0%');
    set('dwell', s.dwellCount ? minutes(s.avgDwell) : '–');

    // Supply chain at a glance.
    const w = this.world.summary();
    set('chainFactory', w.factoryStock);
    set('chainRoad', w.onRoad);
    set('chainWarehouse', s.stored);
    set('chainStores', w.storeStock);
    set('chainSold', w.sold, 'good');
    const lostPct = w.sold + w.lost ? (100 * w.lost) / (w.sold + w.lost) : 0;
    set('chainLost', `${lostPct.toFixed(1)}%`, lostPct > 5 ? 'bad' : lostPct > 2 ? 'warn' : '');

    // Trucks on the road, like a departures board.
    const rows = this.world.trucks
      .filter((t) => t.state === 'drive' || t.cargo.length)
      .slice(0, 8)
      .map((t) => `<tr data-truck="${t.id}"><td>${esc(t.name)}</td><td>${esc(t.label)}</td><td>${t.cargo.length}</td></tr>`);
    const yard = sim.trucks.filter((t) => t.status !== 'gone' && t.status !== 'planned');
    for (const t of yard) {
      const st = t.status === 'yard' ? '<span class="warn">waiting for a dock</span>' : t.status === 'unloading' ? `unloading ${t.unloaded}/${t.load.length}` : t.status;
      rows.push(`<tr><td>${esc(t.name)}</td><td>At warehouse: ${st}</td><td>${t.load.length - t.unloaded}</td></tr>`);
    }
    $('arrivals').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="3" class="muted">No trucks driving</td></tr>';
    $('truckCount').textContent = `${w.trucks} trucks`;

    if (sim.events.length !== this.lastLogCount || sim.events.at(-1)?.time !== this.lastLogTime) {
      this.lastLogCount = sim.events.length;
      this.lastLogTime = sim.events.at(-1)?.time;
      $('log').innerHTML = sim.events
        .slice(-25)
        .reverse()
        .map((e) => `<li class="${e.kind === 'warn' ? 'warn' : ''}"><time>${hm(e.time)}</time>${esc(e.text)}</li>`)
        .join('');
    }
    if (this.selected) this.renderInfo();
  }
}
