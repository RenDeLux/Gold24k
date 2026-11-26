#!/usr/bin/env node
// =============================================================
//  ROBOT PENCATAT EMAS 🤖
//  Dijalankan GitHub Actions tiap jam. Tugasnya:
//   1. Ambil harga emas dunia (XAU/USD) + kurs USD/IDR
//   2. Simpan "foto harga" ke data/prices.json  (buat tabel per sesi)
//   3. Simpan harga penutupan harian ke data/daily.json (buat grafik)
//   4. Ambil berita penting (tarif, perang, The Fed, dst) ke data/news.json
//  Tidak butuh library tambahan: cukup Node 18+.
// =============================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 (compatible; pantau-emas-bot/1.0; +https://github.com)';

const KEEP_SAMPLE_DAYS = 21;   // simpan foto harga tiap jam selama 21 hari
const KEEP_DAILY_DAYS = 400;   // simpan harga harian ~1 tahun lebih
const BACKFILL_DAYS = 120;     // run pertama: isi riwayat 120 hari ke belakang
const NEWS_MAX_AGE_H = 72;     // berita lebih tua dari 3 hari dibuang
const NEWS_PER_CAT = 12;       // maksimal berita per kategori

const log = (...a) => console.log('•', ...a);
const warn = (...a) => console.warn('⚠️ ', ...a);

// ---------- helper ambil data dari internet ----------
async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} dari ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
const getJSON = async (url) => (await fetchWithTimeout(url)).json();
const getText = async (url) => (await fetchWithTimeout(url)).text();

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJSON(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 1) + '\n');
}

// currency-api (gratis, ada XAU & IDR). tag = 'latest' atau 'YYYY-MM-DD'
const currencyApiUrls = (tag) => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
  `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];
async function currencyApi(tag) {
  for (const url of currencyApiUrls(tag)) {
    try {
      const j = await getJSON(url);
      if (j && j.usd) return j;
    } catch (e) {
      warn(e.message);
    }
  }
  return null;
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWeekendUtc = (dateStr) => [0, 6].includes(new Date(dateStr + 'T00:00:00Z').getUTCDay());

// ---------- 1. harga emas ----------
async function fetchGoldUsd() {
  try {
    const j = await getJSON('https://api.gold-api.com/price/XAU');
    if (j && j.price > 0) return { usd: round(j.price), source: 'gold-api.com' };
  } catch (e) {
    warn('gold-api.com gagal:', e.message);
  }
  const j = await currencyApi('latest');
  if (j && j.usd.xau > 0) return { usd: round(1 / j.usd.xau), source: 'currency-api (harian)' };
  throw new Error('Semua sumber harga emas gagal');
}

// ---------- 2. kurs rupiah ----------
async function fetchUsdIdr() {
  try {
    const j = await getJSON('https://open.er-api.com/v6/latest/USD');
    if (j && j.rates && j.rates.IDR > 0) return { idr: round(j.rates.IDR, 0), source: 'open.er-api.com' };
  } catch (e) {
    warn('open.er-api.com gagal:', e.message);
  }
  const j = await currencyApi('latest');
  if (j && j.usd.idr > 0) return { idr: round(j.usd.idr, 0), source: 'currency-api' };
  return null;
}

// ---------- 3. riwayat harian ----------
async function backfillDaily(days, nowMs) {
  const have = new Set(days.map((d) => d.d));
  const wanted = [];
  for (let i = 1; i <= BACKFILL_DAYS; i++) {
    const d = utcDate(nowMs - i * 864e5);
    if (!have.has(d) && !isWeekendUtc(d)) wanted.push(d);
  }
  log(`Isi riwayat harian: ${wanted.length} hari`);
  const out = [];
  const queue = [...wanted];
  const worker = async () => {
    while (queue.length) {
      const d = queue.shift();
      const j = await currencyApi(d);
      if (j && j.usd.xau > 0) {
        out.push({ d, usd: round(1 / j.usd.xau), idr: j.usd.idr ? round(j.usd.idr, 0) : null });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ---------- 4. berita ----------
// cat = kategori di website. lang = bahasa berita.
const NEWS_QUERIES = [
  { cat: 'tarif', lang: 'en', q: 'Trump tariffs' },
  { cat: 'tarif', lang: 'id', q: 'tarif Trump' },
  { cat: 'perang', lang: 'en', q: '(war OR missile OR airstrike OR invasion) escalation' },
  { cat: 'perang', lang: 'id', q: '(perang OR serangan OR rudal) (Iran OR Israel OR Rusia OR Ukraina OR Gaza OR Houthi OR Taiwan OR militer)' },
  { cat: 'fed', lang: 'en', q: '"Federal Reserve" interest rates' },
  { cat: 'fed', lang: 'id', q: '"The Fed" suku bunga' },
  { cat: 'krisis', lang: 'en', q: '(recession OR inflation OR "financial crisis" OR "debt crisis") economy' },
  { cat: 'krisis', lang: 'id', q: 'resesi OR "krisis ekonomi" OR "krisis keuangan" OR "inflasi AS"' },
  { cat: 'bank', lang: 'en', q: '"central bank" gold reserves' },
  { cat: 'bank', lang: 'id', q: '"bank sentral" "cadangan emas"' },
  { cat: 'pasokan', lang: 'en', q: '"gold mine" OR "gold supply" OR "gold shortage"' },
  { cat: 'pasokan', lang: 'id', q: '"tambang emas" produksi' },
  { cat: 'dolar', lang: 'en', q: '"dollar index" OR "Treasury yields"' },
  { cat: 'dolar', lang: 'id', q: 'rupiah "dolar AS"' },
  { cat: 'emas', lang: 'en', q: '"gold price"' },
  { cat: 'emas', lang: 'id', q: '"harga emas"' },
];

const googleNewsUrl = ({ q, lang }) => {
  const query = encodeURIComponent(`${q} when:2d`);
  return lang === 'id'
    ? `https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`
    : `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
};

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
};

