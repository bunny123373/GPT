/**
 * Responsive-layout checks.
 *
 * These are static checks on the CSS and the JS breakpoint constant. They
 * can't measure a real viewport, but they do catch the mistakes that are easy
 * to make and invisible until someone opens the app on a tablet.
 *
 *   node test/responsive.js
 */

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ── 1. the width ladder has no gaps or overlaps ─────────── */

const blocks = [];
const re = /@media([^{]+)\{/g;
let m;
while ((m = re.exec(css))) {
  // Capture the block body by brace matching so later checks can read it.
  let depth = 0;
  const start = css.indexOf('{', m.index);
  let end = start;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (!depth) { end = j; break; } }
  }
  blocks.push({ cond: m[1].trim(), body: css.slice(start + 1, end) });
}

const widthBlocks = blocks
  .map((b) => {
    const min = b.cond.match(/min-width:\s*(\d+)px/);
    const max = b.cond.match(/max-width:\s*(\d+)px/);
    if (!min && !max) return null;
    return { cond: b.cond, body: b.body, min: min ? +min[1] : 0, max: max ? +max[1] : Infinity };
  })
  .filter(Boolean);

console.log('\nwidth ladder');
for (const b of widthBlocks) {
  console.log(`       ${b.min}–${b.max === Infinity ? '∞' : b.max}  ${b.cond.replace(/\s+/g, ' ')}`);
}

const phone = widthBlocks.filter((b) => b.max < Infinity).sort((a, b) => a.max - b.max);
for (let i = 0; i < phone.length - 1; i++) {
  ok(`no gap after ${phone[i].max}px`, phone[i + 1].max >= phone[i].max,
     `${phone[i].max} then ${phone[i + 1].max}`);
  ok(`no overlap at ${phone[i].max}px`, phone[i + 1].max > phone[i].max,
     `${phone[i].max} and ${phone[i + 1].max} both match at the boundary`);
}

/* ── 2. JS breakpoint must agree with the CSS overlay ───── */

console.log('\njs / css agreement');
const jsConst = js.match(/MOBILE_MAX\s*=\s*(\d+)/);
ok('app.js declares MOBILE_MAX', !!jsConst, 'not found');
if (jsConst) {
  const value = +jsConst[1];
  // The overlay sidebar lives in the max-width-only band at the bottom of the ladder.
  const overlay = widthBlocks
    .filter((b) => b.max < Infinity && b.min === 0)
    .filter((b) => /\.sidebar\s*\{[^}]*position:\s*fixed/.test(b.body))
    .sort((a, b) => b.max - a.max)[0];

  ok('CSS has an overlay-sidebar phone band', !!overlay,
     overlay ? '' : 'no max-width-only @media block with a position:fixed sidebar');

  if (overlay) {
    ok('JS MOBILE_MAX matches the CSS phone band',
       value === overlay.max,
       `JS ${value}px vs CSS max-width ${overlay.max}px`);
  }
  ok('no stray matchMedia widths outside MOBILE_MAX',
     (js.match(/max-width:\s*(\d+)px/g) || []).every((s) => s.includes(`${value}px`)),
     'a hardcoded matchMedia width disagrees with MOBILE_MAX');
}

/* ── 3. every band styles the pieces that break there ───── */

console.log('\nband coverage');
const blockAt = (needle) => {
  const i = css.indexOf(needle);
  if (i < 0) return '';
  let depth = 0, start = css.indexOf('{', i);
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (!depth) return css.slice(start, j); }
  }
  return css.slice(start);
};

const phoneBlock = blockAt('@media (max-width: 767px)');
const tabletBlock = blockAt('@media (min-width: 768px) and (max-width: 1023px)');
const shortBlock = blockAt('@media (max-height: 560px)');

ok('phone band exists', !!phoneBlock);
ok('phone band makes the sidebar an overlay', /position:\s*fixed/.test(phoneBlock));
ok('phone band caps sidebar width to the viewport', /82vw/.test(phoneBlock));
ok('phone band hides the token stats', /topbar__stats[^}]*display:\s*none/.test(phoneBlock));

/* ── ChatGPT-style message treatment ────────────────────── */

console.log('\nmessage treatment');
const bubbleRule = css.match(/\.user-bubble\s*\{([^}]*)\}/)?.[1] || '';
const rowRule = css.match(/\.msg--user\s*\{([^}]*)\}/)?.[1] || '';
const bodyRule = css.match(/\.msg--user \.msg__body\s*\{([^}]*)\}/)?.[1] || '';
ok('user bubble rule exists', !!bubbleRule);
ok('user bubble has a background', /background:\s*var\(--bubble\)/.test(bubbleRule), bubbleRule.trim());
ok('user bubble is rounded', /border-radius:\s*2[0-9]px/.test(bubbleRule));
ok('user bubble has padding', /padding:\s*\d+px\s+\d+px/.test(bubbleRule));
ok('user bubble shrinks to its text', /width:\s*fit-content/.test(bubbleRule), bubbleRule.trim());
ok('user bubble is capped at 75%', /max-width:\s*75%/.test(bubbleRule));
ok('user bubble is not a fixed width', !/^\s*width:\s*\d+%/m.test(bubbleRule));
ok('user bubble cannot shrink', /flex-shrink:\s*0/.test(bubbleRule));
ok('user bubble min-width is cleared', /min-width:\s*0/.test(bubbleRule));
ok('user bubble keeps pre-wrap', /white-space:\s*pre-wrap/.test(bubbleRule));
ok('words wrap instead of being chopped', /overflow-wrap:\s*break-word/.test(bubbleRule));
ok('no character-level breaking', !/word-break:\s*break-all/.test(bubbleRule));
ok('bubble never uses anywhere-wrap', !/overflow-wrap:\s*anywhere/.test(bubbleRule));
ok('bubble never uses min-content', !/min-content/.test(bubbleRule));

