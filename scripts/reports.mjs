// =============================================================
//  LAPORAN PASAR OTOMATIS (per akhir sesi) — ID & EN
//  Dipanggil robot tiap jam. Untuk setiap sesi yang baru ditutup:
//   - hitung buka/tutup/tertinggi/terendah dari snapshot per jam
//   - ambil berita selama sesi berlangsung
//   - tulis artikel (template) → reports/{id}-id.html & reports/{id}-en.html
//   - daftar laporan disimpan di data/reports.json (buat halaman utama)
// =============================================================
import { SESSIONS, wibDate, addDays, isWeekend, sessionWindows, sessionStats, nextOpening, keyTimesWib } from '../assets/sessions.js';

const OZ_GRAM = 31.1034768;
const HOUR = 3600e3;
const KEEP_REPORTS = 120; // ±30 hari × 4 sesi
const LOOKBACK_MS = 36 * HOUR; // sesi yang tutup dalam 36 jam terakhir

const CAT = {
  id: {
    emas: 'Harga Emas',
    tarif: 'Tarif & Perdagangan',
    perang: 'Geopolitik',
    fed: 'The Fed & Suku Bunga',
    krisis: 'Makro & Inflasi',
    bank: 'Bank Sentral',
    pasokan: 'Tambang & Pasokan',
    dolar: 'Dolar & Rupiah',
  },
  en: {
    emas: 'Gold Price',
    tarif: 'Tariffs & Trade',
    perang: 'Geopolitics',
    fed: 'Fed & Rates',
    krisis: 'Macro & Inflation',
    bank: 'Central Banks',
    pasokan: 'Mining & Supply',
    dolar: 'Dollar & Rupiah',
  },
};

