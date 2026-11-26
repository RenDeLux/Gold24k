// =============================================================
//  GOLD24K — logika halaman
//  Alur: ambil data robot (folder data/) + harga live → gambar semua bagian
//  Semua teks lewat t() (lihat i18n.js), jadi bisa ID / EN.
// =============================================================
import {
  SESSIONS,
  HOUR,
  wibDate,
  wibHour,
  addDays,
  isWeekend,
  sessionWindows,
  sessionStats,
  openSessionsAt,
  nextOpening,
  tradingDates,
  keyTimesWib,
} from './sessions.js';
import { renderLineChart, renderIntradayChart } from './chart.js';
import { t, fmt, getLang, setLang, applyStatic } from './i18n.js';
import { startLive } from './live.js';

const OZ_GRAM = 31.1034768; // 1 troy ons = 31,1 gram
const LIVE_EVERY_MS = 60_000;

const $ = (id) => document.getElementById(id);
const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const arrow = (n, eps = 0.005) => (n > eps ? '▲' : n < -eps ? '▼' : '■');
const dir = (n, eps = 0.005) => (n > eps ? 'up' : n < -eps ? 'down' : 'flat');
const dateMs = (dateStr) => Date.parse(dateStr + 'T00:00:00Z');

// ---------------- ambil data ----------------
async function fetchJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
const safe = (p) => p.catch((e) => (console.warn(e), null));

const state = {
  samples: [], // snapshot per jam dari robot: {ms, usd, idr}
  daily: [], // harga harian: {d, usd, idr}
  news: [],
  newsUpdated: null,
  live: null, // {usd, ms, source}
  fx: null, // {idr, ms, source}
  newsCat: 'all',
  newsShown: 12,
  range: 90,
  unit: 'idr',
  reports: [],
  reportsShown: 6,
  liveTicks: [], // harga live selama halaman terbuka (tiap menit)
  intraDays: 1,
};

async function loadRobotData() {
  const bust = `?v=${Math.floor(Date.now() / 60000)}`;
  const [prices, daily, news, reports] = await Promise.all([
    safe(fetchJSON('data/prices.json' + bust)),
    safe(fetchJSON('data/daily.json' + bust)),
    safe(fetchJSON('data/news.json' + bust)),
    safe(fetchJSON('data/reports.json' + bust)),
  ]);
  state.reports = (reports?.items || []).filter((r) => r && /^[0-9a-z-]+$/.test(r.id) && r.title);
  state.samples = (prices?.samples || [])
    .map((s) => ({ ms: Date.parse(s.t), usd: +s.usd, idr: s.idr ? +s.idr : null }))
    .filter((s) => isFinite(s.ms) && s.usd > 0)
    .sort((a, b) => a.ms - b.ms);
  state.daily = (daily?.days || []).filter((d) => d.usd > 0).sort((a, b) => a.d.localeCompare(b.d));
  state.news = (news?.items || []).filter((n) => n && n.title && /^https?:\/\//.test(n.url));
  state.newsUpdated = news?.updated ? Date.parse(news.updated) : null;
}

async function loadLive() {
  try {
    const j = await fetchJSON('https://api.gold-api.com/price/XAU');
    if (j?.price > 0) {
      state.live = { usd: +j.price, ms: Date.parse(j.updatedAt) || Date.now(), source: 'gold-api.com' };
      if (openSessionsAt(Date.now()).length) {
        state.liveTicks.push({ ms: Date.now(), usd: state.live.usd });
        if (state.liveTicks.length > 1500) state.liveTicks.shift();
      }
    }
  } catch (e) {
    console.warn('live price', e);
  }
  if (!state.fx || Date.now() - state.fx.fetched > 30 * 60e3) {
    try {
      const j = await fetchJSON('https://open.er-api.com/v6/latest/USD');
      if (j?.rates?.IDR > 0)
        state.fx = { idr: +j.rates.IDR, ms: (j.time_last_update_unix || 0) * 1000, source: 'open.er-api.com', fetched: Date.now() };
    } catch (e) {
      console.warn('live fx', e);
    }
  }
  if (!state.live && !state.samples.length) {
    try {
      const j = await fetchJSON('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json');
      if (j?.usd?.xau > 0) state.live = { usd: 1 / j.usd.xau, ms: Date.parse(j.date) || Date.now(), source: 'currency-api' };
      if (!state.fx && j?.usd?.idr > 0) state.fx = { idr: j.usd.idr, ms: Date.parse(j.date), source: 'currency-api', fetched: Date.now() };
    } catch (e) {
      console.warn('fallback', e);
    }
  }
}

// harga & kurs terkini (live dulu, kalau gagal pakai snapshot robot)
function current() {
  const lastS = state.samples.at(-1);
  const lastD = state.daily.at(-1);
  const usd = state.live?.usd ?? lastS?.usd ?? lastD?.usd ?? null;
  const ms = state.live?.ms ?? lastS?.ms ?? null;
  const idr = state.fx?.idr ?? [...state.samples].reverse().find((s) => s.idr)?.idr ?? lastD?.idr ?? null;
  const source = state.live?.source ?? (lastS ? t('src.snapshot') : null);
  return { usd, idr, ms, source, gramIdr: usd && idr ? (usd / OZ_GRAM) * idr : null };
}

// harga penutupan hari kerja sebelumnya
function previousClose() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const prev = state.daily.filter((d) => d.d < todayUtc).at(-1);
  if (prev) return { usd: prev.usd, idr: prev.idr, label: t('hero.vsPrev', { date: fmt.dateShort(prev.d) }), ref: fmt.dateShort(prev.d) };
  const target = Date.now() - 24 * HOUR;
  const s = state.samples.filter((p) => p.ms <= target).at(-1);
  return s ? { usd: s.usd, idr: s.idr, label: t('hero.vs24h'), ref: t('hero.vs24h').replace(/^vs\.? /, '') } : null;
}

