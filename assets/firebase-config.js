// =============================================================
//  SAMBUNGAN FIREBASE (buat live chat + penghitung pengunjung)
//  Isi dari: Firebase console → ⚙️ Project settings → Your apps → Web app → "firebaseConfig".
//  Kalau masih null, bagian chat & penghitung tampil "belum aktif" (web tetap jalan normal).
//  Catatan: config ini memang boleh publik. Yang menjaga keamanan adalah
//  aturan (rules) di firebase-rules.json yang dipasang di Firebase console.
// =============================================================
export const firebaseConfig = {
  apiKey: 'AIzaSyCniDDtFWPxGJkmtfF9kgBpTZfaxLk4ORI',
  authDomain: 'gold24k-1179b.firebaseapp.com',
  databaseURL: 'https://gold24k-1179b-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'gold24k-1179b',
  storageBucket: 'gold24k-1179b.firebasestorage.app',
  messagingSenderId: '193957276429',
  appId: '1:193957276429:web:f94ab6ae974ad84a445e44',
};