const S = {
  id: {
    locale: 'id-ID',
    session: (n) => `Sesi ${n}`,
    eyebrow: (n) => `Laporan Pasar · Sesi ${n}`,
    head: {
      bigUp: (p, n) => `Emas Menguat ${p} di Sesi ${n}`,
      up: (p, n) => `Emas Naik Tipis di Sesi ${n}`,
      flat: (p, n) => `Emas Stagnan di Sesi ${n}`,
      down: (p, n) => `Emas Turun Tipis di Sesi ${n}`,
      bigDown: (p, n) => `Emas Melemah ${p} di Sesi ${n}`,
    },
    themeSuffix: (th) => `; Sorotan pada ${th}`,
    lede: {
      up: (v) => `Harga emas spot naik ${v.pct} selama sesi ${v.name}, dari ${v.open} menjadi ${v.close} per troy ons antara pukul ${v.t0} dan ${v.t1} WIB.`,
      down: (v) => `Harga emas spot turun ${v.pct} selama sesi ${v.name}, dari ${v.open} menjadi ${v.close} per troy ons antara pukul ${v.t0} dan ${v.t1} WIB.`,
      flat: (v) => `Harga emas spot relatif stagnan selama sesi ${v.name}, ditutup di ${v.close} per troy ons dibandingkan ${v.open} saat pembukaan (${v.t0}–${v.t1} WIB).`,
    },
    range: (v) => `Harga bergerak dalam rentang ${v.range}, dengan level terendah ${v.low} dan tertinggi ${v.high}.`,
    dtd: (up, v) => `Sejak pembukaan sesi Sydney pada hari perdagangan yang sama, emas ${up ? 'naik' : 'turun'} ${v}.`,
    local: (v) => `Dalam rupiah, emas 24 karat setara sekitar ${v.gram} per gram, dengan kurs ${v.fx} per dolar AS.`,
    news: (v) =>
      `Tema ${v.theme} mendominasi arus berita selama sesi, mencakup ${v.n} dari ${v.total} berita yang dipantau. Penandaan sentimen berbasis kata kunci mengklasifikasikan ${v.up} berita sebagai bullish dan ${v.down} sebagai bearish.`,
    noNews: 'Tidak ada berita signifikan yang terpantau selama sesi ini.',
    headlinesH: 'Berita Utama',
    nextH: 'Selanjutnya',
    next: (v) => `Sesi ${v.name} dibuka ${v.sameDay ? '' : `${v.day} `}pukul ${v.time} WIB.`,
    nextUs: (t) => ` Data ekonomi AS biasanya dirilis pukul ${t} WIB.`,
    nextLon: (t) => ` Harga acuan LBMA Gold Price (AM) ditetapkan pukul ${t} WIB.`,
    stats: { open: 'Buka', close: 'Tutup', high: 'Tertinggi', low: 'Terendah', chg: 'Perubahan', gram: '24K per gram' },
    caption: (t0, t1) => `XAU/USD, snapshot per jam, ${t0}–${t1} WIB`,
    meta: (date, time) => `${date} · Terbit ${time} WIB · Desk Otomatis Gold24k`,
    share: 'Bagikan',
    copy: 'Salin tautan',
    copied: 'Tautan disalin',
    back: '← Semua laporan pasar',
    other: 'English',
    imp: { up: 'Bullish', down: 'Bearish', flat: 'Netral' },
    disclaimer: 'Laporan ini dibuat secara otomatis dari data pasar dan judul berita. Bukan merupakan saran investasi.',
  },
  en: {
    locale: 'en-US',
    session: (n) => `${n} session`,
    eyebrow: (n) => `Market Report · ${n} Session`,
    head: {
      bigUp: (p, n) => `Gold Climbs ${p} in ${n} Trading`,
      up: (p, n) => `Gold Edges Higher in ${n} Session`,
      flat: (p, n) => `Gold Little Changed in ${n} Session`,
      down: (p, n) => `Gold Edges Lower in ${n} Session`,
      bigDown: (p, n) => `Gold Falls ${p} in ${n} Trading`,
    },
    themeSuffix: (th) => `; ${th} in Focus`,
    lede: {
      up: (v) => `Spot gold rose ${v.pct} during the ${v.name} session, climbing from ${v.open} to ${v.close} an ounce between ${v.t0} and ${v.t1} WIB.`,
      down: (v) => `Spot gold fell ${v.pct} during the ${v.name} session, slipping from ${v.open} to ${v.close} an ounce between ${v.t0} and ${v.t1} WIB.`,
      flat: (v) => `Spot gold was little changed during the ${v.name} session, ending at ${v.close} an ounce versus ${v.open} at the open (${v.t0}–${v.t1} WIB).`,
    },
    range: (v) => `Prices moved within a ${v.range} range, between a low of ${v.low} and a high of ${v.high}.`,
    dtd: (up, v) => `Gold is ${up ? 'up' : 'down'} ${v} since the Sydney open earlier in the trading day.`,
    local: (v) => `In local terms, 24-karat gold was worth about ${v.gram} per gram, with the dollar at ${v.fx} rupiah.`,
    news: (v) =>
      `${v.theme} dominated news flow during the session, accounting for ${v.n} of ${v.total} tracked headlines. Keyword-based sentiment tagging classed ${v.up} headlines as bullish and ${v.down} as bearish.`,
    noNews: 'No significant headlines were tracked during the session.',
    headlinesH: 'Key Headlines',
    nextH: "What's Next",
    next: (v) => `The ${v.name} session opens ${v.sameDay ? '' : `${v.day} `}at ${v.time} WIB.`,
    nextUs: (t) => ` U.S. economic data is typically released at ${t} WIB.`,
    nextLon: (t) => ` The LBMA Gold Price AM benchmark is set at ${t} WIB.`,
    stats: { open: 'Open', close: 'Close', high: 'High', low: 'Low', chg: 'Change', gram: '24K per gram' },
    caption: (t0, t1) => `XAU/USD, hourly snapshots, ${t0}–${t1} WIB`,
    meta: (date, time) => `${date} · Published ${time} WIB · Gold24k Automated Desk`,
    share: 'Share',
    copy: 'Copy link',
    copied: 'Link copied',
    back: '← All market reports',
    other: 'Bahasa Indonesia',
    imp: { up: 'Bullish', down: 'Bearish', flat: 'Neutral' },
    disclaimer: 'This report was generated automatically from market data and news headlines. It does not constitute investment advice.',
  },
};