export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const source = tag(it, 'source');
    let title = tag(it, 'title').replace(/\s+/g, ' ');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(it, 'link');
    const published = Date.parse(tag(it, 'pubDate'));
    if (!title || !/^https?:\/\//.test(link) || Number.isNaN(published)) continue;
    items.push({ title, source, url: link, published });
  }
  return items;
}

// Tebakan sederhana: berita ini cenderung bikin emas naik (+1) / turun (-1) / netral (0)
// Catatan: "rupiah melemah" dihitung ▲ karena harga emas dalam Rupiah ikut naik.
const UP = [
  // en: takut, perang, krisis, bunga turun, dolar lemah
  /\bwars?\b/, /missile/, /airstrike/, /invasion/, /(?<!de-)escalat/, /\bconflict/, /tension/, /sanction/,
  /tariff/, /trade war/, /\bcrisis/, /recession/, /\bdefault/, /shutdown/, /rate cuts?\b/, /cuts? (interest )?rates/,
  /dovish/, /weak(er)? dollar/, /dollar (falls|fell|slides|slips|weakens|drops|sinks)/, /safe[- ]haven/,
  /(buy|buying|bought|purchas\w*|adds?|added) .{0,25}gold/, /record high/, /all-time high/, /shortage/,
  /uncertaint/, /turmoil/, /stocks? (tumble|plunge|crash)/, /yields? (fall|fell|drop|slide|slip)/, /sliding yields/,
  /(gold|bullion|xau).{0,30}\b(rise|rises|rose|jump|jumps|climb|climbs|gain|gains|rall(y|ies)|surge|surges|soar|soars|recover|recovers|rebound|rebounds|record)/,
  // id
  /perang/, /rudal/, /serangan/, /invasi/, /konflik/, /ketegangan/, /sanksi/, /tarif/, /krisis/, /resesi/,
  /gagal bayar/, /(pangkas|penurunan|turunkan|potong|memangkas) suku bunga/, /suku bunga turun/,
  /dola?r (as )?.{0,15}(melemah|lemah|loyo)/, /aset aman/, /borong emas/, /(beli|tambah|menambah) (cadangan )?emas/,
  /ketidakpastian/, /gejolak/, /imbal hasil.{0,15}(turun|menurun)/,
  /rupiah.{0,25}(melemah|anjlok|tertekan|terlemah|jeblok|ambruk|tembus rp)/,
  /emas.{0,60}(naik|melonjak|menguat|meroket|terbang|rekor|pulih|bangkit|rebound|tertinggi)/,
];
const DOWN = [
  // en: bunga naik, dolar kuat, damai, ambil untung, emas turun
  /rate hikes?/, /\bhike (bets?|probability|odds)/, /(raise|raises|raising|hike|hikes|lift|lifts) (its |the )?(key |base |benchmark |interest )?rates?\b/,
  /hawkish/, /strong(er)? dollar/, /dollar (rises|rose|gains|jumps|strengthens|rallies|firms)/,
  /yields? (rise|rose|climb|jump|surge)/, /cease-?fire/, /truce/, /peace (deal|talks|agreement|plan)/,
  /trade (deal|agreement|truce|pact)/, /tariffs? (pause|cut|relief|delay|exemption|rollback)/, /profit[- ]taking/,
  /easing tensions/, /de-escalat/, /risk[- ]on/, /sell-?off/, /bad news for.{0,25}gold/,
  /(gold|bullion|xau).{0,30}\b(fall|falls|fell|drop|drops|slide|slides|slip|slips|tumble|tumbles|retreat|retreats|decline|declines|ease|eases|sink|sinks|plunge|plunges|slump|slumps|loss|losses|decrease|lowest)/,
  /sharp (decrease|drop|fall|decline)/,
  // id
  /kenaikan suku bunga/, /suku bunga naik/, /(naikkan|kerek|menaikkan|mengerek) suku bunga/,
  /dola?r (as )?.{0,15}(menguat|perkasa|kuat)/, /imbal hasil.{0,15}(naik|meningkat|melonjak)/,
  /gencatan senjata/, /\bdamai\b/, /perdamaian/, /kesepakatan dagang/, /(penundaan|penangguhan|tunda) tarif/,
  /ambil untung/, /emas.{0,60}(turun|menurun|anjlok|melemah|merosot|ambles|terkoreksi|jatuh|longsor|ambruk|terendah)/,
  /meredanya ketegangan/, /ketegangan (mereda|menurun)/,
];
// frasa "ketegangan mereda" jangan sampai dihitung sebagai "ketegangan" (▲)
const CALMING = /(easing|ease|eases|cool(ing|s)?|calm(ing|s)?|de-?escalat\w*)\s+(\w+\s+)?tensions?|meredanya ketegangan|ketegangan (mereda|menurun)/g;

