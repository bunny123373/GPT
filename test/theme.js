/**
 * Theme tests.
 *
 * Two things here are worth testing and easy to get wrong:
 *
 *  1. The boot script. It is the only thing standing between a light-mode
 *     user and a dark flash, it is not type-checked, and it runs before React
 *     exists. So it is *executed* here against a stub DOM rather than grepped.
 *  2. The store. Two pickers are live at once, so "who wins" when Settings and
 *     the topbar both write has to be unambiguous.
 *
 *   node test/theme.js
 */

const theme = await import('../lib/theme.js');
const {
  KEY, PREFS, DEFAULT_PREF, THEMES, BOOT_SCRIPT,
  normalisePref, resolveTheme, chromeColour, systemPrefersDark,
  readPref, writePref, syncBrowserChrome,
  subscribe, getPrefSnapshot, getThemeSnapshot, getServerSnapshot,
  initTheme, setPref, __resetForTests,
} = theme;

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${a}\n       want: ${b}`); }
};
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ── a stub browser ───────────────────────────────────────── */

/**
 * Minimal window/document/localStorage. `stored` seeds localStorage, and
 * `prefersDark` drives matchMedia. `listeners` collects the change handlers
 * the store registers so a test can fire a fake OS switch.
 */
function makeEnv({ stored = null, prefersDark = true, storageThrows = false } = {}) {
  const map = new Map();
  if (stored !== null) map.set(KEY, stored);

  const localStorage = {
    getItem: (k) => {
      if (storageThrows) throw new Error('denied');
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => {
      if (storageThrows) throw new Error('denied');
      map.set(k, String(v));
    },
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };

  const meta = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
  };

  const created = [];
  const head = { appendChild: (n) => created.push(n) };

  const documentElement = { dataset: {}, style: {} };

  const document = {
    documentElement,
    head,
    _meta: meta,
    _queried: [],
    querySelector(sel) {
      this._queried.push(sel);
      return sel === 'meta[name="theme-color"]' ? this._meta : null;
    },
    createElement() {
      return { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
    },
  };

  const listeners = [];
  const mq = {
    matches: prefersDark,
    addEventListener: (_type, fn) => listeners.push(fn),
    removeEventListener: (_type, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };

  const window = { matchMedia: () => mq };

  return { map, localStorage, document, documentElement, meta, created, listeners, mq, window };
}

/** Install an env as the globals the module probes for. */
function install(env) {
  globalThis.window = env.window;
  globalThis.document = env.document;
  globalThis.localStorage = env.localStorage;
}

function uninstall() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
}

/* ── constants ────────────────────────────────────────────── */

console.log('\nconstants');
eq('night first, so it is the default', PREFS[0], 'night');
eq('default preference is night', DEFAULT_PREF, 'night');
eq('theme key is namespaced away from the data store', KEY, 'gpt-theme');
ok('key is not swept by "delete all data"', !KEY.startsWith('puter-chat:'),
  `got ${KEY}`);
eq('only two real palettes exist', THEMES, ['night', 'light']);
ok('system is a preference, not a theme', !THEMES.includes('system'));

/* ── normalisePref ────────────────────────────────────────── */

console.log('\nnormalisePref');
eq('keeps night', normalisePref('night'), 'night');
eq('keeps light', normalisePref('light'), 'light');
eq('keeps system', normalisePref('system'), 'system');
for (const bad of [null, undefined, '', 'dark', 'LIGHT', 'Night', 0, 1, {}, [], true]) {
  eq(`garbage ${JSON.stringify(bad)} falls back to night`, normalisePref(bad), 'night');
}

/* ── resolveTheme ─────────────────────────────────────────── */

console.log('\nresolveTheme');
eq('night ignores the OS', resolveTheme('night', false), 'night');
eq('night ignores a dark OS', resolveTheme('night', true), 'night');
eq('light ignores the OS', resolveTheme('light', true), 'light');
eq('light ignores a light OS', resolveTheme('light', false), 'light');
eq('system + dark OS = night', resolveTheme('system', true), 'night');
eq('system + light OS = light', resolveTheme('system', false), 'light');
eq('system defaults to dark when the OS is unknown', resolveTheme('system'), 'night');
eq('garbage + light OS = night (default wins, not the OS)', resolveTheme('garbage', false), 'night');
eq('resolving twice is stable', resolveTheme(resolveTheme('light', true), false), 'light');

/* ── chromeColour ─────────────────────────────────────────── */

console.log('\nchromeColour');
eq('night chrome', chromeColour('night'), '#1f1e1d');
eq('light chrome', chromeColour('light'), '#faf9f5');
eq('anything else is treated as night', chromeColour('bogus'), '#1f1e1d');

/* ── persistence ──────────────────────────────────────────── */

console.log('\npersistence (no storage)');
uninstall();
eq('readPref without localStorage is night', readPref(), 'night');
eq('writePref without localStorage still normalises', writePref('light'), 'light');
eq('writePref rejects garbage', writePref('banana'), 'night');
eq('systemPrefersDark without window is true', systemPrefersDark(), true);

console.log('\npersistence (stubbed storage)');
{
  const env = makeEnv({ stored: 'light' });
  install(env);
  eq('reads what was written', readPref(), 'light');

  env.map.set(KEY, 'garbage');
  eq('garbage in storage reads as night', readPref(), 'night');
  env.map.delete(KEY);
  eq('missing key reads as night', readPref(), 'night');

  eq('writePref returns the stored value', writePref('system'), 'system');
  eq('and it round-trips', readPref(), 'system');
  eq('storage holds the raw preference, not a resolved theme',
    env.map.get(KEY), 'system');
  eq('writePref normalises garbage', writePref('nope'), 'night');
  eq('storage agrees', env.map.get(KEY), 'night');
  uninstall();
}
{
  install(makeEnv({ storageThrows: true }));
  eq('a throwing storage does not crash a read', readPref(), 'night');
  eq('a throwing storage does not crash a write', writePref('light'), 'light');
  uninstall();
}

/* ── the boot script ──────────────────────────────────────── */

console.log('\nboot script');
{
  /* It must be self-contained: no imports, no helper names, runs before React. */
  ok('is an IIFE', /^\s*\(function\s*\(\)/.test(BOOT_SCRIPT));
  ok('guards storage and DOM access separately, so a blocked storage still paints',
    BOOT_SCRIPT.includes('catch(') && BOOT_SCRIPT.split('catch(').length - 1 >= 2,
    `catch blocks: ${BOOT_SCRIPT.split('catch(').length - 1}`);
  ok('references the same storage key', BOOT_SCRIPT.includes(JSON.stringify(KEY)));
  ok('accepts only the three known preferences',
    BOOT_SCRIPT.includes("'light'") && BOOT_SCRIPT.includes("'night'") && BOOT_SCRIPT.includes("'system'"));
  ok('sets data-theme', BOOT_SCRIPT.includes('dataset.theme'));
  ok('sets color-scheme', BOOT_SCRIPT.includes('colorScheme'));
  ok('touches the theme-color meta', BOOT_SCRIPT.includes('theme-color'));

  const runBoot = (env) => {
    install(env);
    // Evaluated, not string-matched: the point of this test is that it runs.
    new Function(BOOT_SCRIPT)();
    const out = {
      theme: env.documentElement.dataset.theme,
      scheme: env.documentElement.style.colorScheme,
      chrome: env.meta.getAttribute('content'),
    };
    uninstall();
    return out;
  };

  eq('stored light paints light', runBoot(makeEnv({ stored: 'light' })),
    { theme: 'light', scheme: 'light', chrome: '#faf9f5' });
  eq('stored night paints night', runBoot(makeEnv({ stored: 'night' })),
    { theme: 'night', scheme: 'night', chrome: '#1f1e1d' });
  eq('stored system + dark OS paints night',
    runBoot(makeEnv({ stored: 'system', prefersDark: true })),
    { theme: 'night', scheme: 'night', chrome: '#1f1e1d' });
  eq('stored system + light OS paints light',
    runBoot(makeEnv({ stored: 'system', prefersDark: false })),
    { theme: 'light', scheme: 'light', chrome: '#faf9f5' });
  eq('nothing stored paints night', runBoot(makeEnv()),
    { theme: 'night', scheme: 'night', chrome: '#1f1e1d' });
  eq('garbage stored paints night', runBoot(makeEnv({ stored: 'chartreuse' })),
    { theme: 'night', scheme: 'night', chrome: '#1f1e1d' });
  eq('storage blocked still paints night rather than nothing',
    runBoot(makeEnv({ storageThrows: true })),
    { theme: 'night', scheme: 'night', chrome: '#1f1e1d' });

  // A missing meta tag must be created, not assumed.
  {
    const env = makeEnv({ stored: 'light' });
    env.document._meta = null;
    install(env);
    new Function(BOOT_SCRIPT)();
    ok('creates a theme-color meta when the document has none',
      env.created.length === 1 && env.created[0].attrs.content === '#faf9f5',
      JSON.stringify(env.created));
    uninstall();
  }
}

/* ── the store ────────────────────────────────────────────── */

console.log('\nstore snapshots');
{
  uninstall();
  __resetForTests();
  eq('server snapshot is the default', getServerSnapshot(), 'night');
  eq('pref snapshot before init', getPrefSnapshot(), 'night');
  eq('theme snapshot before init', getThemeSnapshot(), 'night');
  eq('server snapshot is a stable primitive', getServerSnapshot(), getServerSnapshot());
}

console.log('\nstore init');
{
  const env = makeEnv({ stored: 'light' });
  install(env); __resetForTests();

  let notified = 0;
  const unsub = subscribe(() => { notified++; });

  eq('initTheme returns the resolved theme', initTheme(), 'light');
  eq('pref reflects storage', getPrefSnapshot(), 'light');
  eq('theme reflects storage', getThemeSnapshot(), 'light');
  eq('the document was painted', env.documentElement.dataset.theme, 'light');
  eq('color-scheme followed', env.documentElement.style.colorScheme, 'light');
  eq('browser chrome followed', env.meta.getAttribute('content'), '#faf9f5');
  ok('subscribers were told, so the topbar icon is not stale', notified >= 1,
    `notified=${notified}`);

  const before = notified;
  initTheme();
  eq('initTheme is idempotent', notified, before);
  eq('only one OS listener was registered', env.listeners.length, 1);

  unsub();
  uninstall();
}

console.log('\nstore writes');
{
  const env = makeEnv({ stored: 'night' });
  install(env); __resetForTests();
  initTheme();

  let notified = 0;
  subscribe(() => { notified++; });

  eq('setPref returns the stored preference', setPref('light'), 'light');
  eq('pref moved', getPrefSnapshot(), 'light');
  eq('theme moved with it', getThemeSnapshot(), 'light');
  eq('the document was repainted', env.documentElement.dataset.theme, 'light');
  eq('chrome was repainted', env.meta.getAttribute('content'), '#faf9f5');
  eq('storage was updated', env.map.get(KEY), 'light');
  ok('subscribers fired', notified >= 1, `notified=${notified}`);

  setPref('banana');
  eq('a bad pick falls back to night', getPrefSnapshot(), 'night');
  eq('storage never holds a bad value', env.map.get(KEY), 'night');

  uninstall();
}

console.log('\nstore follows the OS only for "system"');
{
  const env = makeEnv({ stored: 'system', prefersDark: true });
  install(env); __resetForTests();
  initTheme();
  eq('system + dark OS starts at night', getThemeSnapshot(), 'night');

  const fire = (dark) => { env.mq.matches = dark; env.listeners.forEach((fn) => fn()); };

  fire(false);
  eq('the OS going light flips the theme', getThemeSnapshot(), 'light');
  eq('and repaints the document', env.documentElement.dataset.theme, 'light');
  eq('and the chrome', env.meta.getAttribute('content'), '#faf9f5');
  eq('the stored preference stays "system"', env.map.get(KEY), 'system');

  fire(true);
  eq('the OS going back dark flips it again', getThemeSnapshot(), 'night');

  uninstall();
}
{
  const env = makeEnv({ stored: 'light', prefersDark: true });
  install(env); __resetForTests();
  initTheme();

  env.mq.matches = true;
  env.listeners.forEach((fn) => fn());
  eq('an explicit light choice outranks a dark OS', getThemeSnapshot(), 'light');
  eq('the document agrees', env.documentElement.dataset.theme, 'light');

  env.mq.matches = false;
  env.listeners.forEach((fn) => fn());
  eq('still light', getThemeSnapshot(), 'light');

  uninstall();
}
{
  const env = makeEnv({ stored: 'night', prefersDark: false });
  install(env); __resetForTests();
  initTheme();

  env.mq.matches = false;
  env.listeners.forEach((fn) => fn());
  eq('an explicit night choice outranks a light OS', getThemeSnapshot(), 'night');

  uninstall();
}

console.log('\nsyncBrowserChrome');
{
  const env = makeEnv();
  install(env);
  syncBrowserChrome('light');
  eq('writes the light chrome', env.meta.getAttribute('content'), '#faf9f5');
  syncBrowserChrome('night');
  eq('writes the night chrome', env.meta.getAttribute('content'), '#1f1e1d');

  env.document._meta = null;
  syncBrowserChrome('night');
  ok('creates the meta tag once when missing', env.created.length === 1);

  uninstall();
  syncBrowserChrome('light');   // must not throw without a document
  ok('is a no-op without a document', true);
}

/* ── done ─────────────────────────────────────────────────── */

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
