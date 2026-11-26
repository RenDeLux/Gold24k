# 🪙 Gold24k — Pantau Emas Dunia

Website buat ngulik emas dunia **tiap hari**, pakai bahasa simpel.

**Isinya:**

- 💰 **Harga emas 24K live**: Rupiah per gram, dolar per ons, dan kurs dolar. Update tiap 1 menit.
- 🕐 **Harga per sesi**: Sydney, Tokyo, London, New York. Ada jam buka (WIB), harga buka/tutup, tertinggi/terendah, dan naik-turunnya.
- 🔥 **Riwayat 7 hari**: kelihatan sesi mana yang paling sering bikin emas gerak.
- 📰 **Berita yang gerakin emas**: tarif Trump, perang, The Fed, krisis, bank sentral, tambang, dolar. Tiap berita dikasih label ▲/▼ (tebakan otomatis).
- 🍼 **Ringkasan hari ini** + **mood berita** (lebih banyak yang bikin emas naik atau turun).
- 📈 **Grafik** 30 hari / 90 hari / 1 tahun, plus grafik live per jam (TradingView).
- 🧮 **Harga per karat** (24K–16K) + **kalkulator** (gram → Rupiah, Rupiah → gram).
- 🗓️ **Jadwal data ekonomi** (NFP, CPI, The Fed) dalam jam WIB.
- 🧸 **Kenapa emas naik/turun?**: contekan 12 penyebab.

## 🚀 Cara nyalain (sekali aja)

1. Di GitHub, buka **Settings → Pages**. Di bagian **Source**, pilih **GitHub Actions**.
2. Buka tab **Actions**, pilih **"Update data emas & website"**, lalu klik **Run workflow**.
3. Tunggu ±1 menit. Website kamu ada di: **https://rendelux.github.io/Gold24k/**

Setelah itu robot jalan sendiri **tiap jam** (Senin–Jumat). Robotnya nyatet harga, ambil berita, lalu update website.

> ⚠️ Robot jadwal (tiap jam) cuma jalan di **branch utama (default)** repo.

## 🤖 Cara kerjanya

```
GitHub Actions (tiap jam)
   └─ scripts/update-data.mjs
        ├─ harga emas  → data/prices.json   (catatan tiap jam, buat tabel sesi)
        ├─ riwayat     → data/daily.json    (harga harian, buat grafik)
        └─ berita      → data/news.json     (Google News, 8 kategori)
   └─ terbitkan website ke GitHub Pages

Browser (index.html)
   ├─ baca data/*.json
   └─ ambil harga live tiap 1 menit (gold-api.com + open.er-api.com)
```

| File | Isinya |
|---|---|
| `index.html` | Kerangka halaman |
| `assets/app.js` | Otak halaman: hitung & gambar semua bagian |
| `assets/sessions.js` | Jam 4 sesi (otomatis ikut musim panas/dingin) |
| `assets/chart.js` | Grafik garis (tanpa library) |
| `assets/style.css` | Tampilan (ada mode terang & gelap) |
| `scripts/update-data.mjs` | Robot pencatat harga & berita |
| `.github/workflows/update-data.yml` | Jadwal robot |

## ✏️ Mau ubah sesuatu?

- **Tambah/ganti topik berita** → edit `NEWS_QUERIES` di `scripts/update-data.mjs`.
- **Kata kunci ▲/▼** → edit daftar `UP` dan `DOWN` di file yang sama.
- **Jam sesi** → edit `SESSIONS` di `assets/sessions.js` (pakai jam lokal kota itu).

Coba di komputer sendiri:

```bash
node scripts/update-data.mjs   # isi folder data/
npx serve .                    # buka http://localhost:3000
```

## Sumber data

Harga live: [gold-api.com](https://gold-api.com) · Kurs: [open.er-api.com](https://www.exchangerate-api.com) · Riwayat harian: [currency-api](https://github.com/fawazahmed0/exchange-api) · Berita: Google News · Grafik live & kalender: TradingView.

⚠️ Buat belajar & pantau saja, **bukan saran investasi**.