function samplesWithLive() {
  const arr = state.samples.slice();
  const now = Date.now();
  if (state.live && openSessionsAt(now).length && (!arr.length || now > arr.at(-1).ms)) {
    arr.push({ ms: now, usd: state.live.usd, idr: state.fx?.idr ?? arr.at(-1)?.idr ?? null });
  }
  return arr;
}

// "hari perdagangan" yang relevan (akhir pekan/dini hari → hari kerja sebelumnya)
function displayDate(now = Date.now()) {
  let d = wibDate(now);
  for (let i = 0; i < 5; i++) {
    if (!isWeekend(d) && sessionWindows(d)[0].start <= now) return d;
    d = addDays(d, -1);
  }
  return wibDate(now);
}

const sessName = (w) => w.name;
const marketOpenNow = () => openSessionsAt(Date.now()).length > 0;

// ---------------- TICKER ----------------
function renderTicker() {
  const c = current();
  const prev = previousClose();
  const box = $('ticker');
  box.replaceChildren();
  const inner = make('div', 'wrap ticker-in');
  const item = (label, value, chg) => {
    const it = make('span', 'tick');
    it.append(make('span', 'tick-label', label), make('span', 'tick-value', value));
    if (chg != null) it.append(make('span', `tick-chg ${dir(chg)}`, `${arrow(chg)} ${fmt.pct(chg)}`));
    inner.append(it);
  };
  const pct = c.usd && prev?.usd ? ((c.usd - prev.usd) / prev.usd) * 100 : null;
  item('XAU/USD', fmt.usd(c.usd), pct);
  const prevGram = prev?.usd && prev?.idr ? (prev.usd / OZ_GRAM) * prev.idr : null;
  item('XAU/IDR/g', fmt.idr(c.gramIdr), c.gramIdr && prevGram ? ((c.gramIdr - prevGram) / prevGram) * 100 : null);
  item('USD/IDR', fmt.num(c.idr, 0));
  const open = openSessionsAt(Date.now());
  item(t('tick.session'), open.length ? open.map((w) => w.code).join(' · ') : t('tick.closed'));
  box.append(inner);
}

// ---------------- HERO ----------------
function renderHero() {
  const c = current();
  const prev = previousClose();
  $('heroIdr').textContent = c.gramIdr ? fmt.idr(c.gramIdr) : c.usd ? fmt.usd(c.usd) : '–';
  $('statOz').textContent = fmt.usd(c.usd);
  $('statGramUsd').textContent = c.usd ? fmt.usd(c.usd / OZ_GRAM) : '–';
  $('statFx').textContent = c.idr ? fmt.num(c.idr, 0) : '–';

  const ch = $('heroChange');
  ch.replaceChildren();
  if (c.usd && prev?.usd) {
    const pct = ((c.usd - prev.usd) / prev.usd) * 100;
    const prevGram = prev.idr && c.idr ? (prev.usd / OZ_GRAM) * prev.idr : null;
    ch.append(make('span', `pill ${dir(pct)}`, `${arrow(pct)} ${fmt.pct(pct)}`));
    const diff = c.gramIdr && prevGram ? c.gramIdr - prevGram : null;
    ch.append(make('span', `chg-abs ${dir(pct)}`, diff != null ? ` ${fmt.signed(diff, fmt.idr)}` : ''));
    ch.append(make('span', 'muted', ` ${prev.label}`));
  }

  const live = $('liveBadge');
  const open = marketOpenNow();
  live.classList.toggle('is-live', !!state.live && open);
  live.classList.toggle('is-off', !open);
  $('liveText').textContent = !c.usd
    ? t('live.none')
    : !open
      ? t('live.closed')
      : state.live
        ? t('live.live', { time: fmt.time(Date.now()) })
        : t('live.delayed', { ago: c.ms ? fmt.rel(c.ms) : '' });

  const parts = [];
  if (c.ms) parts.push(t('hero.asOf', { time: fmt.time(c.ms), src: c.source }));
  if (state.fx) parts.push(t('hero.fxSrc', { src: state.fx.source }));
  $('heroSource').textContent = parts.join(' · ');
}