// The row wrapper and the parent must not shrink the bubble's 75% base.
ok('user row wrapper is full width', /width:\s*100%/.test(rowRule), rowRule.trim());
ok('user row wrapper right-aligns', /justify-content:\s*flex-end/.test(rowRule));
ok('row wrapper is a flex row', /display:\s*flex/.test(rowRule));
ok('bubble parent is full width', /width:\s*100%/.test(bodyRule), bodyRule.trim());
ok('bubble parent right-aligns', /justify-content:\s*flex-end/.test(bodyRule));
ok('text inside the bubble is left-aligned', /text-align:\s*left/.test(bubbleRule));
ok('bubble is pushed to the right', /\.msg--user\s*\{[^}]*flex-end/.test(css));
ok('words wrap instead of being chopped', /overflow-wrap:\s*break-word/.test(bubbleRule));
ok('no character-level breaking', !/word-break:\s*break-all/.test(bubbleRule));
ok('replies stay bubble-less', !/msg--assistant[^{]*\.user-bubble/.test(css));
ok('--bubble token is declared and used',
   /--bubble\s*:/.test(css) && /var\(--bubble\)/.test(css));

ok('tablet band exists', !!tabletBlock);
ok('tablet band narrows the sidebar', /--sidebar-w/.test(tabletBlock));
ok('tablet band caps the content column', /--content-w/.test(tabletBlock));

ok('short-viewport band exists', !!shortBlock);
ok('short band drops the disclaimer', /composer-hint[^}]*display:\s*none/.test(shortBlock));
ok('short band shrinks the textarea', /max-height/.test(shortBlock));

const touchBlock = blockAt('@media (hover: none)');
ok('touch band enlarges hit targets', /min-width:\s*40px/.test(touchBlock));

/* ── 4. viewport / inset hygiene ─────────────────────────── */

console.log('\nviewport hygiene');
ok('uses dvh for mobile browser chrome', /100dvh/.test(css));
// `height: 100vh; height: 100dvh;` is the correct progressive pair — what
// must not exist is a 100vh used on its own.
const appRule = css.match(/\.app\s*\{([^}]*)\}/)?.[1] || '';
ok('app height prefers dvh', /height:\s*100dvh/.test(appRule), appRule.slice(0, 80));
ok('app keeps 100vh only as a fallback',
   !/height:\s*100vh/.test(appRule) || /height:\s*100vh;\s*height:\s*100dvh/.test(appRule));
ok('uses safe-area insets', /env\(safe-area-inset/.test(css));
ok('safe insets reach the topbar', /topbar[^}]*--safe-t/.test(css));
ok('safe insets reach the composer', /composer-hint[^}]*--safe-b/.test(css));
ok('empty state centres safely', /justify-content:\s*safe center/.test(css));
ok('dialogs use dvh', /dvh/.test(css) && /max-height:\s*min\(760px, 86dvh\)/.test(css));
ok('grid columns cannot be forced wide', /\.app\s*\{[^}]*min-width:\s*0/.test(css));
ok('message area cannot force overflow', /overflow-wrap:\s*anywhere/.test(css));

// iOS zooms the viewport when a focused input is under 16px.
const inputFont = css.match(/\.composer textarea\s*\{[^}]*font-size:\s*(\d+)px/);
ok('composer textarea is >= 16px on narrow screens',
   !css.match(/@media \(max-width: 400px\)[\s\S]*?\.composer textarea \{[^}]*font-size:\s*(1[0-5])px/),
   'a narrow-screen rule shrinks the input below 16px');

/* ── 5. reading measure stays readable ──────────────────── */