export function guessImpact(title) {
  const t = title.toLowerCase();
  const up = UP.filter((r) => r.test(t.replace(CALMING, ' '))).length;
  const down = DOWN.filter((r) => r.test(t)).length;
  return up > down ? 1 : down > up ? -1 : 0;
}

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim().slice(0, 80);

async function fetchNews(nowMs) {
  const seen = new Set();
  const perCat = {};
  let ok = 0;
  for (const q of NEWS_QUERIES) {
    try {
      const xml = await getText(googleNewsUrl(q));
      ok++;
      for (const it of parseRss(xml)) {
        if (nowMs - it.published > NEWS_MAX_AGE_H * 3600e3) continue;
        const key = normTitle(it.title);
        if (seen.has(key)) continue;
        seen.add(key);
        (perCat[q.cat] ||= []).push({
          ...it,
          published: new Date(it.published).toISOString(),
          cat: q.cat,
          lang: q.lang,
          impact: guessImpact(it.title),
        });
      }
    } catch (e) {
      warn(`Berita "${q.q}" gagal:`, e.message);
    }
  }
  const items = Object.values(perCat)
    .flatMap((arr) => arr.sort((a, b) => b.published.localeCompare(a.published)).slice(0, NEWS_PER_CAT))
    .sort((a, b) => b.published.localeCompare(a.published));
  return { ok, items };
}

// ---------- jalankan semua ----------
async function main() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const onlyNews = process.argv.includes('--news-only');

  if (!onlyNews) {
    // harga + kurs
    const gold = await fetchGoldUsd();
    const fx = await fetchUsdIdr();
    const prices = await readJSON('prices.json', { samples: [] });
    const lastIdr = prices.samples.at(-1)?.idr ?? null;
    const sample = { t: nowIso, usd: gold.usd, idr: fx?.idr ?? lastIdr };
    log(`Emas: $${gold.usd}/oz (${gold.source}) · Kurs: Rp${sample.idr ?? '?'} (${fx?.source ?? 'pakai data lama'})`);

    // kalau robot jalan 2x berdekatan (misal dijalankan manual), timpa yang terakhir
    const last = prices.samples.at(-1);
    if (last && now - Date.parse(last.t) < 20 * 60e3) prices.samples.pop();
    prices.samples.push(sample);
    prices.samples = prices.samples.filter((s) => now - Date.parse(s.t) < KEEP_SAMPLE_DAYS * 864e5);
    prices.updated = nowIso;
    prices.source = { gold: gold.source, fx: fx?.source ?? null };
    await writeJSON('prices.json', prices);

    // harian (pakai tanggal UTC; nilai terakhir hari itu ≈ harga penutupan New York)
    const daily = await readJSON('daily.json', { days: [] });
    const today = utcDate(now);
    if (!isWeekendUtc(today)) {
      daily.days = daily.days.filter((d) => d.d !== today);
      daily.days.push({ d: today, usd: gold.usd, idr: sample.idr });
    }
    if (daily.days.length < 60) daily.days.push(...(await backfillDaily(daily.days, now)));
    const cutoff = utcDate(now - KEEP_DAILY_DAYS * 864e5);
    daily.days = daily.days.filter((d) => d.d >= cutoff).sort((a, b) => a.d.localeCompare(b.d));
    daily.updated = nowIso;
    await writeJSON('daily.json', daily);
    log(`Riwayat harian: ${daily.days.length} hari`);
  }

  // berita
  const { ok, items } = await fetchNews(now);
  if (ok > 0) {
    await writeJSON('news.json', { updated: nowIso, items });
    log(`Berita: ${items.length} judul dari ${ok}/${NEWS_QUERIES.length} pencarian`);
  } else {
    warn('Semua pencarian berita gagal, data berita lama dipertahankan');
  }
}

// hanya jalan kalau file ini dieksekusi langsung (bukan di-import untuk tes)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('❌', e);
    process.exit(1);
  });
}
