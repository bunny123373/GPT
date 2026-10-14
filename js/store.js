/**
 * Persistence adapter.
 *
 * Primary backend : Puter key-value store (puter.kv) — lives in the user's
 *                   own cloud account, so chats follow them across devices.
 * Fallback backend: localStorage, used when the visitor is not signed in or
 *                   when KV is unavailable. Same API, same semantics.
 *
 * Both backends support dotted-path updates/removals so the app never has to
 * read-modify-write a whole collection just to touch one conversation.
 */

const LS_PREFIX = 'puter-chat:';

/* ── dotted-path helpers ─────────────────────────────────── */

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function removePath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur || typeof cur !== 'object' || !(k in cur)) return obj;
    cur = cur[k];
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  return obj;
}

/* ── localStorage backend ────────────────────────────────── */

const local = {
  read: (key) => {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? null : JSON.parse(raw);
    } catch { return null; }
  },
  write: (key, value) => {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[store] localStorage write failed', err);
      return false;
    }
  },
  remove: (key) => { try { localStorage.removeItem(LS_PREFIX + key); } catch {} },
};

/* ── Puter KV backend ────────────────────────────────────── */

function hasPuter() {
  return typeof puter !== 'undefined' && puter && puter.kv;
}

export class Store {
  constructor() {
    /** @type {'puter'|'local'} */
    this.backend = 'local';
    this.signedIn = false;
    this.user = null;
    this._degraded = false;
  }

  /** Detect auth and pick a backend. Safe to call once at boot. */
  async init() {
    try {
      this.signedIn = hasPuter() ? await puter.auth.isSignedIn() : false;
    } catch {
      this.signedIn = false;
    }

    if (this.signedIn) {
      try {
        this.user = await puter.auth.getUser();
      } catch { /* profile is optional */ }
      this.backend = 'puter';
    }

    // One probe read: if KV is blocked or broken, degrade instead of throwing
    // on every write for the rest of the session.
    try {
      await this.get('__probe__');
    } catch (err) {
      console.warn('[store] KV unavailable, using localStorage', err);
      this.backend = 'local';
      this._degraded = true;
    }
    return this;
  }

  get isCloud() { return this.backend === 'puter' && !this._degraded; }

  async get(key) {
    if (this.backend === 'puter') {
      const v = await puter.kv.get(key);
      return v === undefined ? null : v;
    }
    return local.read(key);
  }

  async set(key, value) {
    if (this.backend === 'puter') {
      await puter.kv.set(key, value);
      return true;
    }
    return local.write(key, value);
  }

  /** Shallow-merge `patch` into `key`, with support for dotted paths. */
  async update(key, patch) {
    if (this.backend === 'puter') {
      await puter.kv.update(key, patch);
      return true;
    }
    const current = local.read(key) ?? {};
    const next = { ...current };
    for (const [path, value] of Object.entries(patch)) {
      if (path.includes('.')) setPath(next, path, value);
      else next[path] = value;
    }
    return local.write(key, next);
  }

  /** Remove one path (dotted) or the whole key when `path` is omitted. */
  async remove(key, path) {
    if (this.backend === 'puter') {
      if (path === undefined) await puter.kv.del(key);
      else await puter.kv.remove(key, path);
      return true;
    }
    if (path === undefined) return local.remove(key), true;
    const current = local.read(key);
    if (current && typeof current === 'object') {
      local.write(key, removePath(current, path));
    }
    return true;
  }

  /** Erase this app's data from the active backend. */
  async clearAll() {
    if (this.backend === 'puter') {
      try { await puter.kv.flush(); } catch { /* nothing stored yet */ }
    }
    try {
      // Use the standard Storage enumeration (length + key) rather than
      // Object.keys(), which only lists own properties on some implementations.
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) doomed.push(k);
      }
      doomed.forEach((k) => localStorage.removeItem(k));
    } catch (err) {
      console.warn('[store] could not clear localStorage', err);
    }
  }
}

export const store = new Store();