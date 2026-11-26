// =============================================================
//  SESI PASAR EMAS
//  Emas diperdagangkan hampir 24 jam (Senin–Jumat).
//  "Sesi" = kota mana yang lagi paling sibuk jualan/beli.
//  Jam buka ditulis dalam jam LOKAL kota itu, lalu diubah ke WIB
//  secara otomatis (jadi aman walau ada perubahan jam musim panas).
// =============================================================

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const WIB_OFFSET = 7 * HOUR; // WIB = UTC+7, tidak pernah berubah

export const SESSIONS = [
  { id: 'sydney', name: 'Sydney', code: 'SYD', tz: 'Australia/Sydney', open: 9, close: 18, liq: 'low' },
  { id: 'tokyo', name: 'Tokyo', code: 'TYO', tz: 'Asia/Tokyo', open: 9, close: 18, liq: 'moderate' },
  { id: 'london', name: 'London', code: 'LDN', tz: 'Europe/London', open: 8, close: 17, liq: 'high' },
  { id: 'newyork', name: 'New York', code: 'NYC', tz: 'America/New_York', open: 8, close: 17, liq: 'veryHigh' },
];

// selisih jam zona waktu (ms) pada waktu tertentu
export function tzOffset(tz, ms) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const t = Math.floor(ms / 1000) * 1000;
  const p = {};
  for (const part of dtf.formatToParts(new Date(t))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - t;
}

// "jam 9 pagi tanggal X di kota Y" → waktu absolut (ms)
export function zonedToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffset(tz, guess);
  let t = guess - off1;
  const off2 = tzOffset(tz, t);
  if (off2 !== off1) t = guess - off2;
  return t;
}

export const wibDate = (ms) => new Date(ms + WIB_OFFSET).toISOString().slice(0, 10);
export function wibHour(ms) {
  const d = new Date(ms + WIB_OFFSET);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}
export const addDays = (dateStr, n) => new Date(Date.parse(dateStr + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const dayOfWeek = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay();
export const isWeekend = (dateStr) => [0, 6].includes(dayOfWeek(dateStr));

// jam buka-tutup 4 sesi untuk 1 tanggal WIB (semua sesi mulai di tanggal WIB yang sama)
export function sessionWindows(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return SESSIONS.map((s) => ({
    ...s,
    date: dateStr,
    start: zonedToUtc(y, m, d, s.open, 0, s.tz),
    end: zonedToUtc(y, m, d, s.close, 0, s.tz),
    closed: isWeekend(dateStr),
  }));
}

// sesi apa saja yang lagi buka di waktu `ms`
export function openSessionsAt(ms) {
  const today = wibDate(ms);
  return [addDays(today, -1), today]
    .flatMap(sessionWindows)
    .filter((w) => !w.closed && ms >= w.start && ms < w.end);
}

// kapan sesi ini buka lagi berikutnya
export function nextOpening(sessionId, ms) {
  let date = wibDate(ms);
  for (let i = 0; i < 6; i++) {
    const w = sessionWindows(date).find((x) => x.id === sessionId);
    if (!w.closed && w.start > ms) return w;
    date = addDays(date, 1);
  }
  return null;
}

// hitung buka / tutup / tertinggi / terendah tiap sesi dari "foto harga"
// samples: [{ms, usd, idr}] urut waktu
export function sessionStats(win, samples, nowMs) {
  const status = win.closed ? 'libur' : nowMs < win.start ? 'belum' : nowMs >= win.end ? 'selesai' : 'buka';
  const inside = win.closed ? [] : samples.filter((p) => p.ms >= win.start && p.ms <= win.end);
  if (!inside.length) return { ...win, status, n: 0 };
  let high = -Infinity;
  let low = Infinity;
  for (const p of inside) {
    if (p.usd > high) high = p.usd;
    if (p.usd < low) low = p.usd;
  }
  const open = inside[0].usd;
  const close = inside.at(-1).usd;
  return {
    ...win,
    status,
    n: inside.length,
    open,
    close,
    high,
    low,
    change: close - open,
    pct: ((close - open) / open) * 100,
    range: high - low,
    idr: inside.at(-1).idr,
  };
}

// daftar tanggal WIB (hari kerja) yang punya data, terbaru dulu
export function tradingDates(samples) {
  const set = new Set();
  for (const p of samples) {
    const d = wibDate(p.ms);
    if (!isWeekend(d)) set.add(d);
    // sesi New York lewat tengah malam: masuk ke tanggal kemarin
    const y = addDays(d, -1);
    if (!isWeekend(y) && sessionWindows(y).some((w) => p.ms >= w.start && p.ms <= w.end)) set.add(y);
  }
  return [...set].sort().reverse();
}

// jam penting lain (dalam WIB) — dihitung otomatis
export function keyTimesWib(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return {
    lbmaAm: zonedToUtc(y, m, d, 10, 30, 'Europe/London'),
    lbmaPm: zonedToUtc(y, m, d, 15, 0, 'Europe/London'),
    usData: zonedToUtc(y, m, d, 8, 30, 'America/New_York'),
    fomc: zonedToUtc(y, m, d, 14, 0, 'America/New_York'),
  };
}
