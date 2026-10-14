/**
 * Image generation tests against a fake `puter` global.
 * Covers option building (the part that silently costs real credits when
 * wrong), quality-tier whitelisting, aspect ratios, result shape handling
 * and error mapping.
 *
 *   node test/imagegen.js
 */

const {
  ImageCatalogue, generateImage, buildOptions, qualityTiersFor,
  ASPECT_RATIOS, ASPECT_BY_ID, imageOutputPath, srcOf,
} = await import('../js/imagegen.js');
const { describeError, asText } = await import('../js/ai.js');

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
const rejects = (name, promise, code) => {
  return promise.then(
    () => { fail++; console.log(`  FAIL ${name} — expected a rejection`); },
    (err) => {
      if (err?.code === code) { pass++; console.log(`  ok   ${name}`); }
      else { fail++; console.log(`  FAIL ${name} — code ${err?.code}, want ${code}`); }
    }
  );
};

/* ── option building ─────────────────────────────────────── */
console.log('\nbuildOptions');

eq('empty input still sends an explicit 1:1', buildOptions({}), { ratio: { w: 1, h: 1 } });

eq('ratio from id', buildOptions({ ratioId: '16:9' }).ratio, { w: 16, h: 9 });
eq('unknown ratio id falls back', buildOptions({ ratioId: 'banana' }).ratio, { w: 1, h: 1 });
eq('missing ratio id still sends 1:1', buildOptions({}).ratio, { w: 1, h: 1 });

eq('test mode maps to test_mode', buildOptions({ testMode: true }).test_mode, true);
eq('test mode off is omitted', 'test_mode' in buildOptions({ testMode: false }), false);

eq('output path forwarded', buildOptions({ outputPath: 'x/y.png' }).puter_output_path, 'x/y.png');
eq('reference image forwarded', buildOptions({ inputImage: 'data:image/png;base64,AA' }).input_image,
   'data:image/png;base64,AA');

/* ── quality whitelisting ────────────────────────────────── */
// This is the one that costs money: Gemini rejects an unsupported tier with
// bad_request *before* checking credits, so we must never guess.
console.log('\nquality tiers');

