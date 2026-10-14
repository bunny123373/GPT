/**
 * Offline sanity checks for the pure modules (no browser, no Puter needed).
 *   node test/run.js
 */

import { renderMarkdown, toPlainText } from '../js/markdown.js';

let pass = 0, fail = 0;

function check(name, actual, expectedSubstring) {
  const ok = typeof actual === 'string' && actual.includes(expectedSubstring);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got: ${actual}\n       want substring: ${expectedSubstring}`); }
}

function refute(name, actual, forbidden) {
  const ok = typeof actual === 'string' && !actual.includes(forbidden);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — output contained: ${forbidden}`); }
}

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${a}\n       want: ${b}`); }
}

console.log('\nmarkdown');

check('bold',            renderMarkdown('**hi**'), '<strong>hi</strong>');
check('italic',          renderMarkdown('a *b* c'), '<em>b</em>');
check('inline code',     renderMarkdown('use `x`'), '<code>x</code>');
check('heading',         renderMarkdown('# Title'), '<h1>Title</h1>');
check('unordered list',  renderMarkdown('- a\n- b'), '<li>a</li>');
check('ordered list',    renderMarkdown('1. a\n2. b'), '<ol><li>a</li>');
check('blockquote',      renderMarkdown('> quoted'), '<blockquote>');
check('fenced code',     renderMarkdown('```js\nconst a = 1;\n```'), '<div class="codeblock">');
check('fenced code lang',renderMarkdown('```py\nx\n```'), '<span>py</span>');
check('unclosed fence',  renderMarkdown('```js\nconst a = 1;'), 'const a = 1;');
check('table',           renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), '<table>');
check('hr',              renderMarkdown('---'), '<hr>');
check('link',            renderMarkdown('[docs](https://example.com)'), 'href="https://example.com"');
check('image',           renderMarkdown('![alt](https://x.test/a.png)'), '<img class="md-img"');
check('strike',          renderMarkdown('~~gone~~'), '<del>gone</del>');

