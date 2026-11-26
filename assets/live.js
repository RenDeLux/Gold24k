// =============================================================
//  LIVE: chat + "berapa orang lagi lihat" (pakai Firebase Realtime Database)
//  - Tiap pengunjung login anonim (tanpa daftar, tanpa data pribadi)
//  - online/{uid}/{koneksi}  → dihapus otomatis saat tab ditutup
//  - stats/total & stats/daily/{tanggal} → hitung kunjungan
//  - chat/{id} → pesan (maks 200 huruf, tanpa link, jeda 5 detik)
// =============================================================
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const MAX_MESSAGES = 60;
const MAX_TEXT = 200;
const MAX_NAME = 20;
const COOLDOWN_MS = 5000;
const LINK_RE = /(https?:|www\.|wa\.me|t\.me|bit\.ly|\.com\b|\.id\b)/i;

const $ = (id) => document.getElementById(id);
const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const nf = new Intl.NumberFormat('id-ID');
const tf = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return value;
}
function onceThisSession(key) {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {}
  return true;
}

function setStatus(text, kind = '') {
  const s = $('chatStatus');
  s.textContent = text;
  s.className = `chat-status ${kind}`;
}

function showOffline(reason) {
  $('chatBox').classList.add('is-off');
  $('chatForm').hidden = true;
  setStatus(reason, 'off');
  $('liveStats').classList.add('is-off');
  $('onlineChip').hidden = true;
}

function renderCounts({ online, today, total }) {
  if (online != null) {
    $('onlineNum').textContent = nf.format(online);
    $('onlineChipNum').textContent = nf.format(online);
    $('onlineChip').hidden = false;
  }
  if (today != null) $('viewsToday').textContent = nf.format(today);
  if (total != null) $('viewsTotal').textContent = nf.format(total);
}

function messageEl(id, m, myUid) {
  const li = make('li', `msg${m.uid === myUid ? ' mine' : ''}`);
  li.dataset.id = id;
  const head = make('div', 'msg-head');
  head.append(make('b', null, m.name), make('span', 'msg-time', typeof m.t === 'number' ? `${df.format(m.t)} ${tf.format(m.t)}` : ''));
  li.append(head, make('p', 'msg-text', m.text));
  return li;
}

function scrollToBottom(force) {
  const list = $('chatList');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  if (force || nearBottom) list.scrollTop = list.scrollHeight;
}

export async function startLive() {
  if (!firebaseConfig || !firebaseConfig.databaseURL) {
    showOffline('💬 Chat & penghitung pengunjung belum aktif. Pemilik web perlu menyambungkan Firebase dulu.');
    return;
  }
  setStatus('Menyambungkan…');
  let app, authMod, dbMod;
  try {
    [app, authMod, dbMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
    ]);
  } catch (e) {
    console.warn(e);
    showOffline('💬 Chat lagi nggak bisa dimuat. Coba refresh nanti ya.');
    return;
  }
  const { initializeApp } = app;
  const { getAuth, signInAnonymously } = authMod;
  const {
    getDatabase,
    ref,
    push,
    set,
    update,
    onValue,
    onDisconnect,
    serverTimestamp,
    query,
    orderByChild,
    limitToLast,
    onChildAdded,
    onChildRemoved,
    runTransaction,
  } = dbMod;

  const fb = initializeApp(firebaseConfig);
  const auth = getAuth(fb);
  const db = getDatabase(fb);

  let uid;
  try {
    uid = (await signInAnonymously(auth)).user.uid;
  } catch (e) {
    console.warn(e);
    showOffline('💬 Chat belum bisa login. Pemilik web: aktifkan "Anonymous" di Firebase Authentication.');
    return;
  }

  // ---- siapa yang lagi online ----
  onValue(ref(db, '.info/connected'), async (snap) => {
    if (snap.val() !== true) {
      setStatus('Koneksi putus, nyambung lagi…', 'off');
      return;
    }
    setStatus('🟢 Tersambung', 'on');
    const me = push(ref(db, `online/${uid}`));
    try {
      await onDisconnect(me).remove();
      await set(me, serverTimestamp());
    } catch (e) {
      console.warn('presence', e);
    }
  });
  onValue(ref(db, 'online'), (snap) => renderCounts({ online: Math.max(1, snap.size) }));

  // ---- hitung kunjungan (sekali per tab) ----
  const today = wibDate();
  if (onceThisSession('gold24k-counted')) {
    const bump = (path) => runTransaction(ref(db, path), (v) => (typeof v === 'number' ? v : 0) + 1).catch((e) => console.warn(path, e));
    bump('stats/total');
    bump(`stats/daily/${today}`);
  }
  onValue(ref(db, 'stats/total'), (s) => renderCounts({ total: s.val() || 0 }));
  onValue(ref(db, `stats/daily/${today}`), (s) => renderCounts({ today: s.val() || 0 }));

  // ---- chat ----
  const list = $('chatList');
  list.replaceChildren();
  const empty = make('li', 'chat-empty', 'Belum ada obrolan. Jadi yang pertama nyapa! 👋');
  list.append(empty);
  const q = query(ref(db, 'chat'), orderByChild('t'), limitToLast(MAX_MESSAGES));
  onChildAdded(q, (snap) => {
    const m = snap.val();
    if (!m || typeof m.text !== 'string' || typeof m.name !== 'string') return;
    empty.remove();
    list.append(messageEl(snap.key, m, uid));
    while (list.children.length > MAX_MESSAGES) list.firstElementChild.remove();
    scrollToBottom(m.uid === uid);
  });
  onChildRemoved(q, (snap) => list.querySelector(`[data-id="${CSS.escape(snap.key)}"]`)?.remove());

  // ---- kirim pesan ----
  const form = $('chatForm');
  const nameIn = $('chatName');
  const textIn = $('chatText');
  const sendBtn = $('chatSend');
  form.hidden = false;
  nameIn.value = store('gold24k-name') || `Tamu-${Math.floor(1000 + Math.random() * 9000)}`;
  nameIn.addEventListener('change', () => store('gold24k-name', nameIn.value.trim().slice(0, MAX_NAME)));
  let lastSent = 0;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim().slice(0, MAX_NAME) || 'Tamu';
    const text = textIn.value.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
    if (!text) return;
    if (LINK_RE.test(text)) {
      setStatus('⚠️ Link nggak boleh dikirim di chat (biar aman dari penipuan).', 'warn');
      return;
    }
    const wait = lastSent + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      setStatus(`⏳ Tunggu ${Math.ceil(wait / 1000)} detik lagi ya.`, 'warn');
      return;
    }
    store('gold24k-name', name);
    sendBtn.disabled = true;
    const key = push(ref(db, 'chat')).key;
    try {
      // pesan + catatan "terakhir kirim" disimpan bareng (buat cegah spam)
      await update(ref(db), {
        [`chat/${key}`]: { uid, name, text, t: serverTimestamp() },
        [`lastPost/${uid}`]: serverTimestamp(),
      });
      lastSent = Date.now();
      textIn.value = '';
      setStatus('🟢 Tersambung', 'on');
    } catch (e) {
      console.warn(e);
      setStatus('⚠️ Pesan gagal terkirim. Mungkin terlalu cepat atau ada link. Coba lagi.', 'warn');
    } finally {
      sendBtn.disabled = false;
      textIn.focus();
    }
  });
}
