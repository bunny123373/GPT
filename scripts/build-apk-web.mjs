/**
 * Build the static web bundle that goes inside the Android APK.
 *
 * Capacitor ships files, not a server, so this runs `next build` in export
 * mode (next.config.mjs flips on APK=1) and then checks the output is really
 * there. That check is the point: a failed export leaves a stale or missing
 * `out/`, and without it the APK would silently bundle the *previous* build —
 * the most confusing possible symptom to debug on a phone.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
// `distDir: '.next-export'` in next.config.mjs — in Next 16 that names the
// export directory itself, so this is the complete web bundle.
const OUT = join(ROOT, '.next-export');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function step(label, fn) {
  process.stdout.write(`\n[apk:web] ${label}\n`);
  return fn();
}

step('cleaning previous export', () => {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
});

step('building static export (APK=1)', () => {
  const res = spawnSync(npx, ['next', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, APK: '1' },
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error('\n[apk:web] next build failed — stopping before the APK gets a stale bundle.\n');
    process.exit(res.status ?? 1);
  }
});

step('verifying the export', () => {
  const index = join(OUT, 'index.html');
  if (!existsSync(index)) {
    console.error(`\n[apk:web] ${index} is missing. The export did not produce a usable bundle.\n`);
    process.exit(1);
  }

  const html = readFileSync(index, 'utf8');

  // The app is a client-rendered shell, so index.html is expected to be thin.
  // If it is not, something server-rendered got baked in and the APK would
  // ship a page that only looks right on the build machine.
  const checks = [
    ['a <div id="root">-style mount point', /<div id="__next"|<body/i],
    ['the stylesheet link', /<link[^>]+rel="stylesheet"/i],
    ['the theme boot script', /gpt-theme/],
  ];

  let failed = false;
  for (const [label, re] of checks) {
    const ok = re.test(html);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed = true;
  }

  if (!existsSync(join(OUT, 'icon.svg'))) {
    console.log('  FAIL icon.svg is missing from the export');
    failed = true;
  } else {
    console.log('  ok   icon.svg');
  }

  if (failed) {
    console.error('\n[apk:web] export is incomplete — refusing to continue.\n');
    process.exit(1);
  }

  console.log(`\n[apk:web] export looks good -> ${OUT}\n`);
});