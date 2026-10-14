/**
 * Gallery tests.
 *
 * The gallery reads the drive rather than an index, so the interesting
 * behaviour is all in deciding what counts as media and what to do with the
 * odd shapes the filesystem hands back.
 *
 *   node test/gallery.js
 */

const {
  IMAGE_EXTS, VIDEO_EXTS, GALLERY_DIRS, MAX_ITEMS,
  extOf, classify, toMillis, isDirectory, toItem,
  itemsOf, sortItems, filterItems, counts, formatBytes, listMedia,
} = await import('../lib/gallery.js');

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

/* ── extensions ───────────────────────────────────────────── */

console.log('\nextensions');
eq('lowercases', extOf('Cat.PNG'), 'png');
eq('only the last dot', extOf('my.photo.final.jpg'), 'jpg');
eq('no extension', extOf('README'), '');
eq('dotfile is not an extension', extOf('.gitignore'), '');
eq('strips directories', extOf('puter-chat/1700-cat.png'), 'png');

/* ── classification ───────────────────────────────────────── */

console.log('\nclassification');
eq('png by extension', classify('a.png'), 'image');
eq('mp4 by extension', classify('a.mp4'), 'video');
eq('unknown is not media', classify('notes.txt'), null);
eq('no name, no type', classify(''), null);

console.log('\nmime beats extension');
eq('image mime on a .dat name', classify('blob.dat', 'image/png'), 'image');
eq('video mime on a .dat name', classify('blob.dat', 'video/mp4'), 'video');
eq('generic mime falls back to extension', classify('a.png', 'application/octet-stream'), 'image');
eq('charset is stripped', classify('a.dat', 'image/png; charset=binary'), 'image');
eq('uppercase mime', classify('a.dat', 'IMAGE/PNG'), 'image');
eq('non-media mime falls back', classify('a.mp4', 'application/octet-stream'), 'video');

console.log('\nevery declared extension classifies');
for (const ext of IMAGE_EXTS) eq(`image .${ext}`, classify(`f.${ext}`), 'image');
for (const ext of VIDEO_EXTS) eq(`video .${ext}`, classify(`f.${ext}`), 'video');

/* ── timestamps ───────────────────────────────────────────── */

console.log('\ntimestamps');
eq('seconds become ms', toMillis(1700000000), 1700000000000);
eq('ms pass through', toMillis(1700000000000), 1700000000000);
eq('zero', toMillis(0), 0);
eq('null', toMillis(null), 0);
eq('garbage', toMillis('not a date'), 0);
// The boundary: 1e11 seconds is the year 5138, 1e11 ms is 1973. Anything a
// user could plausibly have generated sits far from this line.
ok('boundary just under is seconds', toMillis(99999999999) === 99999999999000);
ok('boundary just over is ms', toMillis(100000000001) === 100000000001);

/* ── directories ──────────────────────────────────────────── */

console.log('\ndirectories');
ok('isDir true', isDirectory({ isDir: true }));
ok('legacy is_dir true', isDirectory({ is_dir: true }));
ok('file is not a directory', isDirectory({ isDir: false, name: 'a.png' }) === false);
ok('null is treated as a directory', isDirectory(null));

/* ── FSItem normalisation ─────────────────────────────────── */

console.log('\nFSItem -> item');
const png = { id: 'i1', name: '1700000000-cat.png', path: 'puter-chat/1700000000-cat.png', size: 2048, modified: 1700000000, created: 1699999999, isDir: false };
const item = toItem(png);
eq('name', item.name, '1700000000-cat.png');
eq('path', item.path, 'puter-chat/1700000000-cat.png');
eq('kind', item.kind, 'image');
eq('ext', item.ext, 'png');
eq('size', item.size, 2048);
eq('modified normalised to ms', item.modified, 1700000000000);
eq('id from the SDK', item.id, 'i1');

console.log('\nitems the gallery must skip');
eq('directory', toItem({ name: 'sub', isDir: true }), null);
eq('non-media file', toItem({ name: 'notes.txt', path: 'notes.txt' }), null);
eq('no name', toItem({ path: 'x.png' }), null);
eq('null input', toItem(null), null);