// ── Security: model output is untrusted input ──
refute('escapes <script>',   renderMarkdown('<script>alert(1)</script>'), '<script>');
check('escapes as text',     renderMarkdown('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
refute('no live img tag',    renderMarkdown('<img src=x onerror=alert(1)>'), '<img');
refute('blocks js: url',     renderMarkdown('[x](javascript:alert(1))'), 'javascript:');
refute('blocks code in link', renderMarkdown('`<script>x</script>`'), '<script>');
refute('blocks data:text',   renderMarkdown('[x](data:text/html,<script>alert(1)</script>)'), '<script>');
refute('blocks quote break', renderMarkdown('![x](https://a.test/"onerror="alert(1))'), 'onerror="alert');
check('allows data:image',    renderMarkdown('![x](data:image/png;base64,AAA)'), 'data:image/png');
check('allows https',        renderMarkdown('[x](https://ok.test)'), 'https://ok.test');
check('autolink',            renderMarkdown('see https://ok.test/x'), '<a href="https://ok.test/x"');

check('plain text title', toPlainText('# Hi\nthere **friend**'), 'Hi there friend');
check('plain text strips code', toPlainText('a ```js\ncode\n``` b'), '[code]');

/* ── toApiMessages ─────────────────────────────────────── */
console.log('\nmessages');
const { toApiMessages } = await import('../js/ai.js');

const api = toApiMessages(
  [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'hi' },
    { role: 'user', text: 'look', attachments: [{ name: 'a.png', path: '/a.png' }] },
    { role: 'user', text: 'guest img', attachments: [{ name: 'b.png', dataUrl: 'data:image/png;base64,AAA' }] },
    { role: 'user', text: 'skip me', deleted: true },
  ],
  'SYSTEM'
);

check('system first',      JSON.stringify(api[0]), '"role":"system"');
check('system content',    api[0].content, 'SYSTEM');
check('user text',         api[1].content, 'hello');
check('assistant kept',    api[2].role, 'assistant');
check('file part',         JSON.stringify(api[3].content), '"type":"file"');
check('puter_path',        JSON.stringify(api[3].content), '"puter_path":"/a.png"');
check('inline image part', JSON.stringify(api[4].content), '"type":"image_url"');
refute('deleted skipped',   JSON.stringify(api), 'skip me');
check('five messages',      String(api.length), '5');
refute('no system when blank', JSON.stringify(toApiMessages([{ role: 'user', text: 'x' }], '  ')), 'system');

/* ── price formatting ──────────────────────────────────── */
console.log('\npricing');
const { formatPrice } = await import('../js/ai.js');
check('cents to dollars', formatPrice({ currency: 'usd-cents', input: 500, output: 2500 }), '$5.00 in / $25.00 out');
check('cheap model',      formatPrice({ input: 1, output: 2 }), '$0.01 in / $0.02 out');
check('free',             formatPrice({ input: 0, output: 0 }), 'free');
check('missing cost',     formatPrice(undefined), '');

/* ── error messages ────────────────────────────────────── */
console.log('\nerrors');
const { describeError, asText } = await import('../js/ai.js');
check('abort',        describeError({ name: 'AbortError', message: 'aborted' }), 'Stopped.');
check('network',      describeError({ message: 'x', code: 'network_error' }), 'Network error');
check('timeout',      describeError({ message: 'x', code: 'request_timeout' }), 'too long');
check('rate limit',   describeError({ message: '429 rate limit exceeded' }), 'Rate limit');
check('passes through', describeError(new Error('something odd')), 'something odd');

/* ── "[object Object]" must never reach the UI ──────────── */
// Puter rejects with plain objects, so blind String(err) used to leak
// the literal text "[object Object]" into toasts and the error banner.
console.log('\nno [object Object]');

const hostile = [
  ['plain object',            { code: 'oops' }],
  ['nested error object',     { error: { message: 'inner boom', code: 'bad' } }],
  ['error as bare string',    { error: 'string reason' }],
  ['reason field',            { reason: 'because' }],
  ['detail field',            { detail: 'details here' }],
  ['statusText (Response)',   { status: 500, statusText: 'Internal Server Error' }],
  ['empty object',            {}],
  ['array rejection',         ['a', 'b']],
  ['nested 3 deep',           { error: { error: { message: 'deep down' } } }],
  ['message is an object',    { message: { text: 'weird' } }],
  ['null',                    null],
  ['undefined',               undefined],
  ['number',                  42],
  ['boolean',                 false],
  ['raw string',              'just a string'],
  ['Date object',             new Date(0)],
  ['Map',                     new Map([['k', 'v']])],
  ['circular',                (() => { const o = { code: 'loop' }; o.self = o; return o; })()],
];

for (const [label, value] of hostile) {
  const d = describeError(value);
  ok(`describeError: ${label}`, typeof d === 'string' && d.length > 0 && !d.includes('[object Object]'), `-> ${d}`);
}

for (const [label, value] of hostile) {
  const t = asText(value);
  ok(`asText: ${label}`, typeof t === 'string' && !t.includes('[object Object]'), `-> ${t}`);
}

eq('asText prefers message',  asText({ message: 'msg', error: 'err' }), 'msg');
eq('asText digs into error',  asText({ error: { message: 'inner boom' } }), 'inner boom');
eq('asText digs 3 levels',    asText({ error: { error: { message: 'deep down' } } }), 'deep down');
eq('asText uses statusText',  asText({ status: 500, statusText: 'Server Error' }), 'Server Error');
eq('asText falls back to JSON', asText({ code: 'oops' }), '{"code":"oops"}');
eq('asText keeps strings',    asText('  hi  '), 'hi');
eq('asText handles numbers',  asText(42), '42');
eq('asText empty object',     asText({}), 'Something went wrong.');
eq('asText explicit fallback', asText(null, 'nope'), 'nope');

// Errors raised mid-stream carry a code that should still surface.
check('code appended', describeError({ code: 'weird_code', message: 'boom' }), 'boom (weird_code)');
eq('code not repeated when already shown', describeError({ code: 'weird_code' }), '{"code":"weird_code"}');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);