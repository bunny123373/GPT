/**
 * Generate the Android launcher icons and splash screens from public/icon.svg.
 *
 * Capacitor ships a generic green placeholder for all of these, so without
 * this the installed app shows the default robot on the home screen while the
 * app itself shows your logo in the sidebar and on the splash — an obvious
 * mismatch the first time you install it.
 *
 * The mark is *not* recoloured here. The logo is still the old Puter green
 * while the UI accent is terracotta; picking one over the other is a branding
 * decision, so this stays faithful to whatever public/icon.svg currently says.
 */

import sharp from 'sharp';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

/** The logo's own contents, without the outer <svg>, so it can be re-wrapped. */
const rect = '<rect width="64" height="64" rx="14" fill="#10a37f"/>';
const sparkle = '<path d="M32 12c1.6 9.6 6.4 14.4 16 16-9.6 1.6-14.4 6.4-16 16-1.6-9.6-6.4-14.4-16-16 9.6-1.6 14.4-6.4 16-16z" fill="#fff"/>';
const dot = '<circle cx="46" cy="46" r="4" fill="#fff"/>';

/**
 * The white mark on transparent, cropped to its own bounds so it can be scaled
 * into an adaptive-icon safe zone without the empty 64x64 viewBox padding
 * shrinking it.
 *
 * The bounds are the sparkle (x 16..48, y 12..44) plus the dot (x 42..50,
 * y 42..50), giving 16,12 -> 50,50.
 */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16 12 34 38">${sparkle}${dot}</svg>`;

/* ── launcher icons ───────────────────────────────────────────
   Legacy launcher PNGs: the whole logo, 48dp at mdpi. */
const LAUNCHER = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

/* Adaptive-icon foregrounds are a 108dp canvas of which only the middle 66dp
   is guaranteed visible — the launcher may crop to any shape. So the mark is
   sized against the canvas, not the other way round, at roughly 60% so it
   survives the most aggressive mask. */
const FOREGROUND = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
];

/** Night canvas, so the splash matches the app's default theme with no flash. */
const SPLASH_BG = { r: 0x1f, g: 0x1e, b: 0x1d, alpha: 1 };

async function writePng(buffer, dir, name) {
  const dest = join(RES, dir, name);
  await mkdir(join(RES, dir), { recursive: true });
  await sharp(buffer).png().toFile(dest);
  return dest;
}

/** The full logo, optionally clipped to a circle (for ic_launcher_round). */
function logoSvg(size, { round = false } = {}) {
  const clip = round
    ? `<defs><clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath></defs><g clip-path="url(#c)">`
    : '<g>';
  const close = round ? '</g>' : '</g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${clip}${rect}${sparkle}${dot}${close}</svg>`;
}

console.log('[icons] legacy launcher icons');
for (const [dir, size] of LAUNCHER) {
  await writePng(Buffer.from(logoSvg(size)), dir, 'ic_launcher.png');
  await writePng(Buffer.from(logoSvg(size, { round: true })), dir, 'ic_launcher_round.png');
  console.log(`  ${dir.padEnd(18)} ${size}x${size}`);
}

console.log('[icons] adaptive foregrounds');
for (const [dir, canvas] of FOREGROUND) {
  const markSize = Math.round(canvas * 0.6);
  const mark = await sharp(Buffer.from(MARK_SVG))
    .resize(markSize, markSize, { fit: 'contain' })
    .png()
    .toBuffer();

  const composed = await sharp({
    create: { width: canvas, height: canvas, channels: 4, background: { ...SPLASH_BG, alpha: 0 } },
  })
    .composite([{ input: mark, top: Math.round((canvas - markSize) / 2), left: Math.round((canvas - markSize) / 2) }])
    .png()
    .toBuffer();

  await writePng(composed, dir, 'ic_launcher_foreground.png');
  console.log(`  ${dir.padEnd(18)} ${canvas}x${canvas} canvas, ${markSize}px mark`);
}

/* ── splash ────────────────────────────────────────────────
   Regenerated at whatever size each existing file already is, so no density
   bucket has to be hardcoded and none of them get resized by mistake. */
console.log('[icons] splash screens');

const splashDirs = (await readdir(RES, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && e.name.startsWith('drawable'))
  .map((e) => e.name);

let count = 0;
for (const dir of splashDirs) {
  const target = join(RES, dir, 'splash.png');
  let dims;
  try {
    const info = await stat(target);
    if (!info.isFile()) continue;
    dims = await sharp(target).metadata();
  } catch {
    continue;   // no splash in this bucket
  }

  const { width, height } = dims;
  if (!width || !height) continue;

  // ~18% of the short edge: present but not a billboard.
  const logoSize = Math.round(Math.min(width, height) * 0.18);
  const logo = await sharp(Buffer.from(logoSvg(logoSize)))
    .png()
    .toBuffer();

  const out = await sharp({ create: { width, height, channels: 4, background: SPLASH_BG } })
    .composite([{ input: logo, top: Math.round((height - logoSize) / 2), left: Math.round((width - logoSize) / 2) }])
    .png()
    .toBuffer();

  await writePng(out, dir, 'splash.png');
  count++;
  console.log(`  ${dir.padEnd(22)} ${width}x${height}`);
}

console.log(`\n[icons] done — ${LAUNCHER.length * 2} launcher, `
  + `${FOREGROUND.length} foreground, ${count} splash\n`);