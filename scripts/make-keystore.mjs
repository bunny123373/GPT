/**
 * Generate a release keystore for the Android APK.
 *
 * Kept as a script rather than a shell one-liner so the whole flow is
 * reproducible and can be re-run for a different alias without retyping the
 * keytool invocation. Skips if the keystore already exists — regenerating one
 * would invalidate the identity of every install already out there, which
 * Android enforces strictly.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = process.cwd();
const DIR = join(ROOT, 'android', 'keystore');
const STORE = join(DIR, 'gpt-release.jks');
const ALIAS = 'gpt';
const PASS = 'gpt-local-dev';

if (existsSync(STORE)) {
  console.log(`[keystore] already exists, leaving it alone:\n           ${STORE}`);
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });

// keytool wants a password of at least 6 characters and rejects the same char
// class twice, so keep a mixed alphanumeric string.
const keypass = `${randomBytes(9).toString('base64url')}${Date.now() % 1000}`.slice(0, 12);

console.log('[keystore] generating a release key (valid 30 years)…');

execFileSync('keytool', [
  '-genkeypair',
  '-keystore', STORE,
  '-alias', ALIAS,
  '-keyalg', 'RSA',
  '-keysize', '2048',
  '-validity', '10950',          // 30 years; Play requires >= 25 for AABs
  '-storetype', 'PKCS12',
  '-storepass', PASS,
  '-keypass', PASS,
  '-dname', 'CN=GPT, OU=App, O=GPT, L=, ST=, C=',
], { stdio: 'inherit' });

console.log(`\n[keystore] done -> ${STORE}`);
console.log(`[keystore] alias '${ALIAS}', store/key password '${PASS}'`);
console.log('[keystore] this password is hardcoded in android/app/build.gradle.');
console.log('[keystore] It is fine for a personal sideloaded build — NOT for a real release.');