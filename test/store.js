/**
 * Persistence tests using an in-memory localStorage and no Puter account.
 * Covers the local backend, conversation save/trim, titles and token estimates.
 *
 *   node test/store.js
 */

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${a}\n       want: ${e}`); }
};
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ── in-memory localStorage ─────────────────────────────────
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
delete globalThis.puter; // force the local backend

const { store } = await import('../js/store.js');
const conv = await import('../js/conversations.js');

/* ── backend selection ───────────────────────────────────── */
console.log('\nbackend');
await store.init();
eq('no sdk -> local backend', store.backend, 'local');
eq('isCloud false without sign-in', store.isCloud, false);
eq('signedIn false', store.signedIn, false);

/* ── basic CRUD ──────────────────────────────────────────── */
console.log('\ncrud');
await store.set('a', { n: 1 });
eq('set/get', await store.get('a'), { n: 1 });
eq('missing key is null', await store.get('nope'), null);

await store.update('a', { n: 2 });
eq('update scalar', await store.get('a'), { n: 2 });

await store.update('a', { 'deep.x': 5 });
eq('update dotted path', (await store.get('a')).deep, { x: 5 });
eq('update preserves siblings', (await store.get('a')).n, 2);

await store.update('a', { 'deep.y.z': 'q' });
eq('nested path', (await store.get('a')).deep.y.z, 'q');
eq('nested preserves x', (await store.get('a')).deep.x, 5);

await store.remove('a', 'deep.y.z');
eq('remove path', (await store.get('a')).deep.y, {});

await store.remove('a');
eq('remove whole key', await store.get('a'), null);

await store.update('fresh', { 'x.y': 1 });
eq('update builds missing key', await store.get('fresh'), { x: { y: 1 } });

/* ── namespace isolation ─────────────────────────────────── */
console.log('\nnamespacing');
ok('keys are namespaced', [...mem.keys()].every((k) => k.startsWith('puter-chat:')), [...mem.keys()].join(','));
await store.clearAll();
eq('clearAll wipes everything', mem.size, 0);

/* ── titles ──────────────────────────────────────────────── */
console.log('\ntitles');
eq('title from first user msg',
   conv.deriveTitle({ messages: [{ role: 'user', text: 'How do I center a div?' }] }),
   'How do I center a div?');
eq('title strips markdown',
   conv.deriveTitle({ messages: [{ role: 'user', text: '**bold** question' }] }),
   'bold question');
eq('title truncates long text',
   conv.deriveTitle({ messages: [{ role: 'user', text: 'x'.repeat(80) }] }).length <= 43, true);
eq('title skips assistant first',
   conv.deriveTitle({ messages: [{ role: 'assistant', text: 'hi' }, { role: 'user', text: 'mine' }] }),
   'mine');
eq('no user msg -> New chat', conv.deriveTitle({ messages: [] }), 'New chat');

/* ── sidebar date buckets ────────────────────────────────── */
console.log('\ndate groups');

const NOW = new Date(2026, 9, 14, 15, 30).getTime();   // 14 Oct 2026, local
const daysAgo = (n) => NOW - n * 86400000;
const sameTimeYesterday = new Date(2026, 9, 13, 2, 0).getTime();

eq('today', conv.dateGroup(NOW, NOW), 'Today');
eq('earlier today', conv.dateGroup(new Date(2026, 9, 14, 1, 0).getTime(), NOW), 'Today');
eq('yesterday', conv.dateGroup(sameTimeYesterday, NOW), 'Yesterday');
eq('two days ago', conv.dateGroup(daysAgo(2), NOW), 'Previous 7 days');
eq('six days ago', conv.dateGroup(daysAgo(6), NOW), 'Previous 7 days');
eq('seven days ago falls to 30', conv.dateGroup(daysAgo(7), NOW), 'Previous 30 days');
eq('twenty days ago', conv.dateGroup(daysAgo(20), NOW), 'Previous 30 days');
ok('30+ days falls through to a month',
   conv.dateGroup(daysAgo(40), NOW) === 'September' || conv.dateGroup(daysAgo(40), NOW).includes('September'),
   conv.dateGroup(daysAgo(40), NOW));
ok('a year ago includes the year', conv.dateGroup(daysAgo(400), NOW).includes(String(new Date().getFullYear() - 1)),
   conv.dateGroup(daysAgo(400), NOW));
eq('future timestamps stay in Today', conv.dateGroup(NOW + 5000, NOW), 'Today');
eq('invalid input is handled', conv.dateGroup(NaN, NOW), 'Earlier');

/* ── save / load round trip ──────────────────────────────── */
console.log('\nconversations');
const c = conv.newConversation();
c.messages.push(conv.newMessage('user', 'hello world'));
await conv.save(c);
const all = await conv.listAll();
eq('one conversation stored', all.length, 1);
eq('round-trips the text', all[0].messages[0].text, 'hello world');
eq('title derived on save', all[0].title, 'hello world');
eq('uuid id survives', all[0].id, c.id);

/* ── size ceiling ────────────────────────────────────────── */
console.log('\n400 KB value ceiling');
const big = conv.newConversation();
big.messages.push(conv.newMessage('user', 'short question'));
for (let i = 0; i < 12; i++) {
  big.messages.push(conv.newMessage('assistant', 'A'.repeat(50_000)));
}
await conv.save(big);
const stored = (await conv.listAll()).find((x) => x.id === big.id);
const bytes = Buffer.byteLength(JSON.stringify(stored), 'utf8');
ok('stays under the 400 KB limit', bytes < 400 * 1024, `was ${bytes} bytes`);
eq('flagged as trimmed', stored.trimmed, true);
ok('message count reduced', stored.messages.length < big.messages.length,
   `stored ${stored.messages.length} of ${big.messages.length}`);
ok('newest reply kept', stored.messages.at(-1).text.length === 50_000);

/* ── deletion ────────────────────────────────────────────── */
console.log('\ndeletion');
const doomed = conv.newConversation();
await conv.save(doomed);
eq('three conversations now', (await conv.listAll()).length, 3);
await conv.remove(doomed.id);
eq('delete removes one', (await conv.listAll()).length, 2);

/* ── settings ────────────────────────────────────────────── */
console.log('\nsettings');
eq('defaults', (await conv.loadSettings()).temperature, conv.DEFAULT_SETTINGS.temperature);
await conv.saveSettings({ temperature: 0.1, stream: false });
const s = await conv.loadSettings();
eq('saved override', s.temperature, 0.1);
eq('saved override 2', s.stream, false);
eq('unsaved keys keep defaults', s.showReasoning, conv.DEFAULT_SETTINGS.showReasoning);

/* ── token estimate ──────────────────────────────────────── */
console.log('\nestimate');
eq('empty context', conv.estimateTokens([], ''), 0);
eq('rough 4-chars-per-token', conv.estimateTokens([{ text: 'x'.repeat(400) }], ''), 100);
eq('includes system prompt', conv.estimateTokens([{ text: '' }], 'y'.repeat(40)), 10);

/* ── clearAll ────────────────────────────────────────────── */
console.log('\ncleanup');
await conv.clearAll();
await conv.clearSettings();
eq('no conversations left', (await conv.listAll()).length, 0);
eq('settings reset', (await conv.loadSettings()).temperature, conv.DEFAULT_SETTINGS.temperature);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);