// ---------------- format ----------------
const nf = (lang, min, max = min) => new Intl.NumberFormat(S[lang].locale, { minimumFractionDigits: min, maximumFractionDigits: max });
const usd = (lang, n) => (lang === 'en' ? `$${nf('en', 2).format(n)}` : `US$${nf('id', 2).format(n)}`);
const idr = (lang, n) => (lang === 'en' ? `IDR ${nf('en', 0).format(Math.round(n))}` : `Rp${nf('id', 0).format(Math.round(n))}`);
const pctAbs = (lang, p) => `${nf(lang, 2).format(Math.abs(p))}%`;
const pctSigned = (lang, p) => (Math.abs(p) < 0.005 ? `${nf(lang, 2).format(0)}%` : `${p > 0 ? '+' : '−'}${pctAbs(lang, p)}`);
const timeWib = (lang, ms) =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const dateLong = (lang, d) =>
  new Intl.DateTimeFormat(S[lang].locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(Date.parse(d + 'T00:00:00Z'));
const dayShort = (lang, d) =>
  new Intl.DateTimeFormat(S[lang].locale, { timeZone: 'UTC', weekday: 'long' }).format(Date.parse(d + 'T00:00:00Z'));
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

// ---------------- data laporan ----------------
function buildReport(sessionWin, samples, news, nowMs) {
  // snapshot sampai 25 menit setelah tutup dihitung sebagai harga penutupan (robot jalan tiap jam di menit ke-17)
  const win = { ...sessionWin, end: sessionWin.end + 25 * 60e3 };
  const st = sessionStats(win, samples, nowMs);
  if (st.n < 2) return null;
  const fx = [...samples].reverse().find((p) => p.ms <= win.end && p.idr)?.idr ?? null;

  // perubahan sejak pembukaan Sydney (hari perdagangan yang sama)
  const syd = sessionWindows(win.date)[0];
  const first = samples.find((p) => p.ms >= syd.start && p.ms <= win.end);
  const dtd = win.id !== 'sydney' && first && first.ms < win.start ? ((st.close - first.usd) / first.usd) * 100 : null;

  // berita selama sesi (mulai 2 jam sebelum buka); kalau sedikit, pakai 12 jam terakhir
  const pub = (n) => Date.parse(n.published);
  let pool = news.filter((n) => pub(n) >= win.start - 2 * HOUR && pub(n) <= win.end);
  if (pool.length < 3) pool = news.filter((n) => pub(n) >= win.end - 12 * HOUR && pub(n) <= win.end);
  pool.sort((a, b) => pub(b) - pub(a));

  // sesi berikutnya yang dibuka setelah sesi ini tutup
  const next = SESSIONS.map((s) => nextOpening(s.id, win.end)).filter(Boolean).sort((a, b) => a.start - b.start)[0];

  return {
    id: `${win.date}-${win.id}`,
    date: win.date,
    session: win.id,
    name: win.name,
    code: win.code,
    start: win.start,
    end: sessionWin.end,
    open: st.open,
    close: st.close,
    high: st.high,
    low: st.low,
    pct: st.pct,
    n: st.n,
    fx,
    gram: fx ? (st.close / OZ_GRAM) * fx : null,
    dtd,
    points: samples.filter((p) => p.ms >= win.start && p.ms <= win.end).map((p) => [p.ms, p.usd]),
    news: pool.map((n) => ({ title: n.title, source: n.source, url: n.url, impact: n.impact, lang: n.lang, cat: n.cat })),
    next: next ? { id: next.id, name: next.name, start: next.start, date: next.date } : null,
    generated: nowMs,
  };
}

function theme(news) {
  const by = {};
  for (const n of news) if (n.cat !== 'emas') by[n.cat] = (by[n.cat] || 0) + 1;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  return top ? { cat: top[0], n: top[1] } : null;
}

function headline(r, lang, th) {
  const L = S[lang];
  const p = pctAbs(lang, r.pct);
  const kind = r.pct >= 0.5 ? 'bigUp' : r.pct >= 0.1 ? 'up' : r.pct > -0.1 ? 'flat' : r.pct > -0.5 ? 'down' : 'bigDown';
  return L.head[kind](p, r.name) + (th ? L.themeSuffix(CAT[lang][th.cat]) : '');
}

function texts(r, lang) {
  const L = S[lang];
  const news = lang === 'en' ? r.news.filter((n) => n.lang !== 'id') : [...r.news].sort((a, b) => (a.lang === 'id' ? -1 : 0) - (b.lang === 'id' ? -1 : 0));
  const th = theme(news);
  const v = {
    pct: pctAbs(lang, r.pct),
    name: r.name,
    open: usd(lang, r.open),
    close: usd(lang, r.close),
    high: usd(lang, r.high),
    low: usd(lang, r.low),
    range: usd(lang, r.high - r.low),
    t0: timeWib(lang, r.start),
    t1: timeWib(lang, r.end),
  };
  const kind = r.pct >= 0.1 ? 'up' : r.pct <= -0.1 ? 'down' : 'flat';
  const lede = L.lede[kind](v);
  const body = [L.range(v)];
  if (r.dtd != null) body.push(L.dtd(r.dtd >= 0, pctAbs(lang, r.dtd)));
  if (r.gram) body.push(L.local({ gram: idr(lang, r.gram), fx: nf(lang, 0).format(r.fx) }));
  const up = news.filter((n) => n.impact === 1).length;
  const down = news.filter((n) => n.impact === -1).length;
  const newsPara = th ? L.news({ theme: CAT[lang][th.cat], n: th.n, total: news.length, up, down }) : L.noNews;
  let nextPara = '';
  if (r.next) {
    const k = keyTimesWib(r.next.date);
    const sameDay = wibDate(r.next.start) === wibDate(r.end);
    nextPara = L.next({ name: r.next.name, time: timeWib(lang, r.next.start), day: dayShort(lang, wibDate(r.next.start)), sameDay });
    if (r.next.id === 'newyork') nextPara += L.nextUs(timeWib(lang, k.usData));
    if (r.next.id === 'london') nextPara += L.nextLon(timeWib(lang, k.lbmaAm));
  }
  return { title: headline(r, lang, th), lede, body, newsPara, nextPara, news: news.slice(0, 5), theme: th };
}

// grafik garis kecil (SVG statis) untuk halaman laporan
function sparkline(points) {
  if (points.length < 2) return '';
  const W = 640, H = 170, P = { l: 8, r: 14, t: 14, b: 14 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.15 || y1 * 0.001;
  y0 -= pad;
  y1 += pad;
  const X = (x) => P.l + ((x - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (y) => P.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${d}L${X(x1).toFixed(1)},${H - P.b}L${X(x0).toFixed(1)},${H - P.b}Z`;
  const last = points.at(-1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
<line x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}" class="axis"/>
<path d="${area}" class="area"/><path d="${d}" class="line"/>
<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="4.5" class="dot"/></svg>`;
}

export function renderReportHtml(r, lang, siteUrl) {
  const L = S[lang];
  const tx = texts(r, lang);
  const other = lang === 'en' ? 'id' : 'en';
  const file = `${r.id}-${lang}.html`;
  const abs = siteUrl ? `${siteUrl}reports/${file}` : file;
  const dir = r.pct >= 0.005 ? 'up' : r.pct <= -0.005 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  const desc = tx.lede;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${tx.title}\n${abs}`)}`;
  const stat = (k, v, cls = '') => `<div class="stat"><span class="stat-label">${esc(k)}</span><span class="stat-value ${cls}">${esc(v)}</span></div>`;
  const newsList = tx.news.length
    ? `<h2>${esc(L.headlinesH)}</h2><ul class="report-news">${tx.news
        .map((n) => {
          const ik = n.impact === 1 ? 'up' : n.impact === -1 ? 'down' : 'flat';
          return `<li><span class="impact ${ik}">${ik === 'up' ? '▲' : ik === 'down' ? '▼' : '■'} ${esc(L.imp[ik])}</span> <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a> <span class="muted">— ${esc(n.source || '')}</span></li>`;
        })
        .join('')}</ul>`
    : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tx.title)} — Gold24k</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Gold24k">
<meta property="og:title" content="${esc(tx.title)}">
<meta property="og:description" content="${esc(desc)}">
${siteUrl ? `<meta property="og:url" content="${esc(abs)}">\n<link rel="canonical" href="${esc(abs)}">` : ''}
<link rel="alternate" hreflang="${other}" href="${r.id}-${other}.html">
<meta name="theme-color" content="#0d0c0a">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23d9a320'/%3E%3Ctext x='16' y='22' font-family='Arial' font-weight='700' font-size='14' text-anchor='middle' fill='%23111'%3EAu%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="../assets/style.css">
<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
<header class="topbar"><div class="wrap topbar-in">
<a class="brand" href="../index.html?lang=${lang}"><span class="brand-mark" aria-hidden="true">Au</span><span class="brand-name">GOLD24K</span></a>
<span class="nav"></span>
<a class="lang-link" href="${r.id}-${other}.html" hreflang="${other}">${esc(L.other)}</a>
</div></header>
<main class="wrap article">
<p class="eyebrow">${esc(L.eyebrow(r.name))}</p>
<h1 class="article-title">${esc(tx.title)}</h1>
<p class="article-meta">${esc(L.meta(dateLong(lang, r.date), timeWib(lang, r.generated)))}</p>
<div class="article-stats">
${stat(L.stats.chg, `${arrow} ${pctSigned(lang, r.pct)}`, dir)}
${stat(L.stats.open, usd(lang, r.open))}
${stat(L.stats.close, usd(lang, r.close))}
${stat(L.stats.high, usd(lang, r.high))}
${stat(L.stats.low, usd(lang, r.low))}
${r.gram ? stat(L.stats.gram, idr(lang, r.gram)) : ''}
</div>
<figure class="spark-fig">${sparkline(r.points)}<figcaption class="fineprint">${esc(L.caption(timeWib(lang, r.start), timeWib(lang, r.end)))}</figcaption></figure>
<p class="lede">${esc(tx.lede)}</p>
${tx.body.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<p>${esc(tx.newsPara)}</p>
${newsList}
${tx.nextPara ? `<h2>${esc(L.nextH)}</h2><p>${esc(tx.nextPara)}</p>` : ''}
<div class="share">
<span class="share-label">${esc(L.share)}</span>
<a class="btn btn-ghost" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
<button class="btn btn-ghost" type="button" id="copyBtn" data-done="${esc(L.copied)}">${esc(L.copy)}</button>
<button class="btn btn-ghost" type="button" id="shareBtn" hidden>${esc(L.share)}…</button>
</div>
<p class="fineprint">${esc(L.disclaimer)}</p>
<p><a class="back-link" href="../index.html?lang=${lang}#laporan">${esc(L.back)}</a></p>
</main>
<script>
(function(){var u=location.href.split('#')[0],t=document.title;
var c=document.getElementById('copyBtn');c.onclick=function(){(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){c.textContent=c.dataset.done},function(){prompt('',u)})};
var s=document.getElementById('shareBtn');if(navigator.share){s.hidden=false;s.onclick=function(){navigator.share({title:t,url:u}).catch(function(){})}}})();
</script>
</body>
</html>
`;
}

// ---------------- jalankan: cari sesi yang baru tutup ----------------
/**
 * @param {object} p
 * @param {Array<{ms:number,usd:number,idr:number|null}>} p.samples
 * @param {Array} p.news
 * @param {Array} p.existing   isi reports.json sebelumnya
 * @param {number} p.nowMs
 * @param {string} p.siteUrl   contoh "https://user.github.io/repo/" (boleh kosong)
 * @returns {{items:Array, files:Object<string,string>, created:string[]}}
 */
export function generateReports({ samples, news, existing = [], nowMs = Date.now(), siteUrl = '' }) {
  const have = new Set(existing.map((r) => r.id));
  const created = [];
  const files = {};
  const items = [...existing];
  const today = wibDate(nowMs);
  for (const d of [addDays(today, -2), addDays(today, -1), today]) {
    if (isWeekend(d)) continue;
    for (const win of sessionWindows(d)) {
      const id = `${d}-${win.id}`;
      if (have.has(id) || win.end > nowMs || nowMs - win.end > LOOKBACK_MS) continue;
      const r = buildReport(win, samples, news, nowMs);
      if (!r) continue;
      const tid = texts(r, 'id');
      const ten = texts(r, 'en');
      files[`${id}-id.html`] = renderReportHtml(r, 'id', siteUrl);
      files[`${id}-en.html`] = renderReportHtml(r, 'en', siteUrl);
      items.push({
        id,
        date: d,
        session: r.session,
        code: r.code,
        name: r.name,
        end: new Date(r.end).toISOString(),
        pct: Math.round(r.pct * 1000) / 1000,
        close: r.close,
        title: { id: tid.title, en: ten.title },
        lede: { id: tid.lede, en: ten.lede },
        generated: new Date(nowMs).toISOString(),
      });
      created.push(id);
    }
  }
  items.sort((a, b) => b.end.localeCompare(a.end));
  return { items: items.slice(0, KEEP_REPORTS), files, created };
}
