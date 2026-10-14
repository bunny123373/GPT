/**
 * Extracts every Tailwind class token used in app/ and components/ and checks
 * it against the compiled stylesheet. Catches utility classes that silently
 * fail to generate — the usual cause of "the CSS looks wrong".
 *
 *   node test/tailwind-audit.js
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['app', 'components'].map((d) => join(process.cwd(), d));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.jsx')) out.push(p);
  }
  return out;
}

// Every string in the source that looks like a class list.
const CLASSLIKE = /className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g;
// Tailwind tokens: allow letters, digits, -, _, :, /, ., [], %, #, commas.
const TOKEN = /[a-z0-9][a-z0-9\-_:\/\.\[\]#%,()]*/gi;

const used = new Set();
for (const file of roots.flatMap((r) => walk(r))) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = CLASSLIKE.exec(src))) {
    const raw = (m[1] || m[2] || '')
      // Drop conditional-expression branches and interpolations.
      .replace(/\$\{[^}]*\}/g, ' ')
      .split(/\?|\|/);
    for (const chunk of raw) {
      for (const t of chunk.trim().split(/\s+/)) {
        if (t && !t.includes('$')) used.add(t);
      }
    }
  }
}

// Structural / state classes that Tailwind does not own.
const NOT_TAILWIND = new Set([
  'md', 'thin-scroll', 'thinking-dot', 'animate-plating', 'animate-fade-text',
  'animate-menu-in', 'animate-toast-in', 'sr-only', 'mono',
]);

const cssFiles = [];
function findCss(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findCss(p);
    else if (p.endsWith('.css')) cssFiles.push(p);
  }
}
findCss(join(process.cwd(), '.next', 'static'));

if (!cssFiles.length) {
  console.error('No compiled CSS found. Run `npx next build` first.');
  process.exit(1);
}
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

/**
 * Does the stylesheet define a rule for this utility?
 *
 * Tailwind escapes every character outside [a-zA-Z0-9_-] with a backslash in
 * the selector, so `rounded-[28px]` is emitted as `.rounded-\[28px\]`. Build
 * that exact selector and look for it literally — building a RegExp here
 * would misread `\[` as a character class.
 */
function compiled(token) {
  if (NOT_TAILWIND.has(token)) return true;
  const escaped = Array.from(token)
    .map((ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`))
    .join('');
  return css.includes(`.${escaped}`);
}

const missing = [...used]
  // A real utility starts with a letter, a dash (negative) or `[` (arbitrary).
  .filter((t) => /^[a-z-]/.test(t) || t.startsWith('['))
  .filter((t) => !compiled(t))
  .sort();

/* ── A capped-width column must be centred ──────────────── */
const page = readFileSync(join(process.cwd(), 'app', 'page.js'), 'utf8');
const uncentred = [];
for (const m of page.matchAll(/className=\{?["`]([^"`]*max-w-content[^"`]*)["`]/g)) {
  if (!m[1].includes('mx-auto')) uncentred.push(m[1].trim().slice(0, 60));
}

console.log(`class tokens found : ${used.size}`);
console.log(`compiled CSS       : ${cssFiles.length} file(s), ${Math.round(css.length / 1024)}KB`);
console.log(`not generated      : ${missing.length ? missing.join(', ') : 'none'}`);
console.log(`uncentred columns  : ${uncentred.length ? uncentred.join(' | ') : 'none'}`);

const bad = missing.length + uncentred.length;
console.log(bad ? '\nProblems found.\n' : '\nAll utilities compiled and every column is centred.\n');
process.exit(bad ? 1 : 0);