// ---------------- JAM SESI ----------------
function renderClock() {
  const now = Date.now();
  const today = wibDate(now);
  const wins = sessionWindows(today);
  const openNow = openSessionsAt(now);
  const clock = $('clock');
  clock.replaceChildren();

  const toSegs = (w) => {
    const a = wibHour(w.start);
    const b = wibHour(w.end) || 24;
    return b > a ? [[a, b]] : [[a, 24], [0, b]];
  };
  const lon = wins.find((w) => w.id === 'london');
  const ny = wins.find((w) => w.id === 'newyork');
  const ovA = wibHour(Math.max(lon.start, ny.start));
  const ovB = wibHour(Math.min(lon.end, ny.end)) || 24;

  const body = make('div', 'clock-body');
  for (const w of wins) {
    const row = make('div', 'clock-row');
    const isOpen = openNow.some((o) => o.id === w.id);
    const lbl = make('div', 'clock-label');
    const nameLine = make('span', 'clock-name');
    nameLine.append(make('span', `code s-${w.id}`, w.code), make('span', 'clock-city', ` ${w.name}`));
    lbl.append(nameLine, make('span', 'clock-hours', `${fmt.time(w.start)}–${fmt.time(w.end)}`));
    const track = make('div', 'clock-track');
    for (const [a, b] of toSegs(w)) {
      const bar = make('div', `clock-bar s-${w.id}${isOpen ? ' is-open' : ''}`);
      bar.style.left = `${(a / 24) * 100}%`;
      bar.style.width = `${((b - a) / 24) * 100}%`;
      track.append(bar);
    }
    row.append(lbl, track);
    body.append(row);
  }
  const overlay = make('div', 'clock-overlay');
  const hot = make('div', 'clock-hot');
  hot.style.left = `${(ovA / 24) * 100}%`;
  hot.style.width = `${((ovB - ovA) / 24) * 100}%`;
  const nowLine = make('div', 'clock-now');
  nowLine.style.left = `${(wibHour(now) / 24) * 100}%`;
  nowLine.append(make('span', null, fmt.time(now)));
  overlay.append(hot, nowLine);
  body.append(overlay);

  const axis = make('div', 'clock-axis');
  for (let h = 0; h <= 24; h += 3) {
    const tk = make('span', null, String(h).padStart(2, '0'));
    tk.style.left = `${(h / 24) * 100}%`;
    axis.append(tk);
  }
  const legend = make('div', 'clock-legend');
  legend.append(make('i', 'hot-swatch'), document.createTextNode(` ${t('sess.hot')} (London–New York)`));
  clock.append(body, axis, legend);

  const nt = $('nowText');
  if (!openNow.length) {
    const next = SESSIONS.map((s) => nextOpening(s.id, now)).filter(Boolean).sort((a, b) => a.start - b.start)[0];
    const vars = next
      ? { time: fmt.time(now), day: fmt.date(wibDate(next.start)), open: fmt.time(next.start), name: next.name, dur: fmt.dur(next.start - now) }
      : { time: fmt.time(now), day: '', open: '', name: '', dur: '' };
    nt.textContent = t(isWeekend(today) ? 'sess.now.weekend' : 'sess.now.break', vars);
  } else {
    const overlap = openNow.some((w) => w.id === 'newyork') && openNow.some((w) => w.id === 'london');
    const list = openNow.map(sessName).join(', ');
    nt.textContent = t('sess.now.open', { time: fmt.time(now), list }) + (overlap ? ` — ${t('sess.now.overlap')}` : '');
  }

  const k = keyTimesWib(today);
  $('keyTimes').textContent = t('sess.keyTimes', {
    am: fmt.time(k.lbmaAm),
    pm: fmt.time(k.lbmaPm),
    us: fmt.time(k.usData),
    fomc: fmt.time(k.fomc),
  });
}

// ---------------- KARTU PER SESI ----------------
function renderSessionCards() {
  const now = Date.now();
  const samples = samplesWithLive();
  const day = displayDate(now);
  const stats = sessionWindows(day).map((w) => sessionStats(w, samples, now));
  $('sessionDayTitle').textContent = t('sess.cardTitle', { date: fmt.dateLong(day) });
  const box = $('sessionCards');
  box.replaceChildren();

  for (const s of stats) {
    const card = make('article', `session s-${s.id}`);
    const head = make('div', 'session-head');
    const title = make('div', 'session-title');
    title.append(make('span', `code s-${s.id}`, s.code), make('b', null, s.name), make('span', 'muted', ` · ${t(`region.${s.id}`)}`));
    const statusText = s.status === 'belum' ? t('sess.st.belum', { dur: fmt.dur(s.start - now) }) : t(`sess.st.${s.status}`);
    head.append(title, make('span', `status st-${s.status}`, statusText));
    card.append(head);
    card.append(make('div', 'session-hours', `${fmt.time(s.start)}–${fmt.time(s.end)} WIB · ${t('sess.liq', { lvl: t(`liq.${s.liq}`) })}`));

    if (s.n > 1) {
      const big = make('div', 'session-move');
      big.append(
        make('span', `pill ${dir(s.pct)}`, `${arrow(s.pct)} ${fmt.pct(s.pct)}`),
        make('span', `chg-abs ${dir(s.pct)}`, ` ${fmt.signed(s.change, (v) => fmt.usd(v))}`),
      );
      card.append(big);
      const grid = make('dl', 'session-grid');
      const add = (k, v) => grid.append(make('dt', null, k), make('dd', null, v));
      add(t('sess.open'), fmt.usd(s.open));
      add(s.status === 'buka' ? t('sess.last') : t('sess.close'), fmt.usd(s.close));
      add(t('sess.high'), fmt.usd(s.high));
      add(t('sess.low'), fmt.usd(s.low));
      card.append(grid);
      if (s.idr) card.append(make('div', 'session-idr', t('sess.idr', { idr: fmt.idr((s.close / OZ_GRAM) * s.idr) })));
    } else {
      const msg =
        s.n === 1
          ? t('sess.empty.one', { price: fmt.usd(s.open) })
          : s.status === 'belum'
            ? t('sess.empty.belum')
            : s.status === 'libur'
              ? t('sess.empty.libur')
              : t('sess.empty.none');
      card.append(make('p', 'session-empty', msg));
    }
    card.append(make('p', 'session-note', t(`sess.note.${s.id}`)));
    box.append(card);
  }
}

