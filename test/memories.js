/**
 * Memories tests.
 *
 * Memories are the part of the app that writes something the user did not
 * explicitly type, so the interesting cases are all about refusing to store
 * the wrong thing: model replies treated as fact, duplicates piling up, a
 * runaway list bloating the system prompt, and a model reply that is
 * chatty prose rather than the JSON array that was asked for.
 *
 *   node test/memories.js
 */

const {
  KEY, MAX_MEMORIES, MAX_LENGTH, BLANK,
  normalise, hasMemories, memoryPrompt, withMemories,
  EXTRACT_INSTRUCTION, parseSuggestions, merge, remove,
} = await import('../lib/memories.js');

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

/* ── constants ───────────────────────────────────────────── */

console.log('\nconstants');
eq('stored under its own key, not sharing with the profile', KEY, 'memories');
ok('key does not collide with conversations', KEY !== 'conversations');
eq('an empty list is the blank state', BLANK, []);
ok('the list is capped', MAX_MEMORIES > 0 && MAX_MEMORIES <= 200, String(MAX_MEMORIES));
ok('each line is capped', MAX_LENGTH > 0 && MAX_LENGTH <= 1000, String(MAX_LENGTH));

/* ── normalise ───────────────────────────────────────────── */

console.log('\nnormalise');
eq('an array of strings passes through', normalise(['a', 'b']), ['a', 'b']);
eq('trims each entry', normalise(['  padded  ']), ['padded']);
eq('collapses internal whitespace', normalise(['two   spaces\nhere']), ['two spaces here']);
eq('drops empty entries', normalise(['', '   ', 'kept']), ['kept']);
eq('accepts {text} objects', normalise([{ text: 'structured' }]), ['structured']);
eq('drops null and undefined', normalise([null, undefined, 'kept']), ['kept']);
eq('drops numbers and booleans', normalise([42, true, 'kept']), ['kept']);

for (const bad of [null, undefined, 'a string', 42, true, {}, { a: 1 }]) {
  eq(`garbage input ${JSON.stringify(bad)} is an empty list`, normalise(bad), []);
}

console.log('\nnormalise — duplicates');
eq('exact duplicates collapse', normalise(['same', 'same', 'same']), ['same']);
eq('case does not create a second copy', normalise(['Uses TypeScript', 'uses typescript']), ['Uses TypeScript']);
eq('dedupe keeps the first occurrence, not the last',
  normalise(['First', 'first']), ['First']);
eq('duplicates across mixed shapes still collapse',
  normalise(['dup', { text: 'dup' }]), ['dup']);

console.log('\nnormalise — bounds');
{
  const many = Array.from({ length: MAX_MEMORIES + 25 }, (_, i) => `fact ${i}`);
  eq('the list is truncated at the cap', normalise(many).length, MAX_MEMORIES);
  eq('and keeps the earliest entries', normalise(many)[0], 'fact 0');

  const long = 'x'.repeat(MAX_LENGTH + 200);
  eq('a very long line is truncated', normalise([long])[0].length, MAX_LENGTH);
}

/* ── hasMemories / prompt ────────────────────────────────── */

console.log('\nhasMemories');
eq('a populated list', hasMemories(['a']), true);
eq('an empty list', hasMemories([]), false);
eq('a list of only blanks', hasMemories(['', '  ']), false);
eq('a non-array', hasMemories(null), false);
eq('undefined', hasMemories(undefined), false);

console.log('\nmemoryPrompt');
eq('empty list produces no prompt at all', memoryPrompt([]), '');
eq('a list of only blanks produces no prompt', memoryPrompt(['', ' ']), '');
ok('empty adds no tokens to the common case', memoryPrompt([]).length === 0);

