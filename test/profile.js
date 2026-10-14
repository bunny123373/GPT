/**
 * "Ask me" profile tests.
 * The profile is folded into the system prompt, so the important behaviour is
 * what it produces — and what it must NOT produce when left blank.
 *
 *   node test/profile.js
 */

const {
  TONES, BLANK_PROFILE, hasProfile, normalise,
  profilePrompt, effectiveSystemPrompt, profileSummary,
} = await import('../lib/profile.js');

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

/* ── blank profile adds nothing ──────────────────────────── */

console.log('\nblank profile');
eq('blank prompt is empty', profilePrompt(BLANK_PROFILE), '');
eq('null is empty', profilePrompt(null), '');
eq('undefined is empty', profilePrompt(undefined), '');
eq('all-empty object is empty', profilePrompt({ name: '', role: '', goals: '', avoid: '' }), '');
ok('hasProfile false when blank', hasProfile(BLANK_PROFILE) === false);
eq('blank does not append to a base prompt',
   effectiveSystemPrompt('You are helpful.', BLANK_PROFILE), 'You are helpful.');
eq('empty object does not append either',
   effectiveSystemPrompt('You are helpful.', {}), 'You are helpful.');

/* ── each answer reaches the prompt ───────────────────────── */

console.log('\nanswers reach the prompt');
ok('name', profilePrompt({ name: 'Ada' }).includes("The user's name is Ada."));
ok('role', profilePrompt({ role: 'backend engineer' }).includes('backend engineer'));
ok('goals', profilePrompt({ goals: 'shipping a chat app' }).includes('shipping a chat app'));
ok('avoid', profilePrompt({ avoid: 'no emojis' }).includes('Avoid: no emojis'));
ok('concise tone', profilePrompt({ tone: 'concise' }).includes('concise'));
ok('detailed tone', profilePrompt({ tone: 'detailed' }).includes('detailed'));

eq('balanced tone adds no instruction',
   profilePrompt({ name: 'Ada', tone: 'balanced' }), 'About the user:\n- The user\'s name is Ada.');
eq('three answers produce three bullets',
   profilePrompt({ name: 'Ada', role: 'teacher', goals: 'a lesson plan' }).split('\n- ').length, 4);

/* ── merging with the base prompt ────────────────────────── */

console.log('\nmerging');
const merged = effectiveSystemPrompt('You are helpful.', { name: 'Ada', role: 'teacher' });
ok('keeps the base prompt', merged.startsWith('You are helpful.'));
ok('appends the profile', merged.includes('About the user:'));
ok('profile alone still works', effectiveSystemPrompt('', { name: 'Ada' }).startsWith('About the user:'));
eq('empty base, no profile is empty', effectiveSystemPrompt('', BLANK_PROFILE), '');
ok('blank base is trimmed', effectiveSystemPrompt('   ', { name: 'Ada' }).startsWith('About the user:'));

/* ── normalisation & hostile storage ──────────────────────── */

console.log('\nnormalisation');
eq('missing object falls back', normalise(null), BLANK_PROFILE);
eq('unknown tone resets', normalise({ tone: 'sarcastic' }).tone, 'balanced');
eq('known tone kept', normalise({ tone: 'detailed' }).tone, 'detailed');
eq('extra fields dropped', Object.keys(normalise({ name: 'A', evil: '<script>' })).sort(),
   ['avoid', 'goals', 'name', 'role', 'tone']);
// A non-string never becomes literal text; it is rendered readably instead.
ok('non-string name is coerced to readable text',
   typeof normalise({ name: { a: 1 } }).name === 'string' &&
   !normalise({ name: { a: 1 } }).name.includes('[object Object]'),
   normalise({ name: { a: 1 } }).name);

ok('no [object Object] in the prompt', !profilePrompt({ name: { a: 1 } }).includes('[object Object]'));
ok('no [object Object] when merging',
   !effectiveSystemPrompt('x', { goals: { b: 2 } }).includes('[object Object]'));

/* ── summary for the sidebar ─────────────────────────────── */

console.log('\nsummary');
eq('summary uses the name', profileSummary({ name: 'Ada' }), 'Ada');
eq('summary falls back to role', profileSummary({ role: 'teacher' }), 'teacher');
eq('summary when only tone set', profileSummary({ tone: 'concise' }), 'Personalised');
eq('summary blank is empty', profileSummary(BLANK_PROFILE), '');

/* ── tone table is well-formed ───────────────────────────── */

console.log('\ntones');
eq('three tones', TONES.length, 3);
ok('each tone has id, label and hint',
   TONES.every((t) => t.id && t.label && t.hint));
ok('tone ids are unique', new Set(TONES.map((t) => t.id)).size === TONES.length);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);