// ---------------- TABEL 7 HARI ----------------
function renderHeat() {
  const now = Date.now();
  const samples = samplesWithLive();
  const table = $('heatTable');
  table.replaceChildren();
  const dates = tradingDates(samples).slice(0, 7);
  if (!dates.length) {
    const tr = make('tr');
    tr.append(make('td', 'empty', t('heat.empty')));
    table.append(tr);
    return;
  }
  const rows = dates.map((d) => ({ d, stats: sessionWindows(d).map((w) => sessionStats(w, samples, now)) }));
  const maxAbs = Math.max(0.05, ...rows.flatMap((r) => r.stats.filter((s) => s.n > 1).map((s) => Math.abs(s.pct))));

  const thead = make('thead');
  const hr = make('tr');
  hr.append(make('th', null, t('heat.date')));
  for (const s of SESSIONS) {
    const th = make('th');
    th.append(make('span', `code s-${s.id}`, s.code), document.createTextNode(` ${s.name}`));
    hr.append(th);
  }
  thead.append(hr);
  const tbody = make('tbody');
  const sums = SESSIONS.map(() => ({ total: 0, n: 0 }));
  for (const r of rows) {
    const tr = make('tr');
    tr.append(make('th', null, fmt.date(r.d)));
    r.stats.forEach((s, i) => {
      const td = make('td', 'heat-cell');
      if (s.n > 1) {
        td.textContent = `${arrow(s.pct)} ${fmt.pct(s.pct)}`;
        td.classList.add(dir(s.pct));
        td.style.setProperty('--a', (0.12 + 0.5 * Math.min(1, Math.abs(s.pct) / maxAbs)).toFixed(2));
        td.title = t('heat.cellTitle', { name: s.name, date: fmt.date(r.d), open: fmt.usd(s.open), close: fmt.usd(s.close) });
        sums[i].total += Math.abs(s.pct);
        sums[i].n++;
      } else {
        td.textContent = s.status === 'belum' ? '…' : '–';
        td.classList.add('na');
      }
      tr.append(td);
    });
    tbody.append(tr);
  }
  const avg = sums.map((x) => (x.n ? x.total / x.n : null));
  const best = Math.max(...avg.filter((v) => v != null));
  const tfoot = make('tfoot');
  const fr = make('tr');
  fr.append(make('th', null, t('heat.avg')));
  for (const v of avg) {
    const td = make('td', v === best && v != null ? 'best' : null, v == null ? '–' : fmt.pctAbs(v));
    fr.append(td);
  }
  tfoot.append(fr);
  table.append(thead, tbody, tfoot);
}

// ---------------- BERITA ----------------
const CAT_IDS = ['emas', 'tarif', 'perang', 'fed', 'krisis', 'bank', 'pasokan', 'dolar'];
const impactKey = (n) => (n.impact === 1 ? 'up' : n.impact === -1 ? 'down' : 'flat');

// mode EN: tampilkan berita berbahasa Inggris saja
const visibleNews = () => (getLang() === 'en' ? state.news.filter((n) => n.lang !== 'id') : state.news);

