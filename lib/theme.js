/**
 * Theme — night (default), light, or follow the system.
 *
 * Split into pure helpers and a thin DOM layer so the resolution rules can be
 * unit tested. The rules themselves are small but load-bearing:
 *
 *  - Night is the default, not "system". Following the OS by default would
 *    hand a light-mode phone user a light app they never asked for.
 *  - "System" is a *preference*, not a resolved theme. It has to be stored
 *    unresolved so that a phone switching to dark at sunset re-themes an open
 *    tab without the user doing anything.
 */

export const KEY = 'theme';

/** What the user picked. `system` defers to the OS. */
export const PREFS = ['night', 'light', 'system'];
export const DEFAULT_PREF = 'night';

/** The two themes that actually exist as palettes. */
export const THEMES = ['night', 'light'];

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

/** True when the OS is asking for a dark UI. Safe to call anywhere. */
export function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

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

/** Paint the theme. The only place that touches the document. */
export function applyTheme(pref, prefersDark = systemPrefersDark()) {
  const theme = resolveTheme(pref, prefersDark);
  if (typeof document === 'undefined') return theme;
  const el = document.documentElement;
  el.dataset.theme = theme;
  // Native widgets (scrollbars, date pickers, the range input) follow this
  // rather than the UA default, which would stay dark in light mode.
  el.style.colorScheme = theme;
  return theme;
}

/**
 * Runs before first paint, inlined into <head>.
 *
 * Without this the server renders night and a light-mode user sees a dark
 * flash before React hydrates. Setting one attribute costs nothing and makes
 * the flash impossible.
 */
export const BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(KEY)},d=${JSON.stringify(DEFAULT_PREF)};
var p=localStorage.getItem(k);if(p!=='light'&&p!=='night'&&p!=='system')p=d;
var t=p==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'night':'light'):p;
var e=document.documentElement;e.dataset.theme=t;e.style.colorScheme=t;}catch(_){}})();`;
