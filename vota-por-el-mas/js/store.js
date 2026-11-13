// Capa de datos. Dos implementaciones con la misma interfaz:
//  - Firebase Realtime Database (cuando firebase-config.js tiene tus datos)
//  - Modo demo en el navegador (localStorage), para probar con varias pestañas

import { FIREBASE_CONFIG } from "../firebase-config.js";

const FIREBASE_VERSION = "10.14.1";
const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

export function isConfigured(cfg = FIREBASE_CONFIG) {
  return Boolean(cfg && cfg.apiKey && cfg.databaseURL && !/^PEGA/i.test(cfg.apiKey) && !/^PEGA/i.test(cfg.databaseURL));
}

export async function createStore() {
  if (isConfigured()) return firebaseStore(FIREBASE_CONFIG);
  return localStore();
}

async function firebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, fb] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-database.js`),
  ]);
  const app = initializeApp(cfg);
  const db = fb.getDatabase(app);
  return {
    mode: "firebase",
    async get(path) {
      const snap = await fb.get(fb.ref(db, path));
      return snap.val();
    },
    set: (path, value) => fb.set(fb.ref(db, path), value),
    // multi-path desde la raíz; null borra
    update: (map) => fb.update(fb.ref(db), map),
    remove: (path) => fb.remove(fb.ref(db, path)),
    watch(path, cb) {
      return fb.onValue(fb.ref(db, path), (snap) => cb(snap.val()));
    },
    // diferencia entre el reloj de este teléfono y el del servidor, para que el temporizador sea igual en todos
    serverOffset(cb) {
      return fb.onValue(fb.ref(db, ".info/serverTimeOffset"), (snap) => cb(Number(snap.val()) || 0));
    },
  };
}

function localStore() {
  const KEY = "vpm-demo-db";
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  const write = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const keys = (p) => p.split("/").filter(Boolean);
  const getAt = (db, p) => {
    let o = db;
    for (const k of keys(p)) {
      if (o == null || typeof o !== "object") return null;
      o = o[k];
    }
    return o === undefined ? null : o;
  };
  const setAt = (db, p, val) => {
    const ks = keys(p);
    let o = db;
    for (let i = 0; i < ks.length - 1; i++) {
      if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {};
      o = o[ks[i]];
    }
    const last = ks[ks.length - 1];
    if (val === null || val === undefined) delete o[last];
    else o[last] = clone(val);
  };

  const watchers = new Set();
  const notify = () => {
    const db = read();
    watchers.forEach((w) => w.cb(clone(getAt(db, w.path))));
  };
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) notify();
  });

  return {
    mode: "demo",
    async get(path) {
      return clone(getAt(read(), path));
    },
    async set(path, value) {
      const db = read();
      setAt(db, path, value);
      write(db);
      notify();
    },
    async update(map) {
      const db = read();
      for (const [p, v] of Object.entries(map)) setAt(db, p, v);
      write(db);
      notify();
    },
    async remove(path) {
      const db = read();
      setAt(db, path, null);
      write(db);
      notify();
    },
    serverOffset(cb) {
      cb(0);
      return () => {};
    },
    watch(path, cb) {
      const w = { path, cb };
      watchers.add(w);
      queueMicrotask(() => cb(clone(getAt(read(), path))));
      return () => watchers.delete(w);
    },
  };
}
