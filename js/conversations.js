/**
 * Conversation model + persistence.
 *
 * Every conversation is one item inside a single KV entry keyed by its id, so
 * two tabs editing two different chats never clobber each other (a plain array
 * would shift indexes under concurrent deletes).
 */

import { store } from './store.js';
import { toPlainText } from './markdown.js';
import { BLANK_PROFILE, KEY as PROFILE_KEY, normalise } from './profile.js';

const KEY = 'conversations';
const SETTINGS_KEY = 'settings';

/** One KV entry holds 400 KB. Stay well under it so a save always succeeds. */
const MAX_SAVED_BYTES = 340 * 1024;

export const DEFAULT_SETTINGS = {
  model: null,          // resolved to a live model id on first boot
  systemPrompt: 'You are a helpful assistant.',
  temperature: 0.7,
  maxTokens: null,
  stream: true,
  showReasoning: false,
  sidebarCollapsed: false,
  // Image mode
  imageModel: null,
  imageRatio: '1:1',
  imageQuality: '',
  imageTest: false,
};

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function newConversation(overrides = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: 'New chat',
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function newMessage(role, text = '') {
  return { id: uid(), role, text, ts: Date.now() };
}

/** Derive a title from the first user message, capped for the sidebar. */
export function deriveTitle(conv) {
  const firstUser = conv.messages.find((m) => m.role === 'user' && m.text?.trim());
  if (!firstUser) return 'New chat';
  const plain = toPlainText(firstUser.text) || 'Image message';
  return plain.length > 42 ? plain.slice(0, 42).trimEnd() + '…' : plain;
}

/**
 * Bucket a timestamp for the sidebar: Today, Yesterday, Previous 7 days,
 * Previous 30 days, then the month name.
 */
export function dateGroup(ts, now = Date.now()) {
  const d = new Date(ts);
  const ref = new Date(now);
  if (Number.isNaN(d.getTime())) return 'Earlier';

  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(ref) - midnight(d)) / 86400000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, {
    month: 'long',
    ...(d.getFullYear() !== ref.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/* ── CRUD ────────────────────────────────────────────────── */

export async function listAll() {
  const map = await store.get(KEY);
  if (!map || typeof map !== 'object') return [];
  return Object.values(map)
    .filter((c) => c && c.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getOne(id) {
  const map = await store.get(KEY);
  return map?.[id] ?? null;
}

/**
 * Persist a conversation. If it would exceed the value-size ceiling, older
 * messages are dropped from the saved copy (the live session keeps them) and
 * the chat is flagged so the UI can say so.
 */
export async function save(conv) {
  conv.updatedAt = Date.now();
  if (!conv.title || conv.title === 'New chat') conv.title = deriveTitle(conv);

  let payload = conv;
  try {
    if (JSON.stringify(conv).length > MAX_SAVED_BYTES) {
      payload = { ...conv, trimmed: true };
      // Keep the newest half of the exchange plus the opening message.
      const keep = Math.max(2, Math.floor(conv.messages.length / 2));
      payload.messages = conv.messages.slice(-keep);
      while (JSON.stringify(payload).length > MAX_SAVED_BYTES && payload.messages.length > 1) {
        payload.messages = payload.messages.slice(1);
      }
    }
    await store.update(KEY, { [conv.id]: payload });
    return true;
  } catch (err) {
    console.warn('[conversations] save failed', err);
    return false;
  }
}

export async function remove(id) {
  return store.remove(KEY, id);
}

/** Synchronous best-effort save — used right before a page unload. */
export function saveSync(conv) {
  if (!store.isCloud) {
    // localStorage is synchronous, so a direct write is safe here.
    try {
      const raw = localStorage.getItem('puter-chat:' + KEY);
      const map = raw ? JSON.parse(raw) : {};
      map[conv.id] = { ...conv, updatedAt: Date.now() };
      localStorage.setItem('puter-chat:' + KEY, JSON.stringify(map));
    } catch {}
    return;
  }
  save(conv); // best effort; KV has no sync path
}

export async function clearAll() {
  await store.remove(KEY);
}

/* ── Profile (the "Ask me" flow) ─────────────────────────── */

export async function loadProfile() {
  try {
    return normalise(await store.get(PROFILE_KEY));
  } catch {
    return { ...BLANK_PROFILE };
  }
}

export async function saveProfile(profile) {
  try {
    await store.set(PROFILE_KEY, normalise(profile));
    return true;
  } catch (err) {
    console.warn('[profile] save failed', err);
    return false;
  }
}

export async function clearProfile() {
  try {
    await store.remove(PROFILE_KEY);
    return true;
  } catch (err) {
    console.warn('[profile] clear failed', err);
    return false;
  }
}

/* ── Settings ────────────────────────────────────────────── */

export async function loadSettings() {
  const saved = await store.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

export async function saveSettings(patch) {
  try {
    await store.update(SETTINGS_KEY, patch);
    return true;
  } catch (err) {
    console.warn('[conversations] settings save failed', err);
    return false;
  }
}

export async function clearSettings() {
  return store.remove(SETTINGS_KEY);
}

/** Rough character budget for the next request, used for the composer hint. */
export function estimateTokens(messages, systemPrompt) {
  const chars = (systemPrompt || '').length +
    messages.reduce((n, m) => n + (m.text?.length || 0), 0);
  return Math.ceil(chars / 4);
}