/**
 * Contract check against the real Puter.js bundle.
 *
 * Fetches https://js.puter.com/v2/ and asserts that every API this app calls
 * is still present in the shipped SDK. If Puter renames or drops something,
 * this fails loudly instead of the app dying silently in the browser.
 *
 *   node test/sdk-surface.js
 */

const CDN = 'https://js.puter.com/v2/';

const res = await fetch(CDN);
if (!res.ok) {
  console.error(`Could not fetch ${CDN}: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const src = await res.text();
console.log(`Fetched ${CDN} (${(src.length / 1024).toFixed(0)} KB)\n`);

// Each entry: [label, regex that must match somewhere in the bundle]
const API = [
  ['ai.chat',                 /listModels|chat\s*[:=]\s*(async\s*)?function|\bchat\s*\(/],
  ['ai.listModels',           /listModels/],
  ['ai.listModelProviders',   /listModelProviders/],
  ['auth.isSignedIn',         /isSignedIn/],
  ['auth.signIn',             /signIn/],
  ['auth.signOut',            /signOut/],
  ['auth.getUser',            /getUser/],
  ['auth.getProfilePicture',  /getProfilePicture/],
  ['kv.get',                  /\bget\s*\(/],
  ['kv.set',                  /\bset\s*\(/],
  ['kv.update',               /\bupdate\s*\(/],
  ['kv.remove',               /\bremove\s*\(/],
  ['kv.del',                  /\bdel\s*\(/],
  ['kv.flush',                /\bflush\s*\(/],
  ['fs.write',                /\bwrite\s*\(/],
  ['ui.setWindowTitle',       /setWindowTitle/],
];

// Fields the SDK itself constructs. Note: usage counters (usageDetails,
// prompt_tokens, finish_reason, ...) are deliberately NOT checked — they are
// provider pass-throughs that never appear in the SDK source, so a grep proves
// nothing about them. They are handled defensively at runtime instead.
const SHAPES = [
  ['model.id',                /\bid:/],
  ['model.provider',          /provider/],
  ['model.context',           /context/],
  ['model.cost.input',        /input/],
  ['model.cost.output',       /output/],
  ['tool_calls passthrough',  /tool_calls/],
];

let pass = 0, fail = 0;
const check = (label, re) => {
  if (re.test(src)) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}  (${re} not found in bundle)`); }
};

console.log('API surface used by this app:');
for (const [label, re] of API) check(label, re);

console.log('\nResponse fields this app reads:');
for (const [label, re] of SHAPES) check(label, re);

console.log(`\n${pass} present, ${fail} missing\n`);
process.exit(fail ? 1 : 0);