/**
 * Gallery — reads the user's media back out of their Puter drive.
 *
 * The app deliberately keeps no media index of its own. Generated images are
 * written by `imageOutputPath()` to `puter-chat/`, and attachments uploaded
 * from the composer land at the app root as `chat-image-*`. So the drive *is*
 * the catalogue. Two consequences shape this file:
 *
 *  - We scan a small fixed set of directories rather than the whole drive.
 *    Walking everything would be slow and would surface unrelated private
 *    files in a grid the user did not ask to publish on screen.
 *  - A directory that doesn't exist yet — a guest, or an account where nobody
 *    has generated an image — is the normal case, not a failure. Missing
 *    directories are skipped silently; only a real error is reported.
 *
 * Videos are classified and rendered even though the app cannot generate them.
 * Users keep their own media in these folders, and a gallery that silently
 * hides half of what is in the folder is worse than one that shows it.
 */

import { asText } from './ai.js';

export const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg', 'heic', 'heif', 'ico', 'tif', 'tiff',
]);

export const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv', 'mpeg', 'mpg', '3gp',
]);

/**
 * Where media is looked for. `prefix` restricts a directory to names starting
 * with that string, so scanning the app root for attachments doesn't sweep up
 * every unrelated file the user has put there.
 */
export const GALLERY_DIRS = [
  { path: 'puter-chat', recursive: true, depth: 3 },
  { path: '/', prefix: 'chat-image-' },
];

/** Upper bound on what one scan will materialise, as a runaway guard. */
export const MAX_ITEMS = 600;

/** Lowercase extension without the dot. Files with no dot have none. */
export function extOf(name = '') {
  const base = String(name).split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  // A leading dot means a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * 'image' | 'video' | null.
 *
 * A recognised MIME type wins over the extension: it is what the provider
 * actually stored the bytes as. Unhelpful types (application/octet-stream,
 * which is what a lot of uploads come back as) fall through to the extension.
 */
export function classify(name = '', mime = '') {
  const type = String(mime || '').toLowerCase().split(';')[0].trim();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';

  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

/**
 * Normalise an SDK timestamp to milliseconds.
 *
 * The SDK has shipped both seconds and milliseconds for `created`/`modified`,
 * and they sit on either side of 1e11 for any plausible date. Getting this
 * wrong by 1000x is invisible in a sort but glaring in a "modified" label.
 */
export function toMillis(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n;
}

/** Directories come back as `isDir` (current SDK) or `is_dir` (legacy). */
export function isDirectory(item) {
  if (!item) return true;
  return item.isDir === true || item.is_dir === true;
}

/**
 * FSItem -> gallery item, or null when the entry isn't media this gallery
 * should show. Directories and non-media files are filtered here rather than
 * at render time, so the filter counts and the grid always agree.
 */
export function toItem(raw, { prefix = '' } = {}) {
  if (!raw || isDirectory(raw)) return null;

  const name = asText(raw.name, '');
  if (!name) return null;
  if (prefix && !name.startsWith(prefix)) return null;

  const kind = classify(name, raw.type || raw.mime || '');
  if (!kind) return null;

  const path = asText(raw.path, '') || name;
  const modified = toMillis(raw.modified);
  const created = toMillis(raw.created);

  return {
    id: asText(raw.id, '') || `${path}:${modified || created}`,
    name,
    path,
    kind,
    ext: extOf(name),
    size: Number(raw.size) || 0,
    // Fall back through created → 0 so a file missing both still sorts
    // last rather than jumping to the top on a zero timestamp.
    modified: modified || created || 0,
  };
}

/** readdir resolves to a plain array, or to a page object when paginating. */
export function itemsOf(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.result)) return result.result;
  return [];
}

/** Newest first. Ties break on name so the order is stable across reloads. */
export function sortItems(items = []) {
  return [...items].sort(
    (a, b) => (b.modified - a.modified) || a.name.localeCompare(b.name),
  );
}

/** `kind` of 'all', 'image' or 'video'. Unknown kinds filter to nothing. */
export function filterItems(items = [], kind = 'all') {
  if (!kind || kind === 'all') return items;
  return items.filter((i) => i.kind === kind);
}

/** Tab counts. `all` is the total, so the tabs can show a real number. */
export function counts(items = []) {
  const out = { all: items.length, image: 0, video: 0 };
  for (const i of items) if (i.kind in out) out[i.kind]++;
  return out;
}

export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * List everything the gallery can show.
 *
 * Scans every configured directory and resolves even when some of them fail —
 * one unreadable folder shouldn't blank the whole gallery. Callers should
 * check auth before calling: a signed-out session can't read a drive at all,
 * and that deserves a sign-in prompt rather than an empty-state error.
 */
export async function listMedia({ dirs = GALLERY_DIRS, max = MAX_ITEMS } = {}) {
  if (typeof puter === 'undefined' || !puter?.fs?.readdir) {
    return { items: [], scanned: 0, error: null };
  }

  const results = await Promise.allSettled(
    dirs.map((d) => puter.fs.readdir({ path: d.path, recursive: !!d.recursive, depth: d.depth })),
  );

  const items = [];
  const seen = new Set();
  let scanned = 0;
  let lastFailure = null;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      // A directory that doesn't exist is the normal case for a new account.
      // Keep the reason in case nothing at all turns out to be readable.
      lastFailure ||= asText(r.reason, '');
      continue;
    }
    scanned++;
    for (const raw of itemsOf(r.value)) {
      const item = toItem(raw, { prefix: dirs[i].prefix });
      if (!item || seen.has(item.path)) continue;
      seen.add(item.path);
      items.push(item);
    }
  }

  /* Only report a failure when we couldn't read ANY directory. A partial
     failure — say the root scan trips over an unrelated permission error while
     `puter-chat/` lists fine — has already produced a usable gallery, and
     showing an error banner over it would be noise. */
  return {
    /* Sort BEFORE trimming. Trimming first keeps whatever readdir happened to
       return first, which with a full drive means a random slice of the oldest
       images and nothing from yesterday. */
    items: sortItems(items).slice(0, max),
    scanned,
    error: scanned === 0 ? lastFailure : null,
  };
}
