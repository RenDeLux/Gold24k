// =============================================================
//  PANEL PASAR: perak, minyak, kurs (dipanggil robot tiap jam)
//  - Perak (XAG): harga spot dari gold-api.com; penutupan kemarin dari currency-api
//  - Minyak WTI & Brent (futures bulan terdekat) dan kurs: Yahoo Finance (per jam)
//  - Cadangan kurs: open.er-api.com (harian)
//  Hasil: data/markets.json → { items: { SYM: { last, prev, asOf, src, series } } }
// =============================================================

const HOUR = 3600e3;
const KEEP_SERIES_MS = 5 * 24 * HOUR;

// sym = kode di website; yahoo = simbol Yahoo; fx = kode kurs cadangan (er-api: 1 USD = x)
export const INSTRUMENTS = [
  { sym: 'XAG', goldApi: 'XAG', currencyApi: 'xag', invertCurrencyApi: true },
  { sym: 'WTI', yahoo: 'CL=F' },
  { sym: 'BRENT', yahoo: 'BZ=F' },
  { sym: 'USDIDR', yahoo: 'IDR=X', fx: 'IDR' },
  { sym: 'USDSGD', yahoo: 'SGD=X', fx: 'SGD' },
  { sym: 'EURUSD', yahoo: 'EURUSD=X', fx: 'EUR', invertFx: true },
  { sym: 'GBPUSD', yahoo: 'GBPUSD=X', fx: 'GBP', invertFx: true },
];

const yahooUrls = (sym, query) => [
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${query}`,
  `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${query}`,
];

async function yahooChart(getJSON, sym, query) {
  let lastErr;
  for (const url of yahooUrls(sym, query)) {
    try {
      const j = await getJSON(url);
      const r = j?.chart?.result?.[0];
      if (r?.meta) return r;
      lastErr = new Error(j?.chart?.error?.description || 'respons kosong');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function seriesFromChart(r) {
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) if (close[i] != null && isFinite(close[i])) out.push([ts[i] * 1000, +close[i]]);
  return out;
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const decimals = (sym) => (sym === 'USDIDR' ? 2 : sym.startsWith('USD') || sym.endsWith('USD') ? 5 : 3);
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

async function fromYahoo(getJSON, ins) {
  const intraday = await yahooChart(getJSON, ins.yahoo, 'interval=60m&range=5d');
  let prev = null;
  try {
    const day = await yahooChart(getJSON, ins.yahoo, 'interval=1d&range=1d');
    prev = day.meta.chartPreviousClose ?? day.meta.previousClose ?? null;
  } catch {}
  const m = intraday.meta;
  const series = seriesFromChart(intraday);
  const last = m.regularMarketPrice ?? series.at(-1)?.[1];
  if (!(last > 0)) throw new Error('harga kosong');
  return {
    last,
    prev: prev ?? m.previousClose ?? null,
    asOf: (m.regularMarketTime ? m.regularMarketTime * 1000 : series.at(-1)?.[0]) || Date.now(),
    src: 'Yahoo Finance',
    series,
  };
}

export async function updateMarkets({ getJSON, readJSON, writeJSON, now, log, warn, currencyApi, fxRates }) {
  const store = await readJSON('markets.json', { items: {} });
  const items = store.items || {};
  let ok = 0;

  for (const ins of INSTRUMENTS) {
    const old = items[ins.sym] || {};
    let fresh = null;
    try {
      if (ins.goldApi) {
        // logam: harga spot + seri per jam dikumpulkan sendiri
        const j = await getJSON(`https://api.gold-api.com/price/${ins.goldApi}`);
        if (!(j?.price > 0)) throw new Error('harga kosong');
        const series = (old.series || []).filter((p) => now - p[0] < KEEP_SERIES_MS);
        const lastPt = series.at(-1);
        if (lastPt && now - lastPt[0] < 20 * 60e3) series.pop();
        series.push([now, +j.price]);
        // penutupan hari sebelumnya: simpan nilai terakhir per tanggal UTC
        const closes = { ...(old.closes || {}) };
        closes[utcDate(now)] = +j.price;
        const prevDates = Object.keys(closes).filter((d) => d < utcDate(now)).sort();
        let prev = prevDates.length ? closes[prevDates.at(-1)] : null;
        if (prev == null && currencyApi) {
          const y = await currencyApi(utcDate(now - 24 * HOUR));
          const v = y?.usd?.[ins.currencyApi];
          if (v > 0) prev = ins.invertCurrencyApi ? 1 / v : v;
        }
        for (const d of Object.keys(closes)) if (d < utcDate(now - 10 * 24 * HOUR)) delete closes[d];
        fresh = { last: +j.price, prev, asOf: Date.parse(j.updatedAt) || now, src: 'gold-api.com', series, closes };
      } else {
        fresh = await fromYahoo(getJSON, ins);
      }
    } catch (e) {
      warn(`${ins.sym}: sumber utama gagal (${e.message})`);
      // cadangan kurs harian
      if (ins.fx && fxRates?.[ins.fx] > 0) {
        const v = ins.invertFx ? 1 / fxRates[ins.fx] : fxRates[ins.fx];
        fresh = { ...old, last: v, asOf: now, src: 'open.er-api.com', series: old.series || [] };
        if (old.last && !old.prev) fresh.prev = old.last;
      }
    }
    if (fresh) {
      const d = decimals(ins.sym);
      fresh.last = round(fresh.last, d);
      if (fresh.prev != null) fresh.prev = round(fresh.prev, d);
      fresh.series = (fresh.series || []).filter((p) => now - p[0] < KEEP_SERIES_MS).map(([t, v]) => [t, round(v, d)]);
      items[ins.sym] = fresh;
      ok++;
    } else if (old.last) {
      items[ins.sym] = { ...old, stale: true };
    }
  }

  await writeJSON('markets.json', { updated: new Date(now).toISOString(), items });
  log(`Panel pasar: ${ok}/${INSTRUMENTS.length} instrumen diperbarui`);
}
