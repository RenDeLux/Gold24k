// =============================================================
//  LIVE: diskusi + jumlah pembaca online (Firebase Realtime Database)
//  - Tiap pengunjung login anonim (tanpa daftar, tanpa data pribadi)
//  - online/{uid}/{koneksi}  → dihapus otomatis saat tab ditutup
//  - stats/total & stats/daily/{tanggal} → hitung kunjungan
//  - chat/{id} → pesan (maks 200 huruf, tanpa tautan, jeda 5 detik)
// =============================================================
import { firebaseConfig } from './firebase-config.js';
import { t, fmt } from './i18n.js';

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

// status disimpan sebagai kunci, supaya ikut berganti saat bahasa diganti
let status = { key: 'chat.loading', kind: '', vars: null };
function setStatus(key, kind = '', vars = null) {
  status = { key, kind, vars };
  const s = $('chatStatus');
  s.textContent = t(key, vars);
  s.className = `chat-status ${kind}`;
}

const counts = { online: null, today: null, total: null };
function renderCounts(next) {
  Object.assign(counts, next);
  if (counts.online != null) {
    $('onlineNum').textContent = fmt.num(counts.online);
    $('onlineChipText').textContent = t('online.chip', { n: fmt.num(counts.online) });
    $('onlineChip').hidden = false;
  }
  if (counts.today != null) $('viewsToday').textContent = fmt.num(counts.today);
  if (counts.total != null) $('viewsTotal').textContent = fmt.num(counts.total);
}

function showOffline(key) {
  $('chatBox').classList.add('is-off');
  $('chatForm').hidden = true;
  $('liveStats').classList.add('is-off');
  $('onlineChip').hidden = true;
  setStatus(key, 'off');
}

const msgTime = (ms) => (typeof ms === 'number' ? `${fmt.dateTimeWib(ms)} ${fmt.time(ms)}` : '');

function messageEl(id, m, myUid) {
  const li = make('li', `msg${m.uid === myUid ? ' mine' : ''}`);
  li.dataset.id = id;
  li.dataset.t = String(m.t ?? '');
  const head = make('div', 'msg-head');
  head.append(make('b', null, m.name), make('span', 'msg-time', msgTime(m.t)));
  li.append(head, make('p', 'msg-text', m.text));
  return li;
}

function scrollToBottom(force) {
  const list = $('chatList');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  if (force || nearBottom) list.scrollTop = list.scrollHeight;
}

// saat bahasa diganti: perbarui status, angka, dan format jam pesan
document.addEventListener('langchange', () => {
  setStatus(status.key, status.kind, status.vars);
  renderCounts({});
  for (const li of document.querySelectorAll('#chatList .msg')) {
    const ms = Number(li.dataset.t);
    const el = li.querySelector('.msg-time');
    if (el && ms) el.textContent = msgTime(ms);
  }
  const empty = document.querySelector('#chatList .chat-empty');
  if (empty) empty.textContent = t('chat.empty');
});

export async function startLive() {
  if (!firebaseConfig || !firebaseConfig.databaseURL) {
    showOffline('chat.off');
    return;
  }
  setStatus('chat.connecting');
  let app, authMod, dbMod;
  try {
    [app, authMod, dbMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
    ]);
  } catch (e) {
    console.warn(e);
    showOffline('chat.loadFail');
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
    showOffline('chat.authFail');
    return;
  }

  // ---- siapa yang sedang online ----
  onValue(ref(db, '.info/connected'), async (snap) => {
    if (snap.val() !== true) {
      setStatus('chat.reconnecting', 'off');
      return;
    }
    setStatus('chat.connected', 'on');
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

  // ---- pesan ----
  const list = $('chatList');
  list.replaceChildren();
  const empty = make('li', 'chat-empty', t('chat.empty'));
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
  nameIn.value = store('gold24k-name') || `${t('chat.guest')}-${Math.floor(1000 + Math.random() * 9000)}`;
  nameIn.addEventListener('change', () => store('gold24k-name', nameIn.value.trim().slice(0, MAX_NAME)));
  let lastSent = 0;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = nameIn.value.trim().slice(0, MAX_NAME) || t('chat.guest');
    const text = textIn.value.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
    if (!text) return;
    if (LINK_RE.test(text)) {
      setStatus('chat.noLinks', 'warn');
      return;
    }
    const wait = lastSent + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      setStatus('chat.wait', 'warn', { s: Math.ceil(wait / 1000) });
      return;
    }
    store('gold24k-name', name);
    sendBtn.disabled = true;
    const key = push(ref(db, 'chat')).key;
    try {
      // pesan + catatan "terakhir kirim" disimpan bersamaan (pencegah spam)
      await update(ref(db), {
        [`chat/${key}`]: { uid, name, text, t: serverTimestamp() },
        [`lastPost/${uid}`]: serverTimestamp(),
      });
      lastSent = Date.now();
      textIn.value = '';
      setStatus('chat.connected', 'on');
    } catch (e) {
      console.warn(e);
      setStatus('chat.fail', 'warn');
    } finally {
      sendBtn.disabled = false;
      textIn.focus();
    }
  });
}
