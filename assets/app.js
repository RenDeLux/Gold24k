// =============================================================
//  PANTAU EMAS DUNIA — otak halaman web
//  Alur: ambil data robot (folder data/) + harga live → gambar semua bagian
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
import { renderLineChart } from './chart.js';
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

// ---------------- format angka & waktu (gaya Indonesia) ----------------
const nf = (min, max) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: min, maximumFractionDigits: max });
const nf0 = nf(0, 0);
const nf2 = nf(2, 2);
const fmtIdr = (n) => (n == null || !isFinite(n) ? 'Rp –' : `Rp ${nf0.format(Math.round(n))}`);
const fmtUsd = (n, dec = 2) => (n == null || !isFinite(n) ? 'US$ –' : `US$ ${nf(dec, dec).format(n)}`);
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
const fmtPct = (p) => (Math.abs(p) < 0.005 ? '0,00%' : `${sign(p)}${nf2.format(Math.abs(p))}%`);
const arrow = (n, eps = 0) => (n > eps ? '▲' : n < -eps ? '▼' : '•');
const dir = (n, eps = 0) => (n > eps ? 'up' : n < -eps ? 'down' : 'flat');

const tf = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
const fmtTime = (ms) => tf.format(ms);
const df = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const dfLong = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dfShort = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dfYear = new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const dateMs = (dateStr) => Date.parse(dateStr + 'T00:00:00Z');
const fmtDate = (dateStr) => df.format(dateMs(dateStr));
const fmtDateLong = (dateStr) => dfLong.format(dateMs(dateStr));

