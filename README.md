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
- 📰 **Laporan pasar otomatis** tiap akhir sesi (ID & EN). Tiap laporan punya halaman sendiri di `reports/` + tombol share WhatsApp.
- ⏱️ **Grafik intraday** per jam (1/3/5 hari) dengan lajur sesi SYD/TYO/LDN/NYC.
- 🌐 **Dua bahasa (ID / EN)** dengan gaya bahasa media keuangan. Tombol di pojok kanan atas, atau link langsung `?lang=en`.
- 💬 **Live chat** + 👀 **berapa orang lagi online** + jumlah kunjungan (perlu Firebase, lihat di bawah).
- 🧸 **Kenapa emas naik/turun?**: contekan 12 penyebab.

## 🚀 Cara nyalain (sekali aja)

1. Di GitHub, buka **Settings → Pages**. Di bagian **Source**, pilih **GitHub Actions**.
2. Buka tab **Actions**, pilih **"Update data emas & website"**, lalu klik **Run workflow**.
3. Tunggu ±1 menit. Website kamu ada di: **https://rendelux.github.io/Gold24k/**

Setelah itu robot jalan sendiri **tiap jam** (Senin–Jumat). Robotnya nyatet harga, ambil berita, lalu update website.

> ⚠️ Robot jadwal (tiap jam) cuma jalan di **branch utama (default)** repo.

## 💬 Nyalain live chat + penghitung pengunjung (Firebase, gratis)

Butuh akun Google. Sekali setup ±5 menit:

1. Buka **https://console.firebase.google.com** → **Create a project** → nama: `gold24k` → Google Analytics boleh dimatikan → **Create**.
2. Menu **Build → Realtime Database** → **Create Database** → lokasi **Singapore (asia-southeast1)** → pilih **Start in locked mode** → **Enable**.
3. Masih di Realtime Database, buka tab **Rules** → hapus semua isinya → tempel isi file [`firebase-rules.json`](firebase-rules.json) → **Publish**.
4. Menu **Build → Authentication** → **Get started** → tab **Sign-in method** → pilih **Anonymous** → **Enable** → **Save**.
   Lalu tab **Settings → Authorized domains** → **Add domain** → `rendelux.github.io`.
5. Klik ⚙️ **Project settings** → bagian **Your apps** → ikon **`</>`** (Web) → nama `gold24k` → **Register app**.
   Salin isi `firebaseConfig` (apiKey, authDomain, databaseURL, projectId, dst) ke file `assets/firebase-config.js`.
   Kalau `databaseURL` nggak muncul, ambil dari halaman Realtime Database (alamat di atas daftar data).

Aturan keamanan yang dipasang (`firebase-rules.json`):
- Pesan maks 200 huruf, nama maks 20 huruf, **link diblokir** (anti penipuan), jeda **5 detik** antar pesan.
- Orang cuma bisa nambah pesan, **nggak bisa edit/hapus** pesan orang lain.
- Pemilik web bisa **hapus pesan** lewat Firebase console → Realtime Database → `chat` → klik 🗑️.

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
| `assets/i18n.js` | Semua teks ID/EN + format angka & tanggal |
| `assets/live.js` | Live chat + hitung pengunjung (Firebase) |
| `assets/firebase-config.js` | Sambungan ke Firebase (diisi sekali) |
| `firebase-rules.json` | Aturan keamanan chat (ditempel di Firebase) |
| `scripts/update-data.mjs` | Robot pencatat harga & berita |
| `scripts/reports.mjs` | Penulis laporan pasar otomatis (per akhir sesi) |
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