{
  const out = memoryPrompt(['Prefers TypeScript', 'Lives in Berlin']);
  ok('every memory is included', out.includes('Prefers TypeScript') && out.includes('Lives in Berlin'));
  ok('each is on its own line', (out.match(/^- /gm) || []).length === 2);
  ok('it is framed as background, not as commands',
    /background/i.test(out) && !/remember this/i.test(out),
    out.slice(0, 80));
  /* The framing does tell the model not to volunteer the memories back, which
     is deliberate. What must not be there is the memories *themselves* being
     phrased as rules to execute. */
  ok('it tells the model not to volunteer them unprompted',
    /do not repeat it back/i.test(out));
  ok('no memory is phrased as an instruction to obey',
    !/^\s*-\s*(always|never|must|remember to)/i.test(out), out);
}

{
  // The framing matters: a memory phrased as an instruction ("Always use
  // metric") is far more likely to be obeyed as a rule than recalled as fact.
  const out = memoryPrompt(['The user works in metric']);
  ok('memory is stated as a fact about the user', out.includes('- The user works in metric'));
}

console.log('\nwithMemories');
eq('no memories means the base prompt is untouched', withMemories('Base.', []), 'Base.');
eq('memories are appended below the base', withMemories('Base.', ['x']),
  `Base.\n\n${memoryPrompt(['x'])}`);
eq('a blank base still produces the memory block', withMemories('', ['x']), memoryPrompt(['x']));
eq('a blank base and no memories is empty', withMemories('', []), '');
eq('whitespace-only base is normalised away',
  withMemories('   ', ['x']), memoryPrompt(['x']));
eq('non-string base is tolerated', withMemories(null, ['x']), memoryPrompt(['x']));
{
  // Ordering is the whole point of this function: system prompt, then profile,
  // then memories, so the most specific context sits closest to the message.
  const out = withMemories('Base prompt.', ['fact']);
  ok('base comes before memories',
    out.indexOf('Base prompt.') < out.indexOf('- fact'), out);
}

/* ── the extraction instruction ──────────────────────────── */

console.log('\nextraction instruction');
ok('asks for JSON explicitly', /json array/i.test(EXTRACT_INSTRUCTION));
ok('asks for bare strings', /array of strings/i.test(EXTRACT_INSTRUCTION));
ok('demands third-person fact phrasing', /third person/i.test(EXTRACT_INSTRUCTION));
ok('excludes assistant claims about itself',
  /assistant said about itself/i.test(EXTRACT_INSTRUCTION));
ok('excludes inferences', /inferred but were not told/i.test(EXTRACT_INSTRUCTION));
ok('excludes task-specific detail', /specific to the task/i.test(EXTRACT_INSTRUCTION));
ok('says what to do when there is nothing to say', /return \[\]/i.test(EXTRACT_INSTRUCTION));

/* ── parseSuggestions ────────────────────────────────────── */

console.log('\nparseSuggestions — well-formed');
eq('a bare array', parseSuggestions('["a", "b"]'), ['a', 'b']);
eq('a single-element array', parseSuggestions('["only"]'), ['only']);
eq('an empty array is a valid "nothing found"', parseSuggestions('[]'), []);
eq('whitespace around the array', parseSuggestions('  \n ["a"] \n '), ['a']);

console.log('\nparseSuggestions — chatty models');
eq('inside a json fence', parseSuggestions('```json\n["a"]\n```'), ['a']);
eq('inside a bare fence', parseSuggestions('```\n["a"]\n```'), ['a']);
eq('with a sentence before it', parseSuggestions('Sure! Here you go:\n["a"]'), ['a']);
eq('with a sentence after it', parseSuggestions('["a"]\nLet me know!'), ['a']);
eq('with both', parseSuggestions('Here:\n```json\n["a","b"]\n```\nHope that helps.'), ['a', 'b']);
eq('multi-line strings are collapsed', parseSuggestions('["two  lines"]'), ['two lines']);
eq('duplicates from the model collapse', parseSuggestions('["a","a"]'), ['a']);
eq('non-string entries are dropped', parseSuggestions('[1, "kept", null]'), ['kept']);
eq('a {text} object is unwrapped, not stringified as JSON',
  parseSuggestions('[{"text":"x"}, "kept"]'), ['x', 'kept']);
