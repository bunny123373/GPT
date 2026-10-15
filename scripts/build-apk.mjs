/**
 * Build the signed Android APK end to end.
 *
 *   npm run apk
 *
 * Steps, each of which fails loudly rather than producing a subtly wrong app:
 *
 *   1. static web export      — Capacitor ships files, not a server
 *   2. cap sync               — copy that export into the Android project
 *   3. launcher icons         — Capacitor's placeholders replaced with the logo
 *   4. gradle assembleRelease — signed APK
 *
 * The keystore is generated on first run and then never touched: regenerating
 * it would change the app's signing identity, and Android refuses to update an
 * installed app signed under a different key.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ANDROID = join(ROOT, 'android');
const KEYSTORE = join(ANDROID, 'keystore', 'gpt-release.jks');
const OUT_DIR = join(ROOT, 'release');

const GRADLE_VERSION = '8.14.3';
const isWin = process.platform === 'win32';

function heading(text) {
  process.stdout.write(`\n\x1b[1m[apk] ${text}\x1b[0m\n`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin,
    ...opts,
  });
  if (res.status !== 0) {
    console.error(`\n[apk] FAILED: ${cmd} ${args.join(' ')}\n`);
    process.exit(res.status ?? 1);
  }
}

heading('1/4  static web export');
run(process.execPath, [join('scripts', 'build-apk-web.mjs')]);

heading('2/4  syncing into the Android project');
run('npx', ['cap', 'sync', 'android']);

heading('3/4  launcher icons and splash');
run(process.execPath, [join('scripts', 'make-android-icons.mjs')]);

heading('4/4  release build');

if (!existsSync(KEYSTORE)) {
  console.log('[apk] no keystore yet, generating one…');
  run(process.execPath, [join('scripts', 'make-keystore.mjs')]);
}

/* Prefer the locally fetched Gradle over the wrapper.
   gradlew downloads the distribution with no resume and no retry, which fails
   from this network; scripts/fetch-gradle.ps1 gets it reliably. Falls back to
   the wrapper if the local copy is somehow missing. */
const localGradle = join(
  process.env.USERPROFILE || '',
  '.gradle-dists', `gradle-${GRADLE_VERSION}`, 'bin',
  isWin ? 'gradle.bat' : 'gradle',
);

if (existsSync(localGradle)) {
  console.log(`[apk] using local Gradle ${GRADLE_VERSION}`);
  run(localGradle, ['assembleRelease', '--no-daemon'], { cwd: ANDROID });
} else {
  console.log('[apk] local Gradle missing, falling back to the wrapper');
  run(isWin ? '.\\gradlew.bat' : './gradlew', ['assembleRelease', '--no-daemon'], { cwd: ANDROID });
}

heading('done');

/* Collect the APK somewhere obvious. Gradle's own path
   (app/build/outputs/apk/release/) is buried and easy to miss. */
const gradleOut = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(gradleOut)) {
  console.error('[apk] Gradle reported success but no APK was produced.\n');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const finalApk = join(OUT_DIR, 'gpt.apk');
copyFileSync(gradleOut, finalApk);

const mb = (statSync(finalApk).size / (1024 * 1024)).toFixed(1);
console.log(`[apk] ${finalApk}`);
console.log(`[apk] ${mb} MB, signed release build`);
console.log('');
console.log('     Install on a connected phone with:');
console.log('       adb install -r release\\gpt.apk');
console.log('');
console.log('     Or copy gpt.apk to the phone and open it (allow "install from');
console.log('     unknown sources" when Android asks).');
console.log('');
console.log('     Note: Puter sign-in and the drive folder picker open browser');
console.log('     popups, which Android WebView blocks by default. See README.');