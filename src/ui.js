// Everything on screen that is not 3D: top bar, side panel, info card, settings.
import { SIZES } from './sim/sim.js';

const $ = (id) => document.getElementById(id);
const START_HOUR = 6;

export function clockText(seconds) {
  const s = Math.floor(seconds) + START_HOUR * 3600;
  const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
const hm = (seconds) => clockText(seconds).slice(0, 5);
const minutes = (s) => (s < 60 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Ui {
  constructor(sim, handlers) {
    this.sim = sim;
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
    const dlg = $('settings');
    const bind = (input, out, get, set, fmt) => {
      const el = $(input);
      const show = () => { $(out).textContent = fmt(Number(el.value)); };
      el.addEventListener('input', () => { show(); set(Number(el.value)); });
      this.refreshers.push(() => { el.value = get(); show(); });
    };
    this.refreshers = [];
    bind('setRobots', 'robotsOut', () => sim.settings.robots, () => {}, (v) => v);
    bind('setTruck', 'truckOut', () => sim.settings.truckEverySeconds, (v) => { sim.settings.truckEverySeconds = v; }, (v) => `${v} s`);
    bind('setOrders', 'ordersOut', () => sim.settings.ordersPerMinute, (v) => { sim.settings.ordersPerMinute = v; }, (v) => v);
    bind('setFill', 'fillOut', () => Math.round(sim.settings.targetFill * 100), (v) => { sim.settings.targetFill = v / 100; }, (v) => `${v}%`);
    $('settingsBtn').addEventListener('click', () => {
      for (const r of this.refreshers) r();
      dlg.showModal();
    });
    $('setTheme').addEventListener('change', (e) => this.h.onTheme(e.target.value));
    $('setShadows').addEventListener('change', (e) => this.h.onShadows(e.target.value === 'on'));
    $('restart').addEventListener('click', () => {
      const robots = Number($('setRobots').value);
      this.h.onRestart({ ...sim.settings, robots });
      this.buildRows();
      dlg.close();
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
    $('infoActions').innerHTML = (sel.type === 'robot' ? '<button id="rideBtn" class="primary">Ride along</button>' : '') + '<button id="closeInfo">Close</button>';
    if (sel.type === 'robot') $('rideBtn').onclick = () => { this.setView('ride'); this.h.onView('ride'); };
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
            <dt>Order</dt><dd>${order ? `${esc(order.name)}, due ${hm(order.due)}` : 'Free stock'}</dd>
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
      : `Bringing ${name} to shipping ${(order?.ship ?? 0) + 1}`;
  }

  robotStatus(r) {
    if (r.mode === 'act') return r.action.kind === 'store' || r.action.kind === 'pickup' ? `Lifting to level ${r.action.level + 1}` : 'Handling a box';
    if (r.mode === 'travel') return r.cell === r.prev && r.plan ? 'Letting another robot pass' : 'Driving';
    if (r.mode === 'plan' && r.blockedSince !== undefined) return 'Waiting for a free route';
    return r.mode === 'idle' ? 'Parked' : 'Planning route';
  }

  // ---------- side panel ----------
  update(realTime) {
    $('clock').textContent = clockText(this.sim.time);
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

    // Arrivals board, like at an airport.
    const now = sim.time;
    const rows = sim.arrivals().map((t) => {
      let status;
      let c = '';
      if (t.status === 'planned') {
        const delay = t.arrival - t.planned;
        // The carrier announces a delay shortly before the planned time.
        if (delay > 60 && now > t.planned - 45) {
          status = `Delayed ~${Math.round(delay / 60)} min`;
          c = 'warn';
        } else {
          status = 'On the way';
        }
      } else if (t.status === 'yard') {
        status = 'Waiting for dock';
        c = 'warn';
      } else if (t.status === 'docking') status = `Docking at ${t.dock + 1}`;
      else if (t.status === 'unloading') status = `Unloading ${t.unloaded}/${t.load.length}`;
      else status = 'Leaving';
      if (t.late && t.status !== 'planned') c = c || 'warn';
      return `<tr><td>${esc(t.name)}</td><td>${hm(t.planned)}</td><td>${t.load.length}</td><td class="${c}">${status}</td></tr>`;
    });
    $('arrivals').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="4" class="muted">No trucks planned</td></tr>';

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