console.log('\nprefix filtering');
eq('attachment kept', toItem({ name: 'chat-image-1-a.png', path: '/chat-image-1-a.png' }, { prefix: 'chat-image-' })?.name, 'chat-image-1-a.png');
eq('unrelated root file skipped', toItem({ name: 'tax-return.pdf', path: '/tax-return.pdf' }, { prefix: 'chat-image-' }), null);
eq('a pdf is not media at all, prefix or not', toItem({ name: 'tax-return.pdf', path: '/tax-return.pdf' }), null);
ok('no prefix means no filter', toItem({ name: 'holiday.png', path: '/holiday.png' }) !== null);

console.log('\ndegenerate FSItems');
ok('synthesises an id when the SDK omits one',
   typeof toItem({ name: 'a.png', path: 'a.png', modified: 5 }).id === 'string');
eq('falls back to created when modified is missing',
   toItem({ name: 'a.png', path: 'a.png', created: 1700000000 }).modified, 1700000000000);
eq('zero timestamp when neither is present',
   toItem({ name: 'a.png', path: 'a.png' }).modified, 0);
eq('missing path falls back to the name', toItem({ name: 'a.png' }).path, 'a.png');
eq('missing size becomes 0', toItem({ name: 'a.png' }).size, 0);

/* ── readdir result shapes ────────────────────────────────── */

console.log('\nreaddir result shapes');
eq('plain array', itemsOf([{ name: 'a' }]).length, 1);
eq('page object', itemsOf({ items: [{ name: 'a' }] }).length, 1);
eq('result-wrapped', itemsOf({ result: [{ name: 'a' }] }).length, 1);
eq('null', itemsOf(null), []);
eq('undefined', itemsOf(undefined), []);
eq('wrong shape', itemsOf({ nope: 1 }), []);

/* ── sorting, filtering, counting ─────────────────────────── */

console.log('\nsorting');
const mixed = [
  { name: 'b.png', modified: 200, kind: 'image' },
  { name: 'a.png', modified: 300, kind: 'image' },
  { name: 'c.mp4', modified: 100, kind: 'video' },
];
eq('newest first', sortItems(mixed).map((i) => i.name), ['a.png', 'b.png', 'c.mp4']);
eq('ties break on name, stably',
   sortItems([{ name: 'z', modified: 5 }, { name: 'a', modified: 5 }]).map((i) => i.name), ['a', 'z']);
ok('does not mutate its input', mixed[0].name === 'b.png');
eq('empty', sortItems([]), []);

console.log('\nfiltering');
eq('all', filterItems(mixed, 'all').length, 3);
// Filtering must not reorder — sortItems owns ordering, and the grid sorts
// again after filtering. Reordering here would scramble an already-sorted list.
eq('images, order preserved', filterItems(mixed, 'image').map((i) => i.name), ['b.png', 'a.png']);
eq('videos', filterItems(mixed, 'video').map((i) => i.name), ['c.mp4']);
eq('unknown filter yields nothing', filterItems(mixed, 'audio'), []);
eq('no filter is all', filterItems(mixed), mixed);

console.log('\ncounts');
eq('totals', counts(mixed), { all: 3, image: 2, video: 1 });
eq('empty', counts([]), { all: 0, image: 0, video: 0 });

console.log('\nformatBytes');
eq('bytes', formatBytes(512), '512 B');
eq('one KB', formatBytes(1024), '1.0 KB');
eq('rounds large KB', formatBytes(1024 * 400), '400 KB');
eq('MB', formatBytes(1024 * 1024 * 3.5), '3.5 MB');
eq('GB', formatBytes(1024 ** 3 * 2), '2.0 GB');
eq('zero', formatBytes(0), '0 B');
eq('nonsense', formatBytes(undefined), '0 B');

/* ── scan configuration ───────────────────────────────────── */

console.log('\nscan configuration');
ok('scans the generated-images folder',
   GALLERY_DIRS.some((d) => d.path === 'puter-chat'));
ok('scans the root for attachments',
   GALLERY_DIRS.some((d) => d.path === '/' && d.prefix === 'chat-image-'));
ok('the root scan is prefix-limited, not a full drive walk',
   GALLERY_DIRS.filter((d) => d.prefix === undefined).every((d) => d.path !== '/'));
