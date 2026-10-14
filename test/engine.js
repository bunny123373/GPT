/**
 * End-to-end test of the chat engine with a fake `puter` global.
 * Exercises streaming, reasoning, usage capture, aborts and error chunks —
 * the paths that are hardest to check by hand and easiest to get wrong.
 *
 *   node test/engine.js
 */

const runTurn = (await import('../js/ai.js')).runTurn;

// ── a fake streaming chat() ────────────────────────────────
// Mirrors the real SDK's contract: it honours the AbortSignal and rejects with
// an AbortError, exactly as puter.ai.chat does per the docs.
function fakeStream(chunks, { delay = 0 } = {}) {
  return async function* chat(_messages, options = {}) {
    const signal = options.signal;
    for (const c of chunks) {
      if (signal?.aborted) {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        throw err;
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (c.type === 'throw') throw c.err;
      yield c;
    }
    if (signal?.aborted) {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    }
  };
}

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${a}\n       want: ${e}`); }
};
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const base = { messages: [{ role: 'user', content: 'hi' }], model: 'test-model', stream: true };

/* ── streaming text ──────────────────────────────────────── */
console.log('\nstreaming');

let deltas = [];
let finals = [];
globalThis.puter = {
  ai: {
    chat: fakeStream([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo ' },
      { type: 'text', text: 'world' },
      { type: 'usage', usage: { cost: 2_500_000 }, usageDetails: { inputTokens: 12, outputTokens: 3 }, finish_reason: 'stop' },
    ]),
  },
};

const r1 = await runTurn(base, { onText: (_d, all) => deltas.push(all) });
eq('accumulates text', r1.text, 'Hello world');
eq('cumulative deltas', deltas, ['Hel', 'Hello ', 'Hello world']);
eq('captures usage cost', r1.usage.cost, 2_500_000);
eq('captures usageDetails', r1.usageDetails, { inputTokens: 12, outputTokens: 3 });
eq('captures finish_reason', r1.finishReason, 'stop');

/* ── reasoning ───────────────────────────────────────────── */
console.log('\nreasoning');

let reasoningAll = [];
globalThis.puter = {
  ai: {
    chat: fakeStream([
      { type: 'reasoning', reasoning: 'think 1 ' },
      { type: 'reasoning', reasoning: 'think 2' },
      { type: 'text', text: 'answer' },
    ]),
  },
};
const r2 = await runTurn(base, { onReasoning: (_d, all) => reasoningAll.push(all) });
eq('accumulates reasoning', r2.reasoning, 'think 1 think 2');
eq('reasoning deltas', reasoningAll, ['think 1 ', 'think 1 think 2']);
eq('text still captured', r2.text, 'answer');

/* ── generated images ────────────────────────────────────── */
console.log('\nimages');

globalThis.puter = {
  ai: { chat: fakeStream([{ type: 'image', image: { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } } }]) },
};
const r3 = await runTurn(base);
eq('collects image chunk', r3.images.length, 1);
eq('keeps image url', r3.images[0].image_url.url, 'data:image/png;base64,AAA');

/* ── error chunk must throw, not silently "succeed" ──────── */
console.log('\nerrors');

globalThis.puter = {
  ai: { chat: fakeStream([{ type: 'text', text: 'partial' }, { type: 'error', message: 'Provider exploded', code: 'overloaded_error' }]) },
};
let threw = null;
try { await runTurn(base); } catch (e) { threw = e; }
ok('error chunk throws', threw !== null);
ok('error is AIError', threw?.name === 'AIError', `got ${threw?.name}`);
ok('error keeps message', /exploded/.test(threw?.message || ''), `got "${threw?.message}"`);

globalThis.puter = { ai: { chat: fakeStream([{ type: 'throw', err: Object.assign(new Error('socket hang up'), { code: 'network_error' }) }]) } };
threw = null;
try { await runTurn(base); } catch (e) { threw = e; }
ok('thrown error propagates', /socket hang up/.test(threw?.message || ''));

/* ── non-streaming ───────────────────────────────────────── */
console.log('\nnon-streaming');

globalThis.puter = {
  ai: {
    chat: async () => ({
      message: { content: 'plain string', reasoning: 'because' },
      finish_reason: 'stop',
      usage: { cost: 1_000_000 },
    }),
  },
};
let finalText = null;
const r4 = await runTurn({ ...base, stream: false }, { onText: (t) => { finalText = t; } });
eq('string content', r4.text, 'plain string');
eq('captures reasoning', r4.reasoning, 'because');
eq('emits text once', finalText, 'plain string');

globalThis.puter = {
  ai: {
    chat: async () => ({
      // Anthropic-style content blocks (vendor-native shape)
      message: { content: [{ type: 'text', text: 'block one ' }, { type: 'text', text: 'block two' }] },
      finish_reason: 'end_turn',
    }),
  },
};
const r5 = await runTurn({ ...base, stream: false });
eq('joins vendor content blocks', r5.text, 'block one block two');

/* ── options are forwarded ───────────────────────────────── */
console.log('\noptions');

let seenOpts = null;
let seenArgs = null;
globalThis.puter = {
  ai: {
    chat: async function (messages, opts) { seenArgs = messages; seenOpts = opts; return { message: { content: 'ok' } }; },
  },
};
await runTurn({
  messages: [{ role: 'user', content: 'x' }],
  model: 'claude-test',
  stream: false,
  temperature: 0.25,
  maxTokens: 512,
});
eq('forwards model', seenOpts.model, 'claude-test');
eq('forwards temperature', seenOpts.temperature, 0.25);
eq('forwards max_tokens', seenOpts.max_tokens, 512);
eq('forwards messages', seenArgs, [{ role: 'user', content: 'x' }]);
ok('omits max_tokens when unset', (await (async () => {
  await runTurn({ messages: [], stream: false });
  return !('max_tokens' in seenOpts);
})()));

/* ── abort ───────────────────────────────────────────────── */
console.log('\nabort');

const controller = new AbortController();
globalThis.puter = {
  ai: {
    chat: fakeStream(
      [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }],
      { delay: 20 }
    ),
  },
};
const pending = runTurn({ ...base, signal: controller.signal });
setTimeout(() => controller.abort(), 10);
let aborted = null;
try { await pending; } catch (e) { aborted = e; }
ok('abort rejects the stream', aborted !== null);
ok('abort surfaces as AbortError', aborted?.name === 'AbortError' || /stopped|abort/i.test(aborted?.message || ''),
   `got ${aborted?.name}: ${aborted?.message}`);

/* ── missing SDK ─────────────────────────────────────────── */
console.log('\nresilience');

delete globalThis.puter;
threw = null;
try { await runTurn(base); } catch (e) { threw = e; }
ok('errors when SDK missing', threw?.code === 'sdk_unavailable', `got ${threw?.code}`);

// Empty stream must not throw and must report zero cost.
globalThis.puter = { ai: { chat: fakeStream([]) } };
const r6 = await runTurn(base);
eq('empty stream ok', r6.text, '');
eq('empty stream no usage', r6.usage, null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);