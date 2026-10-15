/** @type {import('next').NextConfig} */

/**
 * `APK=1` produces a plain static export in `out/` instead of a server build.
 *
 * This exists for the Android APK (Capacitor). Capacitor ships the site's files
 * *inside* the APK and serves them from a WebView, so it needs real files on
 * disk — a Next.js server build has none.
 *
 * It is opt-in via an env var rather than a permanent setting, because the
 * Vercel deploy needs the normal server build. `npm run build` is untouched;
 * only `npm run build:apk` sets it.
 *
 * Static export is safe here: the app is entirely client-side and has no
 * dynamic routes, cookies() or headers() reads. `test/tokens.mjs`-style checks
 * do not cover this, so `npm run build:apk` fails loudly if that ever changes.
 */
const isApkBuild = process.env.APK === '1';

const nextConfig = {
  reactStrictMode: true,
  ...(isApkBuild ? { output: 'export' } : {}),
  /* In Next 16 `distDir` names the export directory itself, so the APK bundle
     lands in `.next-export/` and the server build in `.next/`. Keeping them
     apart matters: an export build overwrites `.next/`, which would leave
     `npm start` unable to serve the web app. */
  ...(isApkBuild ? { distDir: '.next-export' } : {}),
};

export default nextConfig;