function relTime(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}
function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}h ${h % 24}j`;
  return h ? `${h}j ${m % 60}m` : `${m}m`;
}

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
  samples: [], // foto harga tiap jam dari robot: {ms, usd, idr}
  daily: [], // harga harian: {d, usd, idr}
  news: [],
  newsUpdated: null,
  pricesUpdated: null,
  live: null, // {usd, ms, source}
  fx: null, // {idr, ms, source}
  newsCat: 'all',
  newsShown: 12,
  range: 90,
  unit: 'idr',
};

async function loadRobotData() {
  const bust = `?v=${Math.floor(Date.now() / 60000)}`;
  const [prices, daily, news] = await Promise.all([
    safe(fetchJSON('data/prices.json' + bust)),
    safe(fetchJSON('data/daily.json' + bust)),
    safe(fetchJSON('data/news.json' + bust)),
  ]);
  state.samples = (prices?.samples || [])
    .map((s) => ({ ms: Date.parse(s.t), usd: +s.usd, idr: s.idr ? +s.idr : null }))
    .filter((s) => isFinite(s.ms) && s.usd > 0)
    .sort((a, b) => a.ms - b.ms);
  state.pricesUpdated = prices?.updated ? Date.parse(prices.updated) : null;
  state.daily = (daily?.days || []).filter((d) => d.usd > 0).sort((a, b) => a.d.localeCompare(b.d));
  state.news = (news?.items || []).filter((n) => n && n.title && /^https?:\/\//.test(n.url));
  state.newsUpdated = news?.updated ? Date.parse(news.updated) : null;
}

async function loadLive() {
  // harga emas live (spot)
  try {
    const j = await fetchJSON('https://api.gold-api.com/price/XAU');
    if (j?.price > 0) state.live = { usd: +j.price, ms: Date.parse(j.updatedAt) || Date.now(), source: 'gold-api.com' };
  } catch (e) {
    console.warn('harga live gagal', e);
  }
  // kurs rupiah (cukup sekali per 30 menit)
  if (!state.fx || Date.now() - state.fx.fetched > 30 * 60e3) {
    try {
      const j = await fetchJSON('https://open.er-api.com/v6/latest/USD');
      if (j?.rates?.IDR > 0)
        state.fx = { idr: +j.rates.IDR, ms: (j.time_last_update_unix || 0) * 1000, source: 'open.er-api.com', fetched: Date.now() };
    } catch (e) {
      console.warn('kurs live gagal', e);
    }
  }
  // cadangan terakhir: currency-api (harian) kalau dua-duanya gagal & robot belum punya data
  if (!state.live && !state.samples.length) {
    try {
      const j = await fetchJSON('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json');
      if (j?.usd?.xau > 0) state.live = { usd: 1 / j.usd.xau, ms: Date.parse(j.date) || Date.now(), source: 'currency-api (harian)' };
      if (!state.fx && j?.usd?.idr > 0) state.fx = { idr: j.usd.idr, ms: Date.parse(j.date), source: 'currency-api', fetched: Date.now() };
    } catch (e) {
      console.warn('cadangan gagal', e);
    }
  }
}

// harga & kurs terkini (live dulu, kalau gagal pakai catatan robot)
function current() {
  const lastS = state.samples.at(-1);
  const lastD = state.daily.at(-1);
  const usd = state.live?.usd ?? lastS?.usd ?? lastD?.usd ?? null;
  const ms = state.live?.ms ?? lastS?.ms ?? null;
  const idr = state.fx?.idr ?? [...state.samples].reverse().find((s) => s.idr)?.idr ?? lastD?.idr ?? null;
  const source = state.live?.source ?? (lastS ? 'catatan robot' : null);
  return { usd, idr, ms, source, gramIdr: usd && idr ? (usd / OZ_GRAM) * idr : null };
}

// harga penutupan hari kerja sebelumnya
function previousClose() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const prev = state.daily.filter((d) => d.d < todayUtc).at(-1);
  if (prev) return { usd: prev.usd, idr: prev.idr, label: `penutupan ${dfShort.format(dateMs(prev.d))}` };
  const target = Date.now() - 24 * HOUR;
  const s = state.samples.filter((p) => p.ms <= target).at(-1);
  return s ? { usd: s.usd, idr: s.idr, label: '24 jam lalu' } : null;
}

// samples + harga live (kalau pasar buka) → buat tabel sesi
function samplesWithLive() {
  const arr = state.samples.slice();
  const now = Date.now();
  if (state.live && openSessionsAt(now).length && (!arr.length || now > arr.at(-1).ms)) {
    arr.push({ ms: now, usd: state.live.usd, idr: state.fx?.idr ?? arr.at(-1)?.idr ?? null });
  }
  return arr;
}

// tanggal "hari dagang" yang lagi relevan (Sabtu/Minggu/dini hari → hari kerja sebelumnya)
function displayDate(now = Date.now()) {
  let d = wibDate(now);
  for (let i = 0; i < 5; i++) {
    if (!isWeekend(d) && sessionWindows(d)[0].start <= now) return d;
    d = addDays(d, -1);
  }
  return wibDate(now);
}

// ---------------- HERO ----------------
function renderHero() {
  const c = current();
  const prev = previousClose();
  $('heroIdr').textContent = c.gramIdr ? fmtIdr(c.gramIdr) : c.usd ? fmtUsd(c.usd) : 'Rp –';
  $('statOz').textContent = fmtUsd(c.usd);
  $('statGramUsd').textContent = c.usd ? fmtUsd(c.usd / OZ_GRAM) : '–';
  $('statFx').textContent = c.idr ? fmtIdr(c.idr) : '–';

  const ch = $('heroChange');
  ch.replaceChildren();
  if (c.usd && prev?.usd) {
    const pct = ((c.usd - prev.usd) / prev.usd) * 100;
    const prevGram = prev.idr && c.idr ? (prev.usd / OZ_GRAM) * prev.idr : null;
    const pill = make('span', `pill ${dir(pct, 0.005)}`, `${arrow(pct, 0.005)} ${fmtPct(pct)}`);
    ch.append(pill);
    const diff = c.gramIdr && prevGram ? c.gramIdr - prevGram : null;
    const extra = diff != null ? ` (${sign(diff)}${fmtIdr(Math.abs(diff))}/gram)` : '';
    ch.append(` dibanding ${prev.label}${extra}`);
  }

  const live = $('liveBadge');
  const marketOpen = openSessionsAt(Date.now()).length > 0;
  live.classList.toggle('is-live', !!state.live && marketOpen);
  live.classList.toggle('is-off', !marketOpen);
  $('liveText').textContent = !c.usd
    ? 'data belum ada'
    : !marketOpen
      ? 'pasar libur'
      : state.live
        ? `live · ${fmtTime(Date.now())} WIB`
        : `catatan ${c.ms ? relTime(c.ms) : ''}`;

  const parts = [];
  if (c.ms) parts.push(`Harga per ${fmtTime(c.ms)} WIB (${c.source})`);
  if (state.fx) parts.push(`kurs: ${state.fx.source}`);
  $('heroSource').textContent = `${parts.join(' · ')}${parts.length ? '. ' : ''}Ini harga bahan emas murni dunia (spot). Harga di toko/Antam biasanya lebih mahal karena ada ongkos cetak, pajak & untung penjual.`;
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
  // area "paling rame" = London ∩ New York
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
    nameLine.append(make('span', 'flag', w.flag), document.createTextNode(` ${w.name}`));
    lbl.append(nameLine, make('span', 'clock-hours', `${fmtTime(w.start)}–${fmtTime(w.end)}`));
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
  // pita jam rame + garis "sekarang"
  const overlay = make('div', 'clock-overlay');
  const hot = make('div', 'clock-hot');
  hot.style.left = `${(ovA / 24) * 100}%`;
  hot.style.width = `${((ovB - ovA) / 24) * 100}%`;
  hot.title = 'London + New York buka bareng = jam paling rame';
  hot.append(make('span', null, '🔥 paling rame'));
  const nowLine = make('div', 'clock-now');
  nowLine.style.left = `${(wibHour(now) / 24) * 100}%`;
  nowLine.append(make('span', null, `${fmtTime(now)}`));
  overlay.append(hot, nowLine);
  body.append(overlay);

  const axis = make('div', 'clock-axis');
  for (let h = 0; h <= 24; h += 3) {
    const t = make('span', null, String(h).padStart(2, '0'));
    t.style.left = `${(h / 24) * 100}%`;
    axis.append(t);
  }
  clock.append(body, axis);

  // teks "sekarang"
  const nt = $('nowText');
  if (isWeekend(today) || !openNow.length) {
    const next = SESSIONS.map((s) => nextOpening(s.id, now)).filter(Boolean).sort((a, b) => a.start - b.start)[0];
    nt.textContent = `Sekarang ${fmtTime(now)} WIB · Pasar emas lagi ${isWeekend(today) ? 'libur akhir pekan' : 'istirahat'} 😴${next ? `. Buka lagi ${fmtDate(wibDate(next.start))} ${fmtTime(next.start)} WIB (sesi ${next.name}), ${fmtDuration(next.start - now)} lagi.` : ''}`;
  } else {
    const names = openNow.map((w) => `${w.flag} ${w.name}`).join(' + ');
    const hotNow = openNow.length > 1 && openNow.some((w) => w.id === 'newyork') && openNow.some((w) => w.id === 'london');
    nt.textContent = `Sekarang ${fmtTime(now)} WIB · Lagi buka: ${names}${hotNow ? ' → jam paling rame, harga gampang loncat 🔥' : ` → ${openNow.at(-1).mood}`}`;
  }

  const k = keyTimesWib(today);
  $('keyTimes').textContent = `📌 Harga patokan London (LBMA): ${fmtTime(k.lbmaAm)} & ${fmtTime(k.lbmaPm)} WIB · 📢 Data ekonomi AS: ${fmtTime(k.usData)} WIB · 🏦 Pengumuman The Fed: ${fmtTime(k.fomc)} WIB (dini hari). Jam otomatis menyesuaikan musim panas/dingin.`;
}

// ---------------- KARTU PER SESI ----------------
function renderSessionCards() {
  const now = Date.now();
  const samples = samplesWithLive();
  const day = displayDate(now);
  const stats = sessionWindows(day).map((w) => sessionStats(w, samples, now));
  $('sessionDayTitle').textContent = `Harga per sesi · ${fmtDateLong(day)}`;
  const box = $('sessionCards');
  box.replaceChildren();

  for (const s of stats) {
    const card = make('article', `session s-${s.id}`);
    const head = make('div', 'session-head');
    const title = make('div', 'session-title');
    title.append(make('span', 'flag', s.flag), make('b', null, s.name), make('span', 'muted', ` · ${s.region}`));
    let statusText = '';
    if (s.status === 'buka') statusText = 'BUKA sekarang';
    else if (s.status === 'selesai') statusText = 'Selesai';
    else if (s.status === 'libur') statusText = 'Libur';
    else statusText = `Buka ${fmtDuration(s.start - now)} lagi`;
    head.append(title, make('span', `status st-${s.status}`, statusText));
    card.append(head);
    card.append(make('div', 'session-hours', `${fmtTime(s.start)}–${fmtTime(s.end)} WIB · ${s.mood}`));

    if (s.n > 1) {
      const big = make('div', 'session-move');
      big.append(
        make('span', `pill ${dir(s.pct, 0.005)}`, `${arrow(s.pct, 0.005)} ${fmtPct(s.pct)}`),
        make('span', 'muted', ` ${sign(s.change)}${fmtUsd(Math.abs(s.change)).replace('US$ ', 'US$')}`),
      );
      card.append(big);
      const grid = make('dl', 'session-grid');
      const add = (k, v) => grid.append(make('dt', null, k), make('dd', null, v));
      add('Buka', fmtUsd(s.open));
      add(s.status === 'buka' ? 'Sekarang' : 'Tutup', fmtUsd(s.close));
      add('Tertinggi', fmtUsd(s.high));
      add('Terendah', fmtUsd(s.low));
      card.append(grid);
      if (s.idr) card.append(make('div', 'session-idr', `≈ ${fmtIdr((s.close / OZ_GRAM) * s.idr)}/gram (24K)`));
    } else {
      card.append(
        make(
          'p',
          'session-empty',
          s.n === 1
            ? `Baru ada 1 catatan harga (${fmtUsd(s.open)}). Tunggu catatan berikutnya ya.`
            : s.status === 'belum'
            ? 'Belum mulai. Nanti angkanya muncul di sini.'
            : s.status === 'libur'
              ? 'Pasar emas libur.'
              : 'Belum ada catatan robot buat sesi ini.',
        ),
      );
    }
    card.append(make('p', 'session-note', s.note));
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
    const td = make('td', 'empty', 'Belum ada riwayat. Robot mencatat harga tiap jam, tabel ini terisi sendiri dalam 1–2 hari.');
    tr.append(td);
    table.append(tr);
    return;
  }
  const rows = dates.map((d) => ({ d, stats: sessionWindows(d).map((w) => sessionStats(w, samples, now)) }));
  const maxAbs = Math.max(0.05, ...rows.flatMap((r) => r.stats.filter((s) => s.n > 1).map((s) => Math.abs(s.pct))));

  const thead = make('thead');
  const hr = make('tr');
  hr.append(make('th', null, 'Tanggal'));
  for (const s of SESSIONS) {
    const th = make('th');
    th.append(make('span', 'flag', s.flag), document.createTextNode(` ${s.name}`));
    hr.append(th);
  }
  thead.append(hr);
  const tbody = make('tbody');
  const sums = SESSIONS.map(() => ({ total: 0, n: 0 }));
  for (const r of rows) {
    const tr = make('tr');
    tr.append(make('th', null, fmtDate(r.d)));
    r.stats.forEach((s, i) => {
      const td = make('td', 'heat-cell');
      if (s.n > 1) {
        td.textContent = `${arrow(s.pct, 0.005)} ${fmtPct(s.pct)}`;
        td.classList.add(dir(s.pct, 0.005));
        td.style.setProperty('--a', (0.12 + 0.5 * Math.min(1, Math.abs(s.pct) / maxAbs)).toFixed(2));
        td.title = `${s.name} ${fmtDate(r.d)}: buka ${fmtUsd(s.open)}, tutup ${fmtUsd(s.close)}`;
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
  // baris rata-rata gerak
  const avg = sums.map((x) => (x.n ? x.total / x.n : null));
  const best = Math.max(...avg.filter((v) => v != null));
  const tfoot = make('tfoot');
  const fr = make('tr');
  fr.append(make('th', null, 'Rata-rata gerak'));
  avg.forEach((v) => {
    const td = make('td', null, v == null ? '–' : `${v === best ? '🏆 ' : ''}${nf2.format(v)}%`);
    fr.append(td);
  });
  tfoot.append(fr);
  table.append(thead, tbody, tfoot);
}

// ---------------- BERITA ----------------
const CATS = {
  emas: { label: 'Harga Emas', emoji: '🪙' },
  tarif: { label: 'Tarif & Dagang', emoji: '📦' },
  perang: { label: 'Perang & Konflik', emoji: '⚔️' },
  fed: { label: 'The Fed & Bunga', emoji: '🏦' },
  krisis: { label: 'Krisis & Inflasi', emoji: '📉' },
  bank: { label: 'Bank Sentral', emoji: '🏛️' },
  pasokan: { label: 'Tambang & Pasokan', emoji: '⛏️' },
  dolar: { label: 'Dolar & Rupiah', emoji: '💵' },
};
const IMPACT = {
  1: { cls: 'up', text: '▲ bisa dorong emas naik' },
  '-1': { cls: 'down', text: '▼ bisa tekan emas turun' },
  0: { cls: 'flat', text: '• netral / belum jelas' },
};

function renderNews() {
  const chips = $('newsChips');
  chips.replaceChildren();
  const counts = {};
  for (const n of state.news) counts[n.cat] = (counts[n.cat] || 0) + 1;
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
  addChip('all', `Semua (${state.news.length})`);
  for (const [id, c] of Object.entries(CATS)) if (counts[id]) addChip(id, `${c.emoji} ${c.label} (${counts[id]})`);

  const list = $('newsList');
  list.replaceChildren();
  const items = state.news.filter((n) => state.newsCat === 'all' || n.cat === state.newsCat);
  if (!items.length) {
    list.append(make('p', 'empty', 'Belum ada berita. Robot GitHub ambil berita baru tiap jam — cek lagi nanti ya.'));
  }
  for (const n of items.slice(0, state.newsShown)) {
    const art = make('article', 'news');
    const meta = make('div', 'news-meta');
    const c = CATS[n.cat] || { emoji: '📰', label: n.cat };
    const imp = IMPACT[n.impact] || IMPACT[0];
    meta.append(make('span', 'news-cat', `${c.emoji} ${c.label}`), make('span', `impact ${imp.cls}`, imp.text));
    const a = make('a', 'news-title', n.title);
    a.href = n.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const pub = Date.parse(n.published);
    const foot = make('div', 'news-foot', `${n.lang === 'id' ? '🇮🇩' : '🇬🇧'} ${n.source || 'Sumber'} · ${isFinite(pub) ? relTime(pub) : ''}`);
    art.append(meta, a, foot);
    list.append(art);
  }
  const more = $('newsMore');
  more.hidden = items.length <= state.newsShown;
  more.onclick = () => {
    state.newsShown += 12;
    renderNews();
  };
  $('newsUpdated').textContent = state.newsUpdated ? `Berita terakhir diambil ${relTime(state.newsUpdated)} (${fmtTime(state.newsUpdated)} WIB).` : '';
}

// ---------------- RINGKASAN + MOOD ----------------
function recentNews() {
  const day = state.news.filter((n) => Date.now() - Date.parse(n.published) < 24 * HOUR);
  return day.length >= 5 ? day : state.news;
}

function renderSummary() {
  const ul = $('summaryList');
  ul.replaceChildren();
  const li = (emoji, text) => {
    const l = make('li');
    l.append(make('span', 'li-emoji', emoji), make('span', null, text));
    ul.append(l);
  };
  const c = current();
  const prev = previousClose();
  const now = Date.now();

  if (c.usd && prev?.usd) {
    const pct = ((c.usd - prev.usd) / prev.usd) * 100;
    if (Math.abs(pct) < 0.1) li('😐', `Emas lagi kalem, cuma gerak ${fmtPct(pct)} dibanding ${prev.label}.`);
    else if (pct > 0) li('📈', `Emas lagi NAIK ${fmtPct(pct)} dibanding ${prev.label}.`);
    else li('📉', `Emas lagi TURUN ${fmtPct(pct)} dibanding ${prev.label}.`);
  } else if (c.usd) {
    li('🪙', `Harga emas sekarang ${fmtUsd(c.usd)} per ons.`);
  }

  // tren seminggu
  const weekAgo = state.daily.filter((d) => dateMs(d.d) <= now - 7 * 24 * HOUR).at(-1);
  if (c.usd && weekAgo) {
    const p = ((c.usd - weekAgo.usd) / weekAgo.usd) * 100;
    li('🗓️', `Dalam 1 minggu: ${p >= 0 ? 'naik' : 'turun'} ${fmtPct(p)}. Dalam 30 hari: ${monthChangeText(c.usd)}.`);
  }

  // sesi paling gerak hari ini
  const day = displayDate(now);
  const stats = sessionWindows(day)
    .map((w) => sessionStats(w, samplesWithLive(), now))
    .filter((s) => s.n > 1);
  if (stats.length) {
    const top = stats.reduce((a, b) => (Math.abs(b.pct) > Math.abs(a.pct) ? b : a));
    li(top.flag, `Sesi yang paling bikin emas gerak ${day === wibDate(now) ? 'hari ini' : 'terakhir'}: ${top.name} (${fmtPct(top.pct)}).`);
  }

  // sesi sekarang
  const openNow = openSessionsAt(now);
  if (!openNow.length) li('😴', 'Pasar emas lagi tutup. Harga diam sampai sesi berikutnya buka.');
  else if (openNow.some((w) => w.id === 'newyork') && openNow.some((w) => w.id === 'london'))
    li('🔥', 'Sekarang London + New York buka bareng = jam paling rame. Siap-siap harga loncat.');
  else li('🕐', `Sekarang sesi ${openNow.map((w) => w.name).join(' + ')} yang jaga toko.`);

  // berita
  const news = recentNews();
  if (news.length) {
    const byCat = {};
    for (const n of news) if (n.cat !== 'emas') byCat[n.cat] = (byCat[n.cat] || 0) + 1;
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (topCat) li(CATS[topCat[0]]?.emoji || '📰', `Berita paling rame: ${CATS[topCat[0]]?.label || topCat[0]} (${topCat[1]} berita).`);
    const up = news.filter((n) => n.impact === 1).length;
    const down = news.filter((n) => n.impact === -1).length;
    if (up || down) {
      li(
        up > down ? '🟢' : up < down ? '🔴' : '⚪',
        up > down * 1.3
          ? `Mood berita: lebih banyak yang bikin orang takut → biasanya bagus buat emas (▲${up} vs ▼${down}).`
          : down > up * 1.3
            ? `Mood berita: lebih banyak kabar "tenang" → emas bisa tertekan (▲${up} vs ▼${down}).`
            : `Mood berita: campur aduk, seimbang (▲${up} vs ▼${down}).`,
      );
    }
  }
  if (!ul.children.length) li('⏳', 'Lagi ngumpulin data… robot GitHub mencatat harga & berita tiap jam.');
  renderMood(news);
}

function monthChangeText(usd) {
  const m = state.daily.filter((d) => dateMs(d.d) <= Date.now() - 30 * 24 * HOUR).at(-1);
  if (!m) return 'belum ada data';
  const p = ((usd - m.usd) / m.usd) * 100;
  return `${p >= 0 ? 'naik' : 'turun'} ${fmtPct(p)}`;
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
  for (const [cls, v, label] of [
    ['up', up, 'dorong naik'],
    ['flat', flat, 'netral'],
    ['down', down, 'tekan turun'],
  ]) {
    if (!v) continue;
    const seg = make('span', `mood-seg ${cls}`);
    seg.style.flexGrow = v;
    seg.title = `${v} berita ${label}`;
    bar.append(seg);
  }
  bar.setAttribute('aria-label', `${up} berita dorong naik, ${flat} netral, ${down} tekan turun`);
  $('moodCount').textContent = `▲${up} · •${flat} · ▼${down}`;
}

// ---------------- GRAFIK ----------------
function chartPoints() {
  const c = current();
  const cutoff = Date.now() - state.range * 24 * HOUR;
  // titik hari ini pakai harga terkini (live), biar grafik nyambung sama angka di atas
  const days = state.daily.filter((d) => dateMs(d.d) >= cutoff);
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (c.usd && c.idr && !isWeekend(todayUtc) && days.length) {
    if (days.at(-1).d === todayUtc) days.pop();
    days.push({ d: todayUtc, usd: c.usd, idr: c.idr });
  }
  const pts = days
    .map((d) => {
      const idr = d.idr || c.idr;
      return {
        d: d.d,
        value: state.unit === 'idr' ? (idr ? (d.usd / OZ_GRAM) * idr : null) : d.usd,
        label: dfShort.format(dateMs(d.d)),
        fullLabel: dfYear.format(dateMs(d.d)),
      };
    })
    .filter((p) => p.value != null);
  return pts;
}

function renderChart() {
  const pts = chartPoints();
  const box = $('chart');
  const fmtV = state.unit === 'idr' ? fmtIdr : (v) => fmtUsd(v);
  const fmtTick =
    state.unit === 'idr'
      ? (v) => nf0.format(v)
      : (v) => nf0.format(v);
  if (!pts.length) {
    box.replaceChildren(make('p', 'empty', 'Belum ada riwayat harga. Robot akan mengisinya otomatis saat pertama jalan.'));
    $('chartTitle').textContent = '';
  } else {
    const first = pts[0].value;
    const last = pts.at(-1).value;
    const pct = ((last - first) / first) * 100;
    $('chartTitle').textContent = `${state.unit === 'idr' ? 'Rupiah per gram (24K)' : 'Dolar AS per troy ons'} · ${state.range === 365 ? '1 tahun' : `${state.range} hari`}: ${arrow(pct)} ${fmtPct(pct)} · terakhir ${fmtV(last)}`;
    renderLineChart(box, pts, {
      formatValue: fmtV,
      formatTick: fmtTick,
      ariaLabel: `Grafik harga emas ${state.range} hari, dari ${fmtV(first)} ke ${fmtV(last)}`,
    });
  }
  // tabel versi teks
  const t = $('chartTable');
  t.replaceChildren();
  const hr = make('tr');
  hr.append(make('th', null, 'Tanggal'), make('th', 'num', state.unit === 'idr' ? 'Rp/gram' : 'US$/ons'));
  const thead = make('thead');
  thead.append(hr);
  const tb = make('tbody');
  for (const p of pts.slice().reverse()) {
    const tr = make('tr');
    tr.append(make('td', null, p.fullLabel), make('td', 'num', fmtV(p.value)));
    tb.append(tr);
  }
  t.append(thead, tb);
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
  let w = 0;
  new ResizeObserver(() => {
    const nw = $('chart').clientWidth;
    if (Math.abs(nw - w) > 8) {
      w = nw;
      renderChart();
    }
  }).observe($('chart'));
}

// ---------------- KARAT & KALKULATOR ----------------
const KARATS = [
  { k: 24, purity: 1, note: '99,9% · emas batangan/Antam' },
  { k: 23, purity: 23 / 24, note: '95,8%' },
  { k: 22, purity: 22 / 24, note: '91,6% · perhiasan India/Arab' },
  { k: 18, purity: 18 / 24, note: '75% · perhiasan umum' },
  { k: 17, purity: 17 / 24, note: '70,8% · perhiasan toko emas' },
  { k: 16, purity: 16 / 24, note: '66,7%' },
];

function renderKarat() {
  const c = current();
  const t = $('karatTable');
  t.replaceChildren();
  t.classList.add('karat');
  const thead = make('thead');
  const hr = make('tr');
  hr.append(make('th', null, 'Kadar'), make('th', 'num', 'Rp/gram'), make('th', 'num col-usd', 'US$/gram'));
  thead.append(hr);
  const tb = make('tbody');
  for (const k of KARATS) {
    const tr = make('tr');
    const th = make('th');
    th.append(make('b', null, `${k.k}K`), make('span', 'note', k.note));
    tr.append(
      th,
      make('td', 'num', c.gramIdr ? fmtIdr(c.gramIdr * k.purity) : '–'),
      make('td', 'num col-usd', c.usd ? fmtUsd((c.usd / OZ_GRAM) * k.purity) : '–'),
    );
    tb.append(tr);
  }
  t.append(thead, tb);

  const sel = $('calcKarat');
  if (!sel.options.length) {
    for (const k of KARATS) sel.append(new Option(`${k.k}K (${nf(0, 1).format(k.purity * 100)}%)`, String(k.purity)));
    for (const id of ['calcGram', 'calcKarat', 'calcMoney']) $(id).addEventListener('input', renderCalc);
  }
  renderCalc();
}

function renderCalc() {
  const c = current();
  const g = parseFloat($('calcGram').value) || 0;
  const p = parseFloat($('calcKarat').value) || 1;
  $('calcOut').textContent = c.gramIdr ? fmtIdr(g * p * c.gramIdr) : '–';
  const money = parseFloat($('calcMoney').value) || 0;
  $('calcMoneyOut').textContent = c.gramIdr ? `${nf(0, 3).format(money / c.gramIdr)} gram` : '–';
}

// ---------------- KALENDER ----------------
function renderCalendarList() {
  const k = keyTimesWib(wibDate(Date.now()));
  const items = [
    ['💼', 'NFP (data lapangan kerja AS)', `Jumat pertama tiap bulan, ${fmtTime(k.usData)} WIB`, 'Banyak lowongan kerja → dolar kuat → emas sering turun. Sedikit → emas naik.'],
    ['🛒', 'CPI (inflasi AS)', `sekitar tanggal 10–15, ${fmtTime(k.usData)} WIB`, 'Inflasi lebih tinggi dari tebakan → The Fed ogah turunin bunga → emas bisa turun.'],
    ['🏦', 'Rapat The Fed (FOMC)', `8x setahun, ${fmtTime(k.fomc)} WIB dini hari`, 'Bunga turun → emas naik. Bunga tetap/naik → emas bisa turun.'],
    ['📊', 'Klaim pengangguran AS', `tiap Kamis, ${fmtTime(k.usData)} WIB`, 'Pengangguran naik → ekonomi lemah → emas naik.'],
    ['🇨🇳', 'Cadangan emas bank sentral China', 'sekitar tanggal 7 tiap bulan', 'China nambah emas → kabar bagus buat harga emas.'],
  ];
  const ul = $('calList');
  ul.replaceChildren();
  for (const [e, title, when, why] of items) {
    const li = make('li');
    const head = make('div');
    head.append(make('span', 'li-emoji', e), make('b', null, title), make('span', 'muted', ` · ${when}`));
    li.append(head, make('p', 'small', why));
    ul.append(li);
  }
}

// ---------------- BELAJAR ----------------
const LEARN = [
  ['🏦', 'Suku bunga The Fed', 'up', 'Bunga turun ⇒ emas ▲', 'Kalau bunga tabungan/deposito kecil, orang mending simpan emas. Kalau bunga naik, emas jadi kurang menarik.'],
  ['💵', 'Dolar Amerika', 'down', 'Dolar kuat ⇒ emas ▼', 'Emas dibeli pakai dolar. Dolar mahal → emas kerasa mahal buat negara lain → yang beli berkurang.'],
  ['⚔️', 'Perang & konflik', 'up', 'Perang ⇒ emas ▲', 'Orang takut → cari "tempat ngumpet" buat uangnya. Tempat ngumpet favorit = emas (safe haven).'],
  ['📦', 'Tarif & perang dagang', 'up', 'Tarif baru ⇒ emas ▲', 'Contoh: Trump umumkan tarif impor ke banyak negara → dagang dunia bisa macet & harga barang naik → orang lari ke emas. Kalau tarif ditunda / ada "deal" → emas bisa turun.'],
  ['🔥', 'Inflasi', 'up', 'Harga-harga naik ⇒ emas ▲', 'Uang kertas makin "ciut" nilainya. Emas jumlahnya terbatas, jadi nilainya lebih awet.'],
  ['📉', 'Krisis & resesi', 'up', 'Krisis ⇒ emas ▲', 'Bank bangkrut, saham anjlok, negara susah bayar utang → orang pindah ke emas.'],
  ['🏛️', 'Bank sentral borong emas', 'up', 'Bank sentral beli ⇒ emas ▲', 'China, India, Polandia, Turki rajin nambah cadangan emas. Pembeli besar & rutin = harga ketopang.'],
  ['🕊️', 'Damai & gencatan senjata', 'down', 'Suasana tenang ⇒ emas ▼', 'Orang berani lagi beli saham yang lebih "seru". Emas dijual sebagian.'],
  ['⛏️', 'Tambang & kelangkaan', 'up', 'Pasokan seret ⇒ emas ▲ (pelan)', 'Bikin tambang baru butuh 10+ tahun, jadi pasokan susah nambah cepat. Efeknya pelan tapi panjang.'],
  ['💍', 'Musim beli emas', 'up', 'Diwali, Imlek, musim nikah ⇒ permintaan ▲', 'India & China beli emas fisik paling banyak di musim perayaan.'],
  ['💰', 'Ambil untung', 'down', 'Habis naik tinggi ⇒ sering turun sebentar', 'Yang udah untung jual dulu. Ini normal, bukan berarti emas "rusak".'],
  ['🇮🇩', 'Kurs rupiah', 'up', 'Rupiah melemah ⇒ emas (dalam Rp) ▲', 'Walau harga emas dunia diam, kalau rupiah melemah, harga emas per gram dalam rupiah tetap naik.'],
];

function renderLearn() {
  const grid = $('learnGrid');
  grid.replaceChildren();
  for (const [e, title, d, rule, text] of LEARN) {
    const card = make('article', 'learn');
    const h = make('h3');
    h.append(make('span', 'learn-emoji', e), document.createTextNode(title));
    card.append(h, make('p', `rule ${d}`, rule), make('p', 'small', text));
    grid.append(card);
  }
}

// ---------------- TRADINGVIEW (dimuat kalau tombol dipencet) ----------------
function themeNow() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
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
    s.textContent = JSON.stringify({ ...config, colorTheme: themeNow(), theme: themeNow() });
    wrap.append(s);
    box.append(wrap);
    box.classList.add('is-loaded');
    $(btnId).hidden = true;
  });
}

// ---------------- TEMA ----------------
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

// ---------------- JALANKAN ----------------
function renderPrices() {
  renderHero();
  renderSessionCards();
  renderHeat();
  renderSummary();
  renderKarat();
}

async function main() {
  setupTheme();
  renderLearn();
  renderCalendarList();
  renderClock();
  setupChartControls();
  embedTradingView('tvChart', 'tvChartBtn', 'embed-widget-advanced-chart.js', {
    symbol: 'OANDA:XAUUSD',
    interval: '60',
    timezone: 'Asia/Jakarta',
    style: '1',
    locale: 'id',
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
    locale: 'id',
    importanceFilter: '0,1',
    countryFilter: 'us,cn,eu,id',
  });

  startLive().catch((e) => console.warn('live', e));

  await loadRobotData();
  renderPrices();
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
  // data robot di-refresh tiap 15 menit (kalau halaman dibiarkan terbuka)
  setInterval(async () => {
    await loadRobotData();
    renderPrices();
    renderNews();
    renderChart();
  }, 15 * 60e3);
}

main();