ok('generated folder is scanned recursively', GALLERY_DIRS.find((d) => d.path === 'puter-chat').recursive === true);
ok('has a runaway cap', MAX_ITEMS > 0 && MAX_ITEMS <= 5000);

/* ── listMedia ────────────────────────────────────────────── */

console.log('\nlistMedia');

// The module reads the global `puter`, so a stub is the only way to drive it.
function withPuter(fake, fn) {
  const had = 'puter' in globalThis;
  globalThis.puter = fake;
  return Promise.resolve(fn()).finally(() => {
    if (had) globalThis.puter = had; else delete globalThis.puter;
  });
}

const listTree = (tree) => async (opts) => {
  const items = tree[opts.path];
  if (!items) throw new Error(`ENOENT: ${opts.path}`);
  return items;
};

await withPuter({ fs: { readdir: listTree({
  'puter-chat': [
    png,
    { id: 'i2', name: 'clip.mp4', path: 'puter-chat/clip.mp4', size: 900000, modified: 1700000500, isDir: false },
    { name: 'notes.txt', path: 'puter-chat/notes.txt', isDir: false },
    { name: 'sub', isDir: true },
  ],
  '/': [
    { id: 'i3', name: 'chat-image-1-a.png', path: 'chat-image-1-a.png', size: 10, modified: 1700000900, isDir: false },
    { name: 'tax-return.pdf', path: 'tax-return.pdf', size: 10, isDir: false },
  ],
}) } }, async () => {
  const res = await listMedia();
  eq('both directories scanned', res.scanned, 2);
  eq('non-media and directories excluded', res.items.map((i) => i.name).sort(),
     ['1700000000-cat.png', 'chat-image-1-a.png', 'clip.mp4']);
  eq('newest first', res.items[0].name, 'chat-image-1-a.png');
  eq('video classified', res.items.find((i) => i.name === 'clip.mp4').kind, 'video');
  eq('no error', res.error, null);
});

console.log('\nlistMedia resilience');
await withPuter({ fs: { readdir: listTree({
  'puter-chat': [png],
  // '/' is missing entirely — the common case before anything is uploaded.
}) } }, async () => {
  const res = await listMedia();
  eq('a missing directory does not blank the gallery', res.items.length, 1);
  eq('only the readable directory is counted', res.scanned, 1);
  eq('a partial failure is not an error, the scan worked', res.error, null);
});

console.log('\nlistMedia reports a total failure');
await withPuter({ fs: { readdir: async () => { throw new Error('permission denied'); } } }, async () => {
  const res = await listMedia();
  eq('nothing scanned', res.scanned, 0);
  eq('empty', res.items, []);
  eq('the reason is reported so the UI can explain it', res.error, 'permission denied');
});

console.log('\nlistMedia survives a directory that throws mid-list');
await withPuter({ fs: { readdir: async ({ path: optsPath }) => {
  if (optsPath === '/') throw new Error('boom');
  return [png];
} } }, async () => {
  const res = await listMedia();
  eq('the good directory still delivers', res.items.length, 1);
  eq('and the failure is not raised as a gallery error', res.error, null);
});

console.log('\nlistMedia without the SDK');
await withPuter(undefined, async () => {
  const res = await listMedia();
  eq('empty, not a throw', res.items, []);
});

await withPuter({}, async () => {
  const res = await listMedia();
  eq('SDK present but no fs', res.items, []);
});

console.log('\nlistMedia caps runaway results');
await withPuter({ fs: { readdir: async () => Array.from({ length: 50 }, (_, i) => ({
  id: `i${i}`, name: `f${String(i).padStart(3, '0')}.png`, path: `f${i}.png`, modified: 1000 + i, isDir: false,
})) } }, async () => {
  const res = await listMedia({ max: 10 });
  eq('truncated to the cap', res.items.length, 10);
  eq('keeps the newest', res.items[0].name, 'f049.png');
});

console.log('\nlistMedia dedupes by path');
await withPuter({ fs: { readdir: async () => [png] } }, async () => {
  const res = await listMedia();
  eq('the same file seen once is one item', res.items.length, 1);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