eq('an object with no text is dropped rather than stringified',
  parseSuggestions('[{"foo":"bar"}, "kept"]'), ['kept']);

console.log('\nparseSuggestions — bad replies');
eq('empty reply', parseSuggestions(''), []);
eq('whitespace only', parseSuggestions('   \n  '), []);
eq('no array at all', parseSuggestions('I cannot help with that.'), []);
eq('truncated array', parseSuggestions('["a", "b"'), []);
eq('unclosed array', parseSuggestions('["a"'), []);
eq('malformed json', parseSuggestions('[a, b]'), []);
eq('a json object, not an array', parseSuggestions('{"facts": ["a"]}'), []);
eq('undefined', parseSuggestions(undefined), []);
eq('a number', parseSuggestions(42), []);
eq('brackets containing prose',
  parseSuggestions('[I think the user is a developer]'), []);
eq('an empty fenced block', parseSuggestions('```json\n```'), []);

/* ── merge ───────────────────────────────────────────────── */

console.log('\nmerge');
eq('adds to an empty list', merge([], ['a']), ['a']);
eq('appends after existing', merge(['a'], ['b']), ['a', 'b']);
eq('skips ones already present', merge(['a'], ['a', 'b']), ['a', 'b']);
eq('duplicate detection is case-insensitive', merge(['Uses TS'], ['uses ts']), ['Uses TS']);
eq('existing order is preserved', merge(['z', 'a'], ['m']), ['z', 'a', 'm']);
eq('duplicates within the incoming batch collapse',
  merge([], ['a', 'a', 'b']), ['a', 'b']);
eq('blank suggestions are ignored', merge(['a'], ['', '   ']), ['a']);
eq('normalises the incoming entries', merge([], ['  padded  ']), ['padded']);
eq('garbage existing is tolerated', merge(null, ['a']), ['a']);
eq('garbage suggestions are tolerated', merge(['a'], null), ['a']);
eq('merging nothing changes nothing', merge(['a'], []), ['a']);
eq('merge is idempotent', merge(['a', 'b'], ['a', 'b']), ['a', 'b']);
{
  const many = Array.from({ length: MAX_MEMORIES + 10 }, (_, i) => `f${i}`);
  eq('the merged list respects the cap', merge(many, ['extra']).length, MAX_MEMORIES);
}

/* ── remove ──────────────────────────────────────────────── */

console.log('\nremove');
eq('removes an exact match', remove(['a', 'b'], 'a'), ['b']);
eq('removal is case-insensitive', remove(['Prefers TS'], 'prefers ts'), []);
eq('a partial match does not remove', remove(['abc'], 'ab'), ['abc']);
eq('removing something absent is a no-op', remove(['a'], 'zzz'), ['a']);
eq('removing from an empty list is safe', remove([], 'a'), []);
eq('removing from garbage is safe', remove(null, 'a'), []);
eq('removes only the target, keeping the rest', remove(['a', 'b', 'c'], 'b'), ['a', 'c']);
{
  const list = ['one', 'two', 'three'];
  remove(list, 'two');
  eq('remove does not mutate its input', list, ['one', 'two', 'three']);
}

/* ── the round trip that actually matters ────────────────── */

console.log('\nend to end');
{
  // What the user sees: the model proposes, they get stored, and a later chat
  // carries them.
  const reply = 'Here is what I noticed:\n```json\n["The user is a backend engineer",'
    + ' "Prefers concise answers", "The user is a backend engineer"]\n```\nDone.';
  const suggested = parseSuggestions(reply);
  eq('the chatty reply yields clean facts', suggested.length, 2);

  const stored = merge([], suggested);
  eq('they persist', stored.length, 2);

  const prompt = withMemories('You are a helpful assistant.', stored);
  ok('a later chat carries them', prompt.includes('backend engineer'));
  ok('and the base prompt survives', prompt.startsWith('You are a helpful assistant.'));
  eq('forgetting one leaves the other', remove(stored, stored[0]), [stored[1]]);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);