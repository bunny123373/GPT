/**
 * Theme CSS tests.
 *
 * The theme works by re-pointing CSS variables, which means the failure mode
 * is silent: a token declared in the night palette but not the light one does
 * not error, it just inherits the dark value and leaves one unreadable element
 * on a cream page. Nothing short of a browser would notice, so this checks the
 * stylesheet directly instead.
 *
 *   node test/tokens.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_PATH = join(process.cwd(), 'app', 'globals.css');
const source = readFileSync(CSS_PATH, 'utf8');
// Comments are stripped first: several of them contain prose that would
// otherwise look like declarations.
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${a}\n       want: ${b}`); }
};

/* ── extract the three blocks that must agree ─────────────── */

const grab = (re) => {
  const m = re.exec(css);
  return m ? m[1] : null;
};

const night = grab(/:root\s*,\s*:root\[data-theme="night"\]\s*\{([\s\S]*?)\n\}/);
const light = grab(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
const inline = grab(/@theme inline\s*\{([\s\S]*?)\n\}/);

function decls(text) {
  const out = new Map();
  if (!text) return out;
  for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

console.log('\npalette blocks');
ok('a night block exists', night !== null);
ok('a light block exists', light !== null);
ok('a @theme inline block exists, so utilities can follow the theme', inline !== null);

const nightVars = decls(night);
const lightVars = decls(light);
const inlineVars = decls(inline);

ok('the blocks parsed into a real number of tokens',
  nightVars.size > 20 && lightVars.size > 20,
  `night=${nightVars.size} light=${lightVars.size}`);

/* ── the headline guarantee: the two palettes are the same shape ── */

console.log('\nparity');
{
  const n = [...nightVars.keys()].sort();
  const l = [...lightVars.keys()].sort();
  const missingFromLight = n.filter((k) => !lightVars.has(k));
  const missingFromNight = l.filter((k) => !nightVars.has(k));
  ok('every night token is defined in light too', missingFromLight.length === 0,
    missingFromLight.join(', '));
  ok('every light token is defined at night too', missingFromNight.length === 0,
    missingFromNight.join(', '));
  eq('the two palettes declare the same set', l, n);
}

/* ── nothing may reference a variable that was never declared ── */

console.log('\nreferences resolve');
{
  const referenced = new Set();
  for (const m of css.matchAll(/var\(\s*(--c-[a-zA-Z0-9-]+)/g)) referenced.add(m[1]);
  const undeclared = [...referenced].filter((v) => !nightVars.has(v)).sort();
  ok('every var(--c-*) used is declared in the palettes', undeclared.length === 0,
    undeclared.join(', '));

  // The @theme layer maps Tailwind names onto palette variables; a typo there
  // produces a utility that compiles but resolves to nothing.
  const bridges = new Map();
  for (const [name, value] of inlineVars) {
    const m = /^var\(\s*(--c-[a-zA-Z0-9-]+)\s*\)$/.exec(value);
    if (m) bridges.set(name, m[1]);
  }
  ok('the theme layer actually maps Tailwind colours to palette vars',
    bridges.size > 20, `bridges=${bridges.size}`);

  const danglingBridges = [...bridges]
    .filter(([, target]) => !nightVars.has(target))
    .map(([name, target]) => `${name} -> ${target}`);
  ok('no Tailwind colour maps to an undeclared palette var',
    danglingBridges.length === 0, danglingBridges.join(', '));

  // And the reverse: a palette var that nothing maps or uses is dead weight.
  const unscoped = [...nightVars.keys()]
    .filter((v) => v.startsWith('--c-'))
    .filter((v) => !referenced.has(v))
    .sort();
  ok('no palette var is declared and never used', unscoped.length === 0,
    unscoped.join(', '));
}

/* ── the palettes must actually differ where it matters ───── */

/**
 * Relative luminance, so "is this light or dark" is answered properly rather
 * than by string-comparing two hex codes (which happens to work on this
 * palette and would break on the next one).
 */
function luminance(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

console.log('\ninversion');
{
  // If any of these matched across themes the app would be unreadable in one of
  // them — e.g. a canvas that stays near-black under dark text.
  const mustDiffer = [
    '--c-base', '--c-sunken', '--c-raised', '--c-hover', '--c-field',
    '--c-line', '--c-fg-strong', '--c-fg', '--c-fg-muted',
    '--c-invert-bg', '--c-invert-fg', '--c-code-bg',
  ];
  for (const key of mustDiffer) {
    ok(`${key} differs between themes`,
      nightVars.get(key) !== lightVars.get(key),
      `both ${nightVars.get(key)}`);
  }

  // The send button is a light circle at night and a dark one by day.
  ok('the inverted pill is light at night',
    luminance(nightVars.get('--c-invert-bg')) > 0.6,
    nightVars.get('--c-invert-bg'));
  ok('the inverted pill is dark in daylight',
    luminance(lightVars.get('--c-invert-bg')) < 0.1,
    lightVars.get('--c-invert-bg'));
  ok('text on the inverted pill contrasts at night',
    Math.abs(luminance(nightVars.get('--c-invert-bg'))
      - luminance(nightVars.get('--c-invert-fg'))) > 0.6);
  ok('text on the inverted pill contrasts in daylight',
    Math.abs(luminance(lightVars.get('--c-invert-bg'))
      - luminance(lightVars.get('--c-invert-fg'))) > 0.6);

  ok('text on the accent contrasts at night',
    Math.abs(luminance(nightVars.get('--c-accent'))
      - luminance(nightVars.get('--c-on-accent'))) > 0.15,
    `accent ${nightVars.get('--c-accent')} vs ${nightVars.get('--c-on-accent')}`);
  ok('text on the accent contrasts in daylight',
    Math.abs(luminance(lightVars.get('--c-accent'))
      - luminance(lightVars.get('--c-on-accent'))) > 0.15,
    `accent ${lightVars.get('--c-accent')} vs ${lightVars.get('--c-on-accent')}`);

  ok('colour-scheme is dark at night', /color-scheme:\s*dark/.test(night),
    night ? night.slice(0, 60) : 'no block');
  ok('colour-scheme is light in light mode', /color-scheme:\s*light/.test(light),
    light ? light.slice(0, 60) : 'no block');
}

/* ── the elevation ladder has to be visible ───────────────────
   Every one of these surfaces is used as a background *on top of* another, so
   two of them resolving to the same colour is not a style opinion, it is an
   invisible control. The light palette shipped with the sidebar and the hover
   tone both at #f0eee6, which made the active nav item and every row hover
   disappear — nothing but a browser would have shown it. */

console.log('\nelevation ladder');
{
  const surfaces = ['--c-sunken', '--c-base', '--c-raised', '--c-hover'];
  for (const [name, vars] of [['night', nightVars], ['light', lightVars]]) {
    const collisions = [];
    for (let i = 0; i < surfaces.length; i++) {
      for (let j = i + 1; j < surfaces.length; j++) {
        const [a, b] = [surfaces[i], surfaces[j]];
        if (vars.get(a) === vars.get(b)) collisions.push(`${a} == ${b}`);
      }
    }
    ok(`the ${name} surfaces are all distinct`, collisions.length === 0,
      collisions.join(', '));
  }

  // The specific pairing that broke: hover must not merge into the sidebar it
  // sits inside, nor into the canvas the buttons sit on.
  for (const [name, vars] of [['night', nightVars], ['light', lightVars]]) {
    ok(`the ${name} hover tone is visible on the sidebar`,
      vars.get('--c-hover') !== vars.get('--c-sunken'));
    ok(`the ${name} hover tone is visible on the canvas`,
      vars.get('--c-hover') !== vars.get('--c-base'));
  }

  // A field may legitimately match a card *provided* it is outlined, which the
  // components do; but a field that matches the canvas has no boundary at all.
  for (const [name, vars] of [['night', nightVars], ['light', lightVars]]) {
    ok(`the ${name} field is visible on the canvas`,
      vars.get('--c-field') !== vars.get('--c-base'),
      `field and base are both ${vars.get('--c-field')}`);
  }
}

/* ── text has to be readable on its own canvas ────────────────
   A text ramp tuned on charcoal does not automatically work on cream: the
   night palette's tertiary grey landed at 3.3:1 once it was put on cream.
   These assert the ratios directly, so the ramp is held to a standard rather
   than to taste. */

console.log('\ntext contrast');
{
  const contrast = (fg, bg) => {
    const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };

  const floors = [
    ['--c-fg-strong', 10],
    ['--c-fg', 9],
    ['--c-fg-soft', 7],
    ['--c-fg-muted', 4.5],
    // Tertiary labels (timestamps, model ids). Deliberately allowed to be the
    // lightest thing on the page, but still above the 3:1 non-text floor.
    ['--c-fg-faint', 4],
  ];

  for (const [name, vars] of [['night', nightVars], ['light', lightVars]]) {
    for (const [token, floor] of floors) {
      const ratio = contrast(vars.get(token), vars.get('--c-base'));
      ok(`${name} ${token} clears ${floor}:1 on its canvas`,
        ratio >= floor, `${ratio.toFixed(2)}:1`);
    }
  }

  // Status and accent text must clear body-text contrast too.
  for (const [name, vars] of [['night', nightVars], ['light', lightVars]]) {
    for (const token of ['--c-accent', '--c-link', '--c-danger', '--c-success']) {
      const ratio = contrast(vars.get(token), vars.get('--c-base'));
      ok(`${name} ${token} clears 4.5:1 on its canvas`,
        ratio >= 4.5, `${ratio.toFixed(2)}:1`);
    }
  }
}

/* ── decorative hues ──────────────────────────────────────── */

console.log('\ntones');
{
  const tones = [...nightVars.keys()].filter((k) => k.startsWith('--c-tone-'));
  ok('there are six starter-pill tones', tones.length === 6, tones.join(', '));
  const unreadable = tones.filter((t) => nightVars.get(t) === lightVars.get(t));
  ok('every tone is re-tuned for cream', unreadable.length === 0, unreadable.join(', '));

  for (const t of tones) {
    const klass = `.${t.replace('--c-tone-', 'tone-')}`;
    ok(`${klass} is defined`, css.includes(`${klass} {`) || css.includes(`${klass}{`));
  }
}

/* ── the light canvas must be warm, not #fff ──────────────── */

console.log('\naesthetics that are easy to regress');
{
  ok('the light canvas is off-white, not pure white',
    !/^#fff(fff)?$/.test(lightVars.get('--c-base')),
    lightVars.get('--c-base'));
  ok('the light canvas is lighter than the light sidebar',
    luminance(lightVars.get('--c-base')) > luminance(lightVars.get('--c-sunken')),
    `${lightVars.get('--c-base')} vs ${lightVars.get('--c-sunken')}`);
  ok('the night canvas is lighter than the night sidebar',
    luminance(nightVars.get('--c-base')) > luminance(nightVars.get('--c-sunken')),
    `${nightVars.get('--c-base')} vs ${nightVars.get('--c-sunken')}`);
  // Card surfaces sit above the canvas in both themes, in opposite directions.
  ok('the night card is lighter than the night canvas',
    luminance(nightVars.get('--c-raised')) > luminance(nightVars.get('--c-base')));
  ok('the light card is lighter than the light canvas',
    luminance(lightVars.get('--c-raised')) > luminance(lightVars.get('--c-base')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