eq('gemini flash', qualityTiersFor('gemini-3.1-flash-image'), ['512', '1K', '2K', '4K']);
eq('gemini flash lite is 1K only', qualityTiersFor('gemini-3.1-flash-lite-image'), ['1K']);
eq('nano banana', qualityTiersFor('gemini-nano-banana-2.1'), ['1K', '2K', '4K']);
eq('gpt image', qualityTiersFor('gpt-image-2'), ['low', 'medium', 'high', 'auto']);
eq('gpt image 2.5 adds xhigh/max', qualityTiersFor('gpt-image-2.5-flare'),
   ['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
eq('seedream', qualityTiersFor('seedream-5-0-lite-260128'), ['1K', '2K', '4K']);
eq('unknown model -> no tiers', qualityTiersFor('some/unknown-model'), []);
eq('no model -> no tiers', qualityTiersFor(null), []);

eq('valid tier is sent', buildOptions({ model: 'gpt-image-2', quality: 'high' }).quality, 'high');
eq('tier outside the list is dropped',
   buildOptions({ model: 'gemini-3.1-flash-lite-image', quality: '4K' }).quality, undefined);
eq('tier on unknown model is dropped',
   buildOptions({ model: 'mystery/model', quality: 'ultra' }).quality, undefined);

// Only documented option keys may ever reach puter.ai.txt2img().
eq('never sends unsupported keys', Object.keys(buildOptions({
  model: 'gpt-image-2', ratioId: '1:1', quality: 'high', testMode: true,
  outputPath: 'p.png', inputImage: 'i',
})).sort(), ['input_image', 'model', 'puter_output_path', 'quality', 'ratio', 'test_mode']);

eq('quality omitted when model is unknown', Object.keys(buildOptions({
  model: 'mystery/model', quality: 'high', ratioId: '1:1',
})).sort(), ['model', 'ratio']);

/* ── aspect ratios ───────────────────────────────────────── */
console.log('\naspect ratios');
eq('seven shapes offered', ASPECT_RATIOS.length, 7);
ok('every shape has positive ints', ASPECT_RATIOS.every((r) => r.w > 0 && r.h > 0 && r.id));
ok('landscape 16:9 exists', ASPECT_BY_ID.has('16:9'));
eq('16:9 dims', ASPECT_BY_ID.get('16:9'), { id: '16:9', w: 16, h: 9 });

/* ── output paths ────────────────────────────────────────── */
console.log('\noutput path');
eq('slugifies the prompt', imageOutputPath('A Red Fox! on the Beach', 1),
   'puter-chat/1-a-red-fox-on-the-beach.png');
eq('uses the supplied timestamp', imageOutputPath('cat', 1700000000000),
   'puter-chat/1700000000000-cat.png');
ok('path is namespaced', imageOutputPath('cat').startsWith('puter-chat/'));
ok('empty prompt still yields a name', imageOutputPath('').endsWith('.png'));
ok('punctuation-only prompt is safe', !/[^\w./-]/.test(imageOutputPath('!!!???...')));
ok('very long prompt is capped', imageOutputPath('x'.repeat(500)).length < 90);

/* ── result shape handling ───────────────────────────────── */
console.log('\nresult shape');
eq('reads .src off an element-like', srcOf({ src: 'https://x/a.png' }), 'https://x/a.png');
eq('reads a bare string', srcOf('https://x/b.png'), 'https://x/b.png');
eq('handles null', srcOf(null), '');

/* ── catalogue ───────────────────────────────────────────── */
console.log('\ncatalogue');

globalThis.puter = {
  drivers: {
    call: async (driver, op) => {
      if (driver !== 'puter-image-generation' || op !== 'models') throw new Error('bad call');
      return {
        result: [
          { id: 'gemini-3.1-flash-image', provider: 'gemini', name: 'Gemini Flash Image' },
          { id: 'gpt-image-2', provider: 'openai', name: 'GPT Image 2' },
        ],
      };
    },
  },
  ai: { txt2img: async () => ({ src: 'data:image/png;base64,AAA' }) },
};

const cat = new ImageCatalogue();
await cat.load();
eq('discovers via drivers', cat.models.length, 2);
eq('not degraded', cat.degraded, false);
eq('lookup by id', cat.get('gpt-image-2').name, 'GPT Image 2');
eq('default prefers a known-good id', cat.getDefaultId(), 'gpt-image-2');
eq('search groups by provider', cat.search('').map((g) => g.provider), ['gemini', 'openai']);
eq('search filters', cat.search('gemini').reduce((n, g) => n + g.list.length, 0), 1);
eq('search miss is empty', cat.search('zzzz').length, 0);

// Discovery is a separate driver from the chat catalogue, so this must not
// silently return chat models.
const cat2 = new ImageCatalogue();
globalThis.puter.drivers.call = async () => ({ result: [{ id: 'gpt-4o', provider: 'openai' }] });
await cat2.load();
eq('image catalogue is not the chat list', cat2.get('gpt-4o') !== null, true);
eq('no chat fallback in image list', ASPECT_RATIOS.length > 0, true);

/* ── degraded mode ───────────────────────────────────────── */
console.log('\ndegraded discovery');
globalThis.puter.drivers.call = async () => { throw new Error('driver offline'); };
const cat3 = new ImageCatalogue();
await cat3.load();
ok('falls back to a built-in list', cat3.models.length >= 5);
eq('marked degraded', cat3.degraded, true);
ok('fallback has a default', !!cat3.getDefaultId());

/* ── generateImage ───────────────────────────────────────── */
console.log('\ngenerateImage');

let seenPrompt = null, seenOpts = null;
globalThis.puter = {
  drivers: { call: async () => ({ result: [] }) },
  ai: {
    txt2img: async (prompt, options) => {
      seenPrompt = prompt;
      seenOpts = options;
      return { src: 'https://cdn.test/generated.png' };
    },
  },
};

const out = await generateImage({
  prompt: '  a red fox  ',
  model: 'gpt-image-2',
  ratioId: '3:2',
  quality: 'high',
  testMode: false,
});
eq('prompt trimmed', seenPrompt, 'a red fox');
eq('model forwarded', seenOpts.model, 'gpt-image-2');
eq('ratio forwarded', seenOpts.ratio, { w: 3, h: 2 });
eq('quality forwarded', seenOpts.quality, 'high');
eq('no test_mode when off', 'test_mode' in seenOpts, false);
eq('returns the src', out.src, 'https://cdn.test/generated.png');

await generateImage({ prompt: 'test', testMode: true });
eq('test mode forwarded', seenOpts.test_mode, true);

await rejects('blank prompt', generateImage({ prompt: '   ' }), 'prompt_required');
await rejects('missing prompt', generateImage({}), 'prompt_required');

// Browser hands back an HTMLImageElement; make sure that shape works too.
globalThis.puter.ai.txt2img = async () => ({ src: 'blob:abc', nodeName: 'IMG' });
eq('reads .src off an element', (await generateImage({ prompt: 'x' })).src, 'blob:abc');

globalThis.puter.ai.txt2img = async () => ({});
await rejects('no image in result', generateImage({ prompt: 'x' }), 'no_image');

globalThis.puter.ai.txt2img = async () => { const e = new Error('nope'); e.code = 'moderation_flagged'; throw e; };
await rejects('moderation error surfaces', generateImage({ prompt: 'x' }), 'moderation_flagged');

/* ── error messages ──────────────────────────────────────── */
console.log('\nimage error text');
// Puter sends { message, code } plus errorCode when a more specific code
// exists alongside a general one — moderation arrives that way.
eq('moderation via errorCode',
   describeError({ code: 'bad_request', message: 'x', errorCode: 'moderation_flagged' }),
   "That prompt was blocked by the provider's content filter. Try rewording it.");
eq('moderation via code',
   describeError({ code: 'moderation_flagged', message: 'x' }),
   "That prompt was blocked by the provider's content filter. Try rewording it.");
eq('moderation nested in error',
   describeError({ error: { errorCode: 'moderation_flagged', code: 'bad_request' } }),
   "That prompt was blocked by the provider's content filter. Try rewording it.");
eq('insufficient funds', describeError({ code: 'insufficient_funds', message: 'x' }),
   'Not enough usage credits for this request.');
eq('insufficient funds nested', describeError({ error: { code: 'insufficient_funds' } }),
   'Not enough usage credits for this request.');
eq('upstream failed', describeError({ code: 'upstream_failed', message: 'x' }),
   'The image provider failed on their end. Safe to retry.');
eq('upstream timeout', describeError({ code: 'upstream_timeout', message: 'x' }),
   'The image provider timed out. Try again.');
eq('prompt required', describeError({ code: 'prompt_required' }), 'Type a prompt first.');
eq('bad request keeps its code', describeError({ code: 'bad_request', message: 'x' }),
   'That model rejected these settings (bad_request). Try a different aspect ratio or quality.');
eq('bad request nested is readable',
   describeError({ error: { code: 'bad_request', message: 'ratio invalid' } }),
   'That model rejected these settings (bad_request). Try a different aspect ratio or quality.');
ok('no [object Object] in image errors',
   !describeError({ error: { code: 'bad_request' } }).includes('[object Object]'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);