function renderNews() {
  const news = visibleNews();
  const chips = $('newsChips');
  chips.replaceChildren();
  const counts = {};
  for (const n of news) counts[n.cat] = (counts[n.cat] || 0) + 1;
  if (state.newsCat !== 'all' && !counts[state.newsCat]) state.newsCat = 'all';
  const addChip = (id, label) => {
    const b = make('button', 'chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.newsCat === id));
    b.addEventListener('click', () => {
      state.newsCat = id;
      state.newsShown = 12;
      renderNews();
    });
    chips.append(b);
  };
  addChip('all', t('news.all', { n: news.length }));
  for (const id of CAT_IDS) if (counts[id]) addChip(id, `${t(`cat.${id}`)} (${counts[id]})`);

  const list = $('newsList');
  list.replaceChildren();
  const items = news.filter((n) => state.newsCat === 'all' || n.cat === state.newsCat);
  if (!items.length) list.append(make('p', 'empty', t('news.empty')));
  for (const n of items.slice(0, state.newsShown)) {
    const art = make('article', 'news');
    const meta = make('div', 'news-meta');
    const ik = impactKey(n);
    meta.append(make('span', 'news-cat', t(`cat.${n.cat}`)), make('span', `impact ${ik}`, `${ik === 'up' ? '▲' : ik === 'down' ? '▼' : '■'} ${t(`imp.${ik}`)}`));
    const a = make('a', 'news-title', n.title);
    a.href = n.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const pub = Date.parse(n.published);
    const foot = make('div', 'news-foot');
    foot.append(make('span', 'lang-tag', (n.lang || 'en').toUpperCase()), document.createTextNode(` ${n.source || t('news.source')} · ${isFinite(pub) ? fmt.rel(pub) : ''}`));
    art.append(meta, a, foot);
    list.append(art);
  }
  const more = $('newsMore');
  more.hidden = items.length <= state.newsShown;
  more.onclick = () => {
    state.newsShown += 12;
    renderNews();
  };
  $('newsUpdated').textContent = state.newsUpdated ? t('news.updated', { ago: fmt.rel(state.newsUpdated), time: fmt.time(state.newsUpdated) }) : '';
}

// ---------------- RINGKASAN + MOOD ----------------
function recentNews() {
  const news = visibleNews();
  const day = news.filter((n) => Date.now() - Date.parse(n.published) < 24 * HOUR);
  return day.length >= 5 ? day : news;
}

function changeSince(dateCutoffMs, usd) {
  const ref = state.daily.filter((d) => dateMs(d.d) <= dateCutoffMs).at(-1);
  return ref && usd ? ((usd - ref.usd) / ref.usd) * 100 : null;
}

function renderSummary() {
  const ul = $('summaryList');
  ul.replaceChildren();
  const li = (kind, text) => {
    const l = make('li', `brief-${kind}`);
    l.append(make('span', 'marker', kind === 'up' ? '▲' : kind === 'down' ? '▼' : '■'), make('span', null, text));
    ul.append(l);
  };
  const c = current();
  const prev = previousClose();
  const now = Date.now();

  if (c.usd && prev?.usd) {
    const pct = ((c.usd - prev.usd) / prev.usd) * 100;
    const vars = { pct: fmt.pctAbs(pct), price: fmt.usd(c.usd), ref: prev.label.replace(/^vs\.? /, '') };
    if (Math.abs(pct) < 0.1) li('flat', t('brief.flat', { ...vars, pct: fmt.pct(pct) }));
    else li(pct > 0 ? 'up' : 'down', t(pct > 0 ? 'brief.up' : 'brief.down', vars));
  } else if (c.usd) {
    li('flat', t('brief.price', { price: fmt.usd(c.usd) }));
  }

  const w = changeSince(now - 7 * 24 * HOUR, c.usd);
  const m = changeSince(now - 30 * 24 * HOUR, c.usd);
  if (w != null) li(dir(w, 0.1), t('brief.trend', { w: fmt.pct(w), m: m != null ? fmt.pct(m) : t('brief.na') }));

  const day = displayDate(now);
  const stats = sessionWindows(day)
    .map((x) => sessionStats(x, samplesWithLive(), now))
    .filter((s) => s.n > 1);
  const top = stats.length ? stats.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a)) : null;
  if (top && Math.abs(top.pct) >= 0.01) {
    li(dir(top.pct), t(day === wibDate(now) ? 'brief.topSessionToday' : 'brief.topSessionLast', { name: top.name, pct: fmt.pct(top.pct) }));
  }

  const openNow = openSessionsAt(now);
  if (!openNow.length) li('flat', t('brief.closed'));
  else if (openNow.some((x) => x.id === 'newyork') && openNow.some((x) => x.id === 'london')) li('flat', t('brief.overlap'));
  else li('flat', t('brief.open', { list: openNow.map(sessName).join(', ') }));

  const news = recentNews();
  if (news.length) {
    const byCat = {};
    for (const n of news) if (n.cat !== 'emas') byCat[n.cat] = (byCat[n.cat] || 0) + 1;
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (topCat) li('flat', t('brief.topic', { cat: t(`cat.${topCat[0]}`), n: topCat[1] }));
    const up = news.filter((n) => n.impact === 1).length;
    const down = news.filter((n) => n.impact === -1).length;
    if (up || down) {
      if (up > down * 1.3) li('up', t('brief.moodUp', { up, down }));
      else if (down > up * 1.3) li('down', t('brief.moodDown', { up, down }));
      else li('flat', t('brief.moodMixed', { up, down }));
    }
  }
  if (!ul.children.length) li('flat', t('brief.waiting'));
  renderMood(news);
}

function renderMood(news) {
  const box = $('moodBox');
  if (!news.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const up = news.filter((n) => n.impact === 1).length;
  const down = news.filter((n) => n.impact === -1).length;
  const flat = news.length - up - down;
  const bar = $('moodBar');
  bar.replaceChildren();
  for (const [cls, v] of [
    ['up', up],
    ['flat', flat],
    ['down', down],
  ]) {
    if (!v) continue;
    const seg = make('span', `mood-seg ${cls}`);
    seg.style.flexGrow = v;
    seg.title = `${v} ${t(`mood.${cls}`)}`;
    bar.append(seg);
  }
  bar.setAttribute('aria-label', t('mood.aria', { up, flat, down }));
  $('moodCount').textContent = `▲${up} · ■${flat} · ▼${down}`;
}

// ---------------- LAPORAN PASAR ----------------
function renderReports() {
  const list = $('reportList');
  list.replaceChildren();
  const lang = getLang();
  if (!state.reports.length) {
    list.append(make('p', 'empty', t('rep.empty')));
    $('reportMore').hidden = true;
    return;
  }
  state.reports.slice(0, state.reportsShown).forEach((r, i) => {
    const a = make('a', `report-item${i === 0 ? ' featured' : ''}`);
    a.href = `reports/${r.id}-${lang}.html`;
    const meta = make('div', 'report-meta');
    const endMs = Date.parse(r.end);
    meta.append(
      make('span', `code s-${r.session}`, r.code),
      make('span', null, t('rep.meta', { session: t('rep.session', { name: r.name }), date: fmt.date(r.date), time: isFinite(endMs) ? fmt.time(endMs) : '' })),
      make('span', `pill ${dir(r.pct)}`, `${arrow(r.pct)} ${fmt.pct(r.pct)}`),
    );
    a.append(meta, make('h3', 'report-title', r.title[lang] || r.title.en), make('p', 'report-lede', r.lede?.[lang] || ''));
    list.append(a);
  });
  const more = $('reportMore');
  more.hidden = state.reports.length <= state.reportsShown;
  more.onclick = () => {
    state.reportsShown += 12;
    renderReports();
  };
}

// ---------------- GRAFIK INTRADAY ----------------
function intradaySeries() {
  const pts = state.samples.map((p) => ({ ms: p.ms, value: p.usd }));
  const lastRobot = pts.at(-1)?.ms ?? 0;
  for (const tk of state.liveTicks) if (tk.ms > lastRobot) pts.push({ ms: tk.ms, value: tk.usd });
  return pts;
}

function renderIntraday() {
  const all = intradaySeries();
  const box = $('intraChart');
  const tb = $('intraTable');
  tb.replaceChildren();
  const rangeName = t(`intra.rangeName${state.intraDays}`);
  const end = Math.max(all.at(-1)?.ms ?? 0, marketOpenNow() ? Date.now() : 0);
  const from = end - state.intraDays * 24 * HOUR;
  const pts = all.filter((p) => p.ms >= from);
  if (pts.length < 2) {
    box.replaceChildren(make('p', 'empty', t('intra.empty')));
    $('intraTitle').textContent = '';
    return;
  }
  const first = pts[0].value;
  const last = pts.at(-1).value;
  const pct = ((last - first) / first) * 100;
  const vals = pts.map((p) => p.value);
  $('intraTitle').textContent = t('intra.line', {
    range: rangeName,
    chg: `${arrow(pct)} ${fmt.pct(pct)}`,
    high: fmt.usd(Math.max(...vals)),
    low: fmt.usd(Math.min(...vals)),
  });

  // lajur sesi & awal hari (WIB) dalam rentang
  const lanes = SESSIONS.map((s) => ({ id: s.id, code: s.code, segs: [] }));
  const dayStarts = [];
  for (let d = addDays(wibDate(from), -1); d <= wibDate(end); d = addDays(d, 1)) {
    dayStarts.push(Date.parse(d + 'T00:00:00Z') - 7 * HOUR);
    if (isWeekend(d)) continue;
    sessionWindows(d).forEach((w, i) => lanes[i].segs.push([w.start, w.end]));
  }
  for (const p of pts) p.label = `${fmt.date(wibDate(p.ms))} ${fmt.time(p.ms)} WIB`;
  renderIntradayChart(box, pts, {
    from,
    to: end,
    lanes,
    dayStarts,
    formatValue: (v) => fmt.usd(v),
    formatTick: (v) => fmt.num(v, 0),
    formatTime: (ms) => fmt.time(ms),
    formatDay: (ms) => fmt.date(wibDate(ms + HOUR)),
    ariaLabel: t('intra.aria', { range: rangeName }),
  });

  const thead = make('thead');
  const hr = make('tr');
  hr.append(make('th', null, t('intra.time')), make('th', 'num', 'XAU/USD'));
  thead.append(hr);
  const body = make('tbody');
  for (const p of state.samples.filter((x) => x.ms >= from).reverse()) {
    const tr = make('tr');
    tr.append(make('td', null, `${fmt.date(wibDate(p.ms))} ${fmt.time(p.ms)}`), make('td', 'num', fmt.usd(p.usd)));
    body.append(tr);
  }
  tb.append(thead, body);
}

// ---------------- GRAFIK HARIAN ----------------
function chartPoints() {
  const c = current();
  const cutoff = Date.now() - state.range * 24 * HOUR;
  // titik hari ini pakai harga terkini, biar grafik nyambung dengan angka di atas
  const days = state.daily.filter((d) => dateMs(d.d) >= cutoff);
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (c.usd && c.idr && !isWeekend(todayUtc) && days.length) {
    if (days.at(-1).d === todayUtc) days.pop();
    days.push({ d: todayUtc, usd: c.usd, idr: c.idr });
  }
  return days
    .map((d) => {
      const idr = d.idr || c.idr;
      return {
        d: d.d,
        value: state.unit === 'idr' ? (idr ? (d.usd / OZ_GRAM) * idr : null) : d.usd,
        label: fmt.dateShort(d.d),
        fullLabel: fmt.dateYear(d.d),
      };
    })
    .filter((p) => p.value != null);
}

function renderChart() {
  const pts = chartPoints();
  const box = $('chart');
  const fmtV = state.unit === 'idr' ? fmt.idr : (v) => fmt.usd(v);
  const fmtTick = (v) => fmt.num(v, 0);
  const rangeName = t(`range.${state.range}`);
  if (!pts.length) {
    box.replaceChildren(make('p', 'empty', t('chart.empty')));
    $('chartTitle').textContent = '';
  } else {
    const first = pts[0].value;
    const last = pts.at(-1).value;
    const pct = ((last - first) / first) * 100;
    $('chartTitle').textContent = t('chart.title', {
      unit: t(state.unit === 'idr' ? 'chart.unitIdr' : 'chart.unitUsd'),
      range: rangeName,
      chg: `${arrow(pct)} ${fmt.pct(pct)}`,
      last: fmtV(last),
    });
    renderLineChart(box, pts, {
      formatValue: fmtV,
      formatTick: fmtTick,
      ariaLabel: t('chart.aria', { range: rangeName, first: fmtV(first), last: fmtV(last) }),
    });
  }
  const tb = $('chartTable');
  tb.replaceChildren();
  const thead = make('thead');
  const hr = make('tr');
  hr.append(make('th', null, t('chart.date')), make('th', 'num', t(state.unit === 'idr' ? 'unit.idr' : 'unit.usd')));
  thead.append(hr);
  const body = make('tbody');
  for (const p of pts.slice().reverse()) {
    const tr = make('tr');
    tr.append(make('td', null, p.fullLabel), make('td', 'num', fmtV(p.value)));
    body.append(tr);
  }
  tb.append(thead, body);
}

function setupChartControls() {
  for (const [segId, key, parse] of [
    ['rangeSeg', 'range', Number],
    ['unitSeg', 'unit', String],
  ]) {
    $(segId).addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      state[key] = parse(b.dataset[key]);
      for (const x of $(segId).querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      renderChart();
    });
  }
  $('intraSeg').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    state.intraDays = Number(b.dataset.days);
    for (const x of $('intraSeg').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    renderIntraday();
  });
  const widths = new Map();
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const nw = e.target.clientWidth;
      if (Math.abs(nw - (widths.get(e.target.id) || 0)) > 8) {
        widths.set(e.target.id, nw);
        if (e.target.id === 'chart') renderChart();
        else renderIntraday();
      }
    }
  });
  ro.observe($('chart'));
  ro.observe($('intraChart'));
}

// ---------------- KADAR & KALKULATOR ----------------
const KARATS = [24, 23, 22, 18, 17, 16].map((k) => ({ k, purity: k === 24 ? 1 : k / 24 }));

function renderKarat() {
  const c = current();
  const tb = $('karatTable');
  tb.replaceChildren();
  tb.classList.add('karat');
  const thead = make('thead');
  const hr = make('tr');
  hr.append(make('th', null, t('karat.col')), make('th', 'num', t('karat.idr')), make('th', 'num col-usd', t('karat.usd')));
  thead.append(hr);
  const body = make('tbody');
  for (const k of KARATS) {
    const tr = make('tr');
    const th = make('th');
    th.append(make('b', null, `${k.k}K`), make('span', 'note', t(`karat.${k.k}`)));
    tr.append(
      th,
      make('td', 'num', c.gramIdr ? fmt.idr(c.gramIdr * k.purity) : '–'),
      make('td', 'num col-usd', c.usd ? fmt.usd((c.usd / OZ_GRAM) * k.purity) : '–'),
    );
    body.append(tr);
  }
  tb.append(thead, body);

  const sel = $('calcKarat');
  const keep = sel.value;
  sel.replaceChildren();
  for (const k of KARATS) sel.append(new Option(`${k.k}K (${fmt.num(k.purity * 100, 1)}%)`, String(k.purity)));
  if (keep) sel.value = keep;
  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    for (const id of ['calcGram', 'calcKarat', 'calcMoney']) $(id).addEventListener('input', renderCalc);
  }
  renderCalc();
}

function renderCalc() {
  const c = current();
  const g = parseFloat($('calcGram').value) || 0;
  const p = parseFloat($('calcKarat').value) || 1;
  $('calcOut').textContent = c.gramIdr ? fmt.idr(g * p * c.gramIdr) : '–';
  const money = parseFloat($('calcMoney').value) || 0;
  $('calcMoneyOut').textContent = c.gramIdr ? t('calc.grams', { n: fmt.num(money / c.gramIdr, 0, 3) }) : '–';
}

// ---------------- KALENDER ----------------
function renderCalendarList() {
  const k = keyTimesWib(wibDate(Date.now()));
  const vars = { us: fmt.time(k.usData), fomc: fmt.time(k.fomc) };
  const ul = $('calList');
  ul.replaceChildren();
  for (const id of ['nfp', 'cpi', 'fomc', 'claims', 'pboc']) {
    const li = make('li');
    const head = make('div', 'cal-head');
    head.append(make('b', null, t(`cal.${id}.t`)), make('span', 'muted', t(`cal.${id}.w`, vars)));
    li.append(head, make('p', 'small', t(`cal.${id}.d`)));
    ul.append(li);
  }
}

// ---------------- PENGGERAK HARGA ----------------
const DRIVERS = [
  ['fed', 'up'],
  ['usd', 'down'],
  ['geo', 'up'],
  ['trade', 'up'],
  ['infl', 'up'],
  ['stress', 'up'],
  ['cb', 'up'],
  ['riskon', 'down'],
  ['supply', 'up'],
  ['season', 'up'],
  ['profit', 'down'],
  ['idr', 'up'],
];

function renderLearn() {
  const grid = $('learnGrid');
  grid.replaceChildren();
  for (const [id, d] of DRIVERS) {
    const card = make('article', 'learn');
    card.append(
      make('h3', null, t(`drv.${id}.t`)),
      make('p', `rule ${d}`, `${d === 'up' ? '▲' : '▼'} ${t(`drv.${id}.r`)}`),
      make('p', 'small', t(`drv.${id}.d`)),
    );
    grid.append(card);
  }
}

// ---------------- TRADINGVIEW (dimuat saat tombol ditekan) ----------------
function themeNow() {
  const th = document.documentElement.dataset.theme;
  if (th) return th;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function embedTradingView(boxId, btnId, script, config) {
  $(btnId).addEventListener('click', () => {
    const box = $(boxId);
    box.replaceChildren();
    const wrap = make('div', 'tradingview-widget-container');
    wrap.append(make('div', 'tradingview-widget-container__widget'));
    const s = document.createElement('script');
    s.src = `https://s3.tradingview.com/external-embedding/${script}`;
    s.async = true;
    s.textContent = JSON.stringify({ ...config, locale: getLang() === 'en' ? 'en' : 'id', colorTheme: themeNow(), theme: themeNow() });
    wrap.append(s);
    box.append(wrap);
    box.classList.add('is-loaded');
    $(btnId).hidden = true;
  });
}

// ---------------- TEMA & BAHASA ----------------
function setupTheme() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch {}
  $('themeBtn').addEventListener('click', () => {
    const next = themeNow() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {}
  });
}

function setupLang() {
  for (const b of document.querySelectorAll('[data-lang]')) b.addEventListener('click', () => setLang(b.dataset.lang));
  document.addEventListener('langchange', () => {
    state.newsShown = 12;
    state.reportsShown = 6;
    renderAll();
  });
}

// ---------------- JALANKAN ----------------
function renderPrices() {
  renderIntraday();
  renderTicker();
  renderHero();
  renderSessionCards();
  renderHeat();
  renderSummary();
  renderKarat();
}

function renderAll() {
  renderClock();
  renderPrices();
  renderReports();
  renderNews();
  renderChart();
  renderLearn();
  renderCalendarList();
}

async function main() {
  applyStatic();
  setupTheme();
  setupLang();
  setupChartControls();
  renderLearn();
  renderCalendarList();
  renderClock();
  embedTradingView('tvChart', 'tvChartBtn', 'embed-widget-advanced-chart.js', {
    symbol: 'OANDA:XAUUSD',
    interval: '60',
    timezone: 'Asia/Jakarta',
    style: '1',
    autosize: true,
    hide_side_toolbar: true,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    support_host: 'https://www.tradingview.com',
  });
  embedTradingView('tvCal', 'tvCalBtn', 'embed-widget-events.js', {
    isTransparent: true,
    width: '100%',
    height: 520,
    importanceFilter: '0,1',
    countryFilter: 'us,cn,eu,id',
  });

  startLive().catch((e) => console.warn('live', e));

  await loadRobotData();
  renderPrices();
  renderReports();
  renderNews();
  renderChart();

  await loadLive();
  renderPrices();
  renderChart();

  setInterval(async () => {
    await loadLive();
    renderPrices();
  }, LIVE_EVERY_MS);
  setInterval(renderClock, 30_000);
  setInterval(async () => {
    await loadRobotData();
    renderPrices();
    renderReports();
    renderNews();
    renderChart();
  }, 15 * 60e3);
}

main();
