// =============================================================
//  GRAFIK GARIS SEDERHANA (SVG, tanpa library)
//  - garis 2px, area tipis, grid tipis
//  - geser jari / mouse = garis bantu + kotak info
//  - bisa pakai keyboard (panah kiri/kanan)
// =============================================================
const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= count + 0.5) || 10 * pow;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/**
 * points: [{ label: '26 Nov', value: 123, date: Date }]
 * opts: { formatValue, formatTick, ariaLabel }
 */
export function renderLineChart(container, points, opts) {
  container.replaceChildren();
  if (!points.length) return;

  const W = Math.max(container.clientWidth, 280);
  const H = 240;
  const pad = { top: 16, right: 14, bottom: 28, left: 64 };
  const ih = H - pad.top - pad.bottom;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const extra = (max - min) * 0.08 || max * 0.01;
  min -= extra;
  max += extra;
  const ticks = niceTicks(min, max, 4).filter((t) => t >= min && t <= max);
  // ruang kiri menyesuaikan panjang angka sumbu Y
  const maxLen = Math.max(...ticks.map((t) => opts.formatTick(t).length));
  pad.left = Math.max(40, Math.round(maxLen * 6.8 + 14));
  const iw = W - pad.left - pad.right;

  const x = (i) => pad.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.top + ih - ((v - min) / (max - min)) * ih;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    role: 'img',
    'aria-label': opts.ariaLabel,
    tabindex: '0',
    class: 'chart-svg',
  });

  // grid + label sumbu Y
  for (const t of ticks) {
    svg.append(el('line', { x1: pad.left, x2: W - pad.right, y1: y(t), y2: y(t), class: 'grid' }));
    const tx = el('text', { x: pad.left - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' });
    tx.textContent = opts.formatTick(t);
    svg.append(tx);
  }
  // label sumbu X (maks 5 label)
  const n = Math.min(5, points.length);
  for (let k = 0; k < n; k++) {
    const i = n === 1 ? 0 : Math.round((k / (n - 1)) * (points.length - 1));
    const tx = el('text', {
      x: x(i),
      y: H - 8,
      class: 'tick',
      'text-anchor': k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle',
    });
    tx.textContent = points[i].label;
    svg.append(tx);
  }
  svg.append(el('line', { x1: pad.left, x2: W - pad.right, y1: pad.top + ih, y2: pad.top + ih, class: 'axis' }));

  // area + garis
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  svg.append(el('path', { d: `${d}L${x(points.length - 1)},${pad.top + ih}L${x(0)},${pad.top + ih}Z`, class: 'area' }));
  svg.append(el('path', { d, class: 'line' }));

  // titik akhir + label nilai terakhir
  const last = points.length - 1;
  svg.append(el('circle', { cx: x(last), cy: y(points[last].value), r: 4.5, class: 'dot' }));

  // lapisan hover
  const cross = el('line', { y1: pad.top, y2: pad.top + ih, class: 'cross', visibility: 'hidden' });
  const hoverDot = el('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
  svg.append(cross, hoverDot);
  const hit = el('rect', { x: pad.left, y: 0, width: iw, height: H, fill: 'transparent' });
  svg.append(hit);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const tipVal = document.createElement('strong');
  const tipLbl = document.createElement('span');
  tip.append(tipVal, tipLbl);

  container.append(svg, tip);

  let active = -1;
  const show = (i) => {
    active = Math.max(0, Math.min(points.length - 1, i));
    const p = points[active];
    const px = x(active);
    const py = y(p.value);
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', px);
    hoverDot.setAttribute('cy', py);
    hoverDot.setAttribute('visibility', 'visible');
    tipVal.textContent = opts.formatValue(p.value);
    tipLbl.textContent = p.fullLabel || p.label;
    tip.hidden = false;
    const scale = container.clientWidth / W || 1;
    const tw = tip.offsetWidth;
    let left = px * scale + 12;
    if (left + tw > container.clientWidth) left = px * scale - tw - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, py * scale - 44)}px`;
  };
  const hide = () => {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const fromEvent = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    return Math.round(((sx - pad.left) / iw) * (points.length - 1));
  };
  svg.addEventListener('pointermove', (ev) => show(fromEvent(ev)));
  svg.addEventListener('pointerdown', (ev) => show(fromEvent(ev)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(points.length - 1));
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') show((active < 0 ? points.length : active) - 1);
    else if (ev.key === 'ArrowRight') show(active + 1);
    else if (ev.key === 'Home') show(0);
    else if (ev.key === 'End') show(points.length - 1);
    else return;
    ev.preventDefault();
  });
}

/**
 * GRAFIK INTRADAY (sumbu waktu) + lajur sesi di bawahnya
 * points: [{ ms, value, extra? }] urut waktu
 * opts: {
 *   from, to,                    // rentang waktu (ms)
 *   lanes: [{ id, code, segs: [[startMs, endMs], ...] }],
 *   formatValue, formatTick,     // angka
 *   formatTime(ms), formatDay(ms) // label waktu (WIB)
 *   dayStarts: [ms, ...]         // jam 00:00 WIB tiap hari (untuk garis hari)
 *   ariaLabel, maxGapMs
 * }
 */
export function renderIntradayChart(container, points, opts) {
  container.replaceChildren();
  if (points.length < 2) return;
  const W = Math.max(container.clientWidth, 280);
  const laneH = 6;
  const laneGap = 6;
  const lanesH = opts.lanes.length * (laneH + laneGap);
  const plotH = 200;
  const pad = { top: 14, right: 14, bottom: 22 + lanesH + 8, left: 56 };
  const H = pad.top + plotH + pad.bottom;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const extra = (max - min) * 0.1 || max * 0.002;
  min -= extra;
  max += extra;
  const ticks = niceTicks(min, max, 4).filter((t) => t >= min && t <= max);
  const maxLen = Math.max(...ticks.map((t) => opts.formatTick(t).length));
  pad.left = Math.max(40, Math.round(maxLen * 6.8 + 14));
  const iw = W - pad.left - pad.right;
  const t0 = opts.from;
  const t1 = opts.to;
  const x = (ms) => pad.left + ((ms - t0) / (t1 - t0)) * iw;
  const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.ariaLabel, tabindex: '0', class: 'chart-svg' });

  for (const t of ticks) {
    svg.append(el('line', { x1: pad.left, x2: W - pad.right, y1: y(t), y2: y(t), class: 'grid' }));
    const tx = el('text', { x: pad.left - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' });
    tx.textContent = opts.formatTick(t);
    svg.append(tx);
  }
  // garis pergantian hari + label waktu
  const span = t1 - t0;
  const days = (opts.dayStarts || []).filter((d) => d > t0 && d < t1);
  for (const d of days) svg.append(el('line', { x1: x(d), x2: x(d), y1: pad.top, y2: pad.top + plotH, class: 'grid' }));
  const labels = [];
  if (span <= 36 * 3600e3) {
    const step = (W < 480 ? 6 : 3) * 3600e3;
    const first = Math.ceil((t0 + 7 * 3600e3) / step) * step - 7 * 3600e3; // kelipatan jam WIB
    for (let ms = first; ms <= t1; ms += step) labels.push([ms, opts.formatTime(ms)]);
  } else {
    for (const d of days) labels.push([d, opts.formatDay(d)]);
  }
  for (const [ms, text] of labels) {
    const px = x(ms);
    if (px < pad.left + 12 || px > W - pad.right - 12) continue;
    const tx = el('text', { x: px, y: pad.top + plotH + 15, class: 'tick', 'text-anchor': 'middle' });
    tx.textContent = text;
    svg.append(tx);
  }
  svg.append(el('line', { x1: pad.left, x2: W - pad.right, y1: pad.top + plotH, y2: pad.top + plotH, class: 'axis' }));

  // garis harga (putus kalau ada jeda panjang, mis. akhir pekan)
  const gap = opts.maxGapMs || 3 * 3600e3;
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (cur.length && p.ms - cur.at(-1).ms > gap) {
      segs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  for (const sg of segs) {
    const d = sg.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    if (sg.length > 1) {
      svg.append(el('path', { d: `${d}L${x(sg.at(-1).ms).toFixed(1)},${pad.top + plotH}L${x(sg[0].ms).toFixed(1)},${pad.top + plotH}Z`, class: 'area' }));
    }
    svg.append(el('path', { d, class: 'line' }));
  }
  const last = points.at(-1);
  svg.append(el('circle', { cx: x(last.ms), cy: y(last.value), r: 4.5, class: 'dot' }));

  // lajur sesi
  const laneTop = pad.top + plotH + 24;
  opts.lanes.forEach((lane, i) => {
    const ly = laneTop + i * (laneH + laneGap);
    svg.append(el('rect', { x: pad.left, y: ly, width: iw, height: laneH, class: 'lane-track' }));
    for (const [a, b] of lane.segs) {
      const xa = Math.max(pad.left, x(Math.max(a, t0)));
      const xb = Math.min(W - pad.right, x(Math.min(b, t1)));
      if (xb - xa > 0.5) svg.append(el('rect', { x: xa, y: ly, width: xb - xa, height: laneH, rx: 1, class: `lane s-${lane.id}` }));
    }
    const lt = el('text', { x: pad.left - 8, y: ly + laneH + 1, class: 'tick lane-label', 'text-anchor': 'end' });
    lt.textContent = lane.code;
    svg.append(lt);
  });

  // hover
  const cross = el('line', { y1: pad.top, y2: pad.top + plotH, class: 'cross', visibility: 'hidden' });
  const hoverDot = el('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
  svg.append(cross, hoverDot);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const tipVal = document.createElement('strong');
  const tipLbl = document.createElement('span');
  tip.append(tipVal, tipLbl);
  container.append(svg, tip);

  let active = -1;
  const show = (i) => {
    active = Math.max(0, Math.min(points.length - 1, i));
    const p = points[active];
    const px = x(p.ms);
    const py = y(p.value);
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', px);
    hoverDot.setAttribute('cy', py);
    hoverDot.setAttribute('visibility', 'visible');
    tipVal.textContent = opts.formatValue(p.value);
    tipLbl.textContent = p.label || opts.formatTime(p.ms);
    tip.hidden = false;
    const scale = container.clientWidth / W || 1;
    let left = px * scale + 12;
    if (left + tip.offsetWidth > container.clientWidth) left = px * scale - tip.offsetWidth - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, py * scale - 44)}px`;
  };
  const hide = () => {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const nearest = (ev) => {
    const r = svg.getBoundingClientRect();
    const ms = t0 + ((((ev.clientX - r.left) / r.width) * W - pad.left) / iw) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].ms - ms) < Math.abs(points[best].ms - ms)) best = i;
    return best;
  };
  svg.addEventListener('pointermove', (ev) => show(nearest(ev)));
  svg.addEventListener('pointerdown', (ev) => show(nearest(ev)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(points.length - 1));
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') show((active < 0 ? points.length : active) - 1);
    else if (ev.key === 'ArrowRight') show(active + 1);
    else if (ev.key === 'Home') show(0);
    else if (ev.key === 'End') show(points.length - 1);
    else return;
    ev.preventDefault();
  });
}
