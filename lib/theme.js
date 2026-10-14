/**
 * Theme — night (default), light, or follow the system.
 *
 * The module is an external store rather than component state because two
 * pickers are on screen at once (the topbar toggle and the one in Settings).
 * With per-component state, changing the theme in Settings would leave the
 * topbar button believing it was still night — its icon would point the wrong
 * way and the first click would appear to do nothing.
 *
 * Rules that are small but load-bearing:
 *
 *  - Night is the default, not "system". Following the OS by default would
 *    hand a light-mode phone user a light app they never asked for.
 *  - "System" is a *preference*, not a resolved theme. It is stored unresolved
 *    so a phone switching to dark at sunset re-themes an open tab with no
 *    action from the user.
 */

/**
 * localStorage key.
 *
 * Deliberately NOT under the `puter-chat:` namespace the data store uses:
 * "Delete all data" sweeps every key with that prefix, and wiping someone's
 * chats should not also flip their app back to dark.
 */
export const KEY = 'gpt-theme';

/** What the user picked. `system` defers to the OS. */
export const PREFS = ['night', 'light', 'system'];
export const DEFAULT_PREF = 'night';

/** The two themes that actually exist as palettes. */
export const THEMES = ['night', 'light'];

/* ── Pure helpers ──────────────────────────────────────────── */

/** Coerce anything (storage, a bad value, null) to a valid preference. */
export function normalisePref(value) {
  return PREFS.includes(value) ? value : DEFAULT_PREF;
}

/**
 * Preference -> concrete theme. `prefersDark` is passed in rather than read
 * from `window` so this stays pure and testable.
 */
export function resolveTheme(pref, prefersDark = true) {
  const p = normalisePref(pref);
  if (p !== 'system') return p;
  return prefersDark ? 'night' : 'light';
}

/** The colour the browser chrome should take for a given theme. */
export function chromeColour(theme) {
  return theme === 'light' ? '#faf9f5' : '#1f1e1d';
}

/** True when the OS is asking for a dark UI. Safe to call anywhere. */
export function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/* ── Persistence ───────────────────────────────────────────── */

export function readPref() {
  if (typeof localStorage === 'undefined') return DEFAULT_PREF;
  try {
    return normalisePref(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREF;   // private mode / storage disabled
  }
}

export function writePref(pref) {
  const p = normalisePref(pref);
  if (typeof localStorage === 'undefined') return p;
  try { localStorage.setItem(KEY, p); } catch { /* nothing we can do */ }
  return p;
}

/* ── Painting ──────────────────────────────────────────────── */

/**
 * Tint the browser/OS chrome to match the page.
 *
 * A `themeColor` media query on `prefers-color-scheme` looks like the obvious
 * solution and is wrong: it tracks the *operating system*, not the choice the
 * user just made here. Forcing light on a dark phone would leave dark chrome
 * wrapped around a cream page. So the meta tag is written from the resolved
 * theme instead.
 */
export function syncBrowserChrome(theme) {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', chromeColour(theme));
}

/** Write the theme to the document. The only DOM write in the module. */
function paint(theme) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.dataset.theme = theme;
  // Native widgets (scrollbars, date pickers, the range input) follow this
  // rather than the UA default, which would stay dark in light mode.
  el.style.colorScheme = theme;
  syncBrowserChrome(theme);
}

/* ── Store ─────────────────────────────────────────────────── */

let pref = DEFAULT_PREF;
let theme = DEFAULT_PREF;    // resolved; equals pref unless pref is "system"
let started = false;

const listeners = new Set();

function emit() {
  for (const fn of [...listeners]) fn();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* Snapshots are primitives on purpose: useSyncExternalStore compares them with
   Object.is and would loop forever on a fresh object each call. */
export function getPrefSnapshot() { return pref; }
export function getThemeSnapshot() { return theme; }
export function getServerSnapshot() { return DEFAULT_PREF; }

/** Re-resolve and repaint. Used by both the picker and the OS listener. */
function commit(nextPref) {
  pref = writePref(nextPref);
  theme = resolveTheme(pref, systemPrefersDark());
  paint(theme);
  emit();
}

export function setPref(next) {
  commit(next);
  return pref;
}

/**
 * Load the stored preference and start following the OS. Idempotent, because
 * the store is module-level and this may run from more than one bundle entry.
 *
 * Nothing here reads the DOM before the boot script has run — the boot script
 * is synchronous in <head>, this runs later during hydration — so `pref` here
 * only has to agree with what the script already painted, not establish it.
 */
export function initTheme() {
  if (started) return theme;
  started = true;

  pref = readPref();
  theme = resolveTheme(pref, systemPrefersDark());
  paint(theme);

  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // Only "system" cares; an explicit night/light choice outranks the OS.
      if (pref !== 'system') return;
      theme = resolveTheme('system', mq.matches);
      paint(theme);
      emit();
    };
    mq.addEventListener('change', onChange);
  }

  // The first render used the server snapshot (always night). If the stored
  // preference differs, subscribers have to be told, or a light-mode user
  // would keep the night icons and a stale button until some other re-render.
  emit();

  return theme;
}

/** Force the store back to a known state. Tests only. */
export function __resetForTests() {
  started = false;
  pref = DEFAULT_PREF;
  theme = DEFAULT_PREF;
  listeners.clear();
}

/**
 * Runs before first paint, inlined into <head>.
 *
 * Without this the server renders night and a light-mode user sees a dark
 * flash before React hydrates. Setting one attribute costs nothing and makes
 * the flash impossible.
 *
 * The storage read and the meta write are each guarded separately on purpose.
 * A single wrapping try/catch looks tidier but means a browser that blocks
 * localStorage (Safari private mode, cookies disabled) throws on the very
 * first statement and skips the paint entirely — leaving the page without a
 * resolved theme at all. Painting must survive a missing storage.
 *
 * The literals are interpolated from the same constants `resolveTheme` uses so
 * the script cannot drift from the module.
 */
export const BOOT_SCRIPT = `(function(){
var k=${JSON.stringify(KEY)},d=${JSON.stringify(DEFAULT_PREF)},p=d;
try{var s=localStorage.getItem(k);if(s==='light'||s==='night'||s==='system')p=s;}catch(_){}
var t=p==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'night':'light'):p;
var e=document.documentElement;e.dataset.theme=t;e.style.colorScheme=t;
try{var m=document.querySelector('meta[name="theme-color"]');
if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}
m.setAttribute('content',t==='light'?'#faf9f5':'#1f1e1d');}catch(_){}
})();`;
