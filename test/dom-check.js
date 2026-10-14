// Cross-checks that app.js and index.html agree with the stylesheet.
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');

/* ── element ids ─────────────────────────────────────────── */

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = new Set(
  [...js.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)].map((m) => m[1] || m[2])
);

const missing = [...used].filter((id) => !htmlIds.has(id));
const unused = [...htmlIds].filter((id) => !used.has(id));

/* ── css classes ─────────────────────────────────────────── */

const classes = new Set();
for (const m of js.matchAll(/class="([a-z0-9 _-]+)"/gi)) m[1].split(/\s+/).forEach((c) => classes.add(c));
for (const m of js.matchAll(/className\s*=\s*'([^']+)'/g)) m[1].split(/\s+/).forEach((c) => classes.add(c));
for (const m of js.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) classes.add(m[1]);
for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => classes.add(c));

// State/utility classes are toggled at runtime; they need no rule of their own.
// `ico--*` classes are JS selector hooks, not styling hooks.
const SPECIAL = new Set([
  'is-active', 'nav-open', 'sidebar-collapsed', 'is-empty', 'live', 'pinned',
  'caret', 'hidden', 'active', 'only-mobile', 'is-streaming', 'has-rule',
  'ico--send', 'ico--stop', 'ico--x',
]);
const noStyle = [...classes].filter((c) => c && !css.includes(`.${c}`) && !SPECIAL.has(c));

/* ── assets ──────────────────────────────────────────────── */

const assets = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);

console.log('element ids referenced by JS :', used.size);
console.log('element ids in HTML          :', htmlIds.size);
console.log('MISSING ids (JS wants them)  :', missing.length ? missing : 'none');
console.log('unused HTML ids              :', unused.length ? unused : 'none');
console.log('css classes checked          :', classes.size);
console.log('classes without a CSS rule   :', noStyle.length ? noStyle : 'none');
console.log('assets referenced            :', assets.join(', '));

const ok = missing.length === 0 && noStyle.length === 0;
console.log(ok ? '\nDOM contract OK\n' : '\nDOM CONTRACT BROKEN\n');
process.exit(ok ? 0 : 1);