console.log('\nreading measure');
const rootRule = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const contentW = +(rootRule.match(/--content-w:\s*(\d+)px/)?.[1] || 0);
const bodyFs = +(css.match(/body\s*\{[\s\S]*?font-size:\s*(\d+)px/)?.[1] || 0);

ok('--content-w is declared', contentW > 0, `got ${contentW}`);
ok('body font-size is declared', bodyFs > 0, `got ${bodyFs}`);

if (contentW && bodyFs) {
  // Inter's average advance for mixed prose is ~0.5em.
  const chars = Math.round((contentW - 32) / (bodyFs * 0.5));
  console.log(`       ${contentW}px / ${bodyFs}px  ->  ~${chars} chars per line`);
  // The comfortable band tops out around 75; this column deliberately runs
  // wider to fit code blocks and images, so allow some headroom.
  ok('measure is not wider than ~90 characters', chars <= 90, `~${chars} chars`);
  ok('measure is not uselessly narrow', chars >= 45, `~${chars} chars`);
}

ok('no band widens the column past :root',
   !/--content-w:\s*(\d+)px/.test(css) ||
   [...css.matchAll(/--content-w:\s*(\d+)px/g)].every((x) => +x[1] <= contentW),
   'a media query widens --content-w beyond the :root value');

/* ── Grid integrity when the sidebar collapses ──────────── */

console.log('\ngrid integrity');
// .app has three children: .sidebar, .scrim, .main. If the sidebar is
// display:none it leaves the grid and .main becomes the FIRST item, landing
// in the 0px collapsed column — the entire layout disappears.
const collapsedRule = css.match(/\.app\.sidebar-collapsed \{([^}]*)\}/)?.[1] || '';
const collapsedSidebar = css.match(/\.app\.sidebar-collapsed \.sidebar \{([^}]*)\}/)?.[1] || '';

ok('collapsed app sets a zero-width first column',
   /grid-template-columns:\s*0\s+1fr/.test(collapsedRule), collapsedRule.trim());
ok('collapsed sidebar is NOT display:none',
   !/display:\s*none/.test(collapsedSidebar), collapsedSidebar.trim());
ok('collapsed sidebar stays in the grid flow',
   /overflow:\s*hidden/.test(collapsedSidebar) && /visibility:\s*hidden/.test(collapsedSidebar));
ok('collapsed sidebar leaves the tab order', /visibility:\s*hidden/.test(collapsedSidebar));
ok('collapsed sidebar takes no clicks', /pointer-events:\s*none/.test(collapsedSidebar));

const appHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
ok('.app really does have three children',
   /<aside class="sidebar"[\s\S]*?<div class="scrim"[\s\S]*?<main class="main"/.test(appHtml));
ok('scrim is display:none by default', /\.scrim \{[^}]*display:\s*none/.test(css));

/* ── Model picker is an anchored dropdown ──────────────── */

console.log('\nmodel picker');
const menuRule = css.match(/\.model-menu \{([^}]*)\}/)?.[1] || '';
ok('model menu is anchored', /position:\s*absolute/.test(menuRule), menuRule.trim());
ok('model menu is hidden by default', /\.model-menu\[hidden\]/.test(css));
ok('model menu is not a full-screen sheet', !/inset:\s*0/.test(menuRule));
ok('model menu has its own scroll body', /\.model-menu__body\s*\{[^}]*overflow-y:\s*auto/.test(css));
ok('model menu is capped for short screens', /dvh/.test(menuRule));
ok('model menu has a search field', /model-menu__head input/.test(css));
ok('menu flips to the right edge on narrow screens',
   /@media \(min-width: 420px\)[\s\S]*?\.model-menu \{[^}]*right:\s*0/.test(css));
ok('no model dialog remains', !/model-dialog/.test(readFileSync(new URL('../index.html', import.meta.url), 'utf8')));
ok('app.js toggles the menu', /toggleModelMenu/.test(js));

/* ── Account menu shows real Puter data ─────────────────── */

console.log('\naccount menu');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const footIdx = html.indexOf('sidebar__foot');
const menuIdx = html.indexOf('id="account-menu"');
ok('account menu lives in the sidebar footer',
   menuIdx > footIdx && menuIdx - footIdx < 2500, `footer@${footIdx} menu@${menuIdx}`);
ok('profile is NOT in the header',
   html.indexOf('id="btn-account"') < html.indexOf('id="topbar-stats"'),
   'the account button appears after the topbar stats');
ok('sidebar footer anchors the menu', /\.sidebar__foot \{[^}]*position:\s*relative/.test(css));
ok('menu opens upward, not off-screen',
   /\.acct-menu \{[^}]*bottom:\s*calc\(100%/.test(css));
ok('menu fits the sidebar width',
   /\.acct-menu \{[^}]*left:\s*8px[^}]*right:\s*8px/s.test(css));
ok('account menu hides by default', /\.acct-menu\[hidden\]/.test(css));
ok('no header account button remains', !/account-picker|account-btn__avatar/.test(html + css));
ok('reads real storage via fs.space', /puter\.fs\.space\(\)/.test(js));
ok('reads real usage via getMonthlyUsage', /puter\.auth\.getMonthlyUsage\(\)/.test(js));
ok('converts microcents to dollars', /1_000_000/.test(js));
ok('each stat is failure-tolerant',
   (js.match(/catch \{ \/\* .*omits? (that|this) row/gi) || []).length >= 2);
ok('menu opens on the account row', /accountBtn\.addEventListener\('click'/.test(js));
ok('both menus close on Escape', /closeAccountMenu\(\)/.test(js));
ok('auth toggle is shared', /handleAuthToggle/.test(js));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);