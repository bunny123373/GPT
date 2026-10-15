/**
 * Every asset the app references at runtime must live under public/ —
 * Next.js serves nothing else. A file left at the project root is a silent
 * 404 that only shows up as a broken image in the browser.
 *
 *   node test/assets.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const sources = ['app', 'components'].flatMap((dir) => walk(join(root, dir)));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(p)) out.push(p);
  }
  return out;
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

/* ── root-absolute URLs in source ────────────────────────── */
const referenced = new Set();
for (const file of sources) {
  const src = readFileSync(file, 'utf8');
  // src="/..." and url: "/..." and href="/..."
  for (const m of src.matchAll(/["'`]\/(?![\/*])([\w./-]+\.(?:png|svg|jpg|jpeg|webp|ico|webmanifest|json|txt|xml))["'`]/g)) {
    referenced.add(m[1]);
  }
}

console.log(`\nroot-absolute asset URLs : ${referenced.size}`);
for (const url of [...referenced].sort()) {
  if (url.endsWith('.webmanifest')) continue;   // generated from app/manifest.js
  const onDisk = join(root, 'public', url);
  ok(url, existsSync(onDisk), `missing from public/ (${onDisk})`);
}

/* ── icons declared in metadata must exist ───────────────── */
const layout = readFileSync(join(root, 'app', 'layout.js'), 'utf8');
const iconRefs = [...layout.matchAll(/\/[\w./-]+\.(?:png|svg|webmanifest)/g)].map((m) => m[0]);
console.log(`\nicons declared in metadata: ${iconRefs.length}`);
for (const ref of new Set(iconRefs)) {
  // A webmanifest is generated from app/manifest.js; everything else must be a
  // real file under public/.
  if (ref.endsWith('.webmanifest')) {
    ok(ref, existsSync(join(root, 'app', 'manifest.js')) || existsSync(join(root, 'public', ref)),
       'neither app/manifest.js nor public/ provides it');
  } else {
    ok(ref, existsSync(join(root, 'public', ref)), 'missing from public/');
  }
}

/* ── anything asset-like stranded at the project root ───── */
const rootAssets = readdirSync(root).filter((n) => /\.(png|svg|ico|jpg|webp)$/i.test(n));
ok('no image assets stranded at the project root', rootAssets.length === 0, rootAssets.join(', '));

/* Known build/output directories. These legitimately contain images, so the
   "stranded asset folder" check below has to skip them — otherwise adding a
   new build target silently reads as a real problem. */
const IGNORED_DIRS = [
  'public', 'node_modules', '.git', '.next', 'app', 'components', 'lib', 'test',
  '.next-export', 'release', 'android', 'scripts',
];

const strayDirs = readdirSync(root).filter((n) => {
  if (!existsSync(join(root, n)) || !statSync(join(root, n)).isDirectory()) return false;
  if (IGNORED_DIRS.includes(n)) return false;
  const inside = readdirSync(join(root, n)).filter((f) => /\.(png|svg|jpg|jpeg|webp|ico)$/i.test(f));
  return inside.length > 0;
});
ok('no asset folder stranded at the project root', strayDirs.length === 0, strayDirs.join(', '));

/* ── Android resources must actually resolve ───────────────
   AAPT2 fails the whole release build on a dangling @color/@string/@drawable,
   and finding that out costs a multi-minute Gradle run. styles.xml in
   Capacitor's template references three colours that ship no colors.xml at
   all, so this is a real failure, not a hypothetical one. */
console.log('\nandroid resources');
{
  const resRoot = join(root, 'android', 'app', 'src', 'main', 'res');
  if (!existsSync(resRoot)) {
    ok('no Android project yet (run `npm run apk` to create one)', true);
  } else {
    const valuesFiles = readdirSync(join(resRoot, 'values'))
      .filter((f) => f.endsWith('.xml'))
      .map((f) => join(resRoot, 'values', f));

    // Every named resource defined in values/.
    const defined = new Set();
    for (const f of valuesFiles) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<(color|string|style|dimen|integer)\s+name="([^"]+)"/g)) {
        defined.add(m[2]);
      }
    }

    // Files and drawables are referenced by name too.
    const fileRefs = new Set();
    for (const dir of readdirSync(resRoot)) {
      if (!dir.startsWith('drawable') && !dir.startsWith('mipmap')) continue;
      for (const f of readdirSync(join(resRoot, dir))) {
        fileRefs.add(f.replace(/\.(png|xml|webp|jpg)$/i, ''));
      }
    }

    const missing = [];
    for (const f of valuesFiles) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/@(color|string|dimen|drawable|mipmap)\/([\w.]+)/g)) {
        const [, kind, name] = m;
        const known = kind === 'color' || kind === 'string' || kind === 'dimen'
          ? defined.has(name)
          : fileRefs.has(name);
        if (!known) missing.push(`${f.split(/[\\/]/).pop()}: @${kind}/${name}`);
      }
    }

    ok('every @color/@string/@drawable reference resolves',
      missing.length === 0, missing.join(', '));

    // The launcher background is painted behind a white-on-transparent
    // foreground, so a white value renders a blank icon.
    const launcherBg = valuesFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
    const bgMatch = launcherBg.match(/<color\s+name="ic_launcher_background">([^<]+)</);
    ok('the adaptive-icon background is not pure white',
      bgMatch && !/^#fff(fff)?$/i.test(bgMatch[1].trim()),
      bgMatch ? bgMatch[1] : 'not defined');
  }
}

/* ── the Android signing key must never be committable ────
   Not an asset, but the same class of mistake: a file that is fine to have on
   disk and catastrophic to publish. A leaked release key lets anyone ship an
   "update" that Android then refuses to install for real users. */
console.log('\nandroid release key');
{
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
  const ignoresKeystore = /^android\/keystore\/?$/m.test(gitignore);

  ok('.gitignore covers android/keystore/', ignoresKeystore,
    ignoresKeystore ? '' : 'the release signing key would be committable');

  const vercelignorePath = join(root, '.vercelignore');
  if (existsSync(vercelignorePath)) {
    const vi = readFileSync(vercelignorePath, 'utf8');
    ok('.vercelignore excludes the Android project', /^android\s*$/m.test(vi));
  }

  const keystorePath = join(root, 'android', 'keystore');
  if (existsSync(keystorePath)) {
    const keys = readdirSync(keystorePath).filter((f) => /\.(jks|keystore)$/i.test(f));
    ok('no keystore is tracked by git',
      !keys.some((f) => {
        try {
          execFileSync('git', ['ls-files', '--error-unmatch', `android/keystore/${f}`],
            { cwd: root, stdio: 'ignore' });
          return true;
        } catch { return false; }
      }),
      'a key is committed — remove it and rotate the keystore');
  } else {
    ok('no keystore on disk yet (one will be generated on first APK build)', true);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);