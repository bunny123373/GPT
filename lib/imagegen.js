/**
 * Image generation — everything that talks to puter.ai.txt2img().
 *
 * Notes that shaped this file:
 *  - `puter.ai.listModels()` lists CHAT models only. Image models come from a
 *    different driver, discovered via `puter.drivers.call(...)`.
 *  - `quality` values are provider-specific, and Gemini *rejects* an
 *    unsupported tier with bad_request before any credits are checked. So we
 *    whitelist tiers per model and omit the option entirely when unsure.
 *  - Returned `src` may be a temporary hosted URL. To keep generated images
 *    alive in a stored chat we save them to the user's Puter drive.
 */

import { AIError, asText } from './ai.js';

const DRIVER_ID = 'puter-image-generation';
const CACHE_MS = 60 * 1000;

/** Used when driver discovery fails, so the picker is never empty. */
const FALLBACK_MODELS = [
  { id: 'gpt-image-2', provider: 'openai', name: 'GPT Image 2' },
  { id: 'gemini-3.1-flash-image', provider: 'gemini', name: 'Gemini 3.1 Flash Image' },
  { id: 'gemini-nano-banana-2.1', provider: 'gemini', name: 'Nano Banana 2.1' },
  { id: 'gemini-3-pro-image', provider: 'gemini', name: 'Gemini 3 Pro Image' },
  { id: 'grok-imagine-image', provider: 'xai', name: 'Grok Imagine' },
  { id: 'black-forest-labs/flux-schnell', provider: 'replicate', name: 'FLUX Schnell' },
  { id: '@cf/black-forest-labs/flux-1-schnell', provider: 'cloudflare', name: 'FLUX.1 Schnell' },
  { id: 'seedream-5-0-lite-260128', provider: 'byteplus', name: 'Seedream 5.0 Lite' },
];

/** Shapes accepted by `ratio: { w, h }`. Small numbers denote aspect, not pixels. */
export const ASPECT_RATIOS = [
  { id: '1:1', w: 1, h: 1 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
  { id: '4:3', w: 4, h: 3 },
  { id: '3:4', w: 3, h: 4 },
  { id: '3:2', w: 3, h: 2 },
  { id: '21:9', w: 21, h: 9 },
];

export const ASPECT_BY_ID = new Map(ASPECT_RATIOS.map((r) => [r.id, r]));

/**
 * Tiers each model actually accepts. An empty list means "don't send
 * quality at all" — far safer than guessing, since an unsupported tier is a
 * hard bad_request.
 */
const QUALITY_TIERS = [
  [/gemini-3\.1-flash-lite-image/i, ['1K']],
  [/gemini-3\.1-flash-image/i, ['512', '1K', '2K', '4K']],
  [/gemini-nano-banana-2\.1/i, ['1K', '2K', '4K']],
  [/gemini-3-pro-image/i, ['1K', '2K', '4K']],
  [/seedream/i, ['1K', '2K', '4K']],
  [/gpt-image-2\.5/i, ['low', 'medium', 'high', 'xhigh', 'max', 'auto']],
  [/gpt-image/i, ['low', 'medium', 'high', 'auto']],
];

export function qualityTiersFor(modelId) {
  const id = asText(modelId, '');
  for (const [pattern, tiers] of QUALITY_TIERS) {
    if (pattern.test(id)) return tiers;
  }
  return []; // unknown model -> let the provider decide
}

/* ── Model catalogue ──────────────────────────────────────── */

export class ImageCatalogue {
  constructor() {
    this.models = [];
    this.byId = new Map();
    this.loadedAt = 0;
    this.loading = null;
    this.degraded = false;
  }

  async load({ force = false } = {}) {
    if (!force && this.models.length && Date.now() - this.loadedAt < CACHE_MS) {
      return this.models;
    }
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const res = await puter.drivers.call(DRIVER_ID, 'models', {});
        const list = Array.isArray(res?.result) ? res.result : [];
        this.models = list.filter((m) => m && m.id).map((m) => ({
          ...m,
          provider: m.provider || 'other',
          name: m.name || m.id,
        }));
        if (!this.models.length) throw new Error('empty catalogue');
        this.degraded = false;
      } catch (err) {
        console.warn('[imagegen] driver discovery failed, using built-in list', err);
        this.models = FALLBACK_MODELS.map((m) => ({ ...m }));
        this.degraded = true;
      }
      this.byId = new Map(this.models.map((m) => [m.id, m]));
      this.loadedAt = Date.now();
      return this.models;
    })();

    return this.loading;
  }

  get(id) { return this.byId.get(id) || null; }

  getDefaultId() {
    return FALLBACK_MODELS.map((m) => m.id).find((id) => this.byId.has(id))
      || this.models[0]?.id
      || null;
  }

  search(query = '') {
    const q = query.trim().toLowerCase();
    const hit = (m) => !q || m.id.toLowerCase().includes(q) ||
      (m.name || '').toLowerCase().includes(q) || (m.provider || '').toLowerCase().includes(q);

    const groups = new Map();
    for (const m of this.models) {
      if (!hit(m)) continue;
      const key = m.provider || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([provider, list]) => ({ provider, list }));
  }
}

/* ── Generation ───────────────────────────────────────────── */

/** Build the options object, passing ONLY keys the SDK documents. */
export function buildOptions({ model, ratioId, quality, inputImage, testMode, outputPath }) {
  const options = {};

  if (model) options.model = model;

  // Always send a shape: an unknown id falls back to 1:1 rather than silently
  // dropping the option and letting the provider pick something unexpected.
  const ratio = ASPECT_BY_ID.get(asText(ratioId, '1:1')) || ASPECT_BY_ID.get('1:1');
  if (ratio) options.ratio = { w: ratio.w, h: ratio.h };

  // Only send a tier the model is documented to accept.
  const tiers = qualityTiersFor(model);
  const wanted = asText(quality, '');
  if (wanted && tiers.includes(wanted)) options.quality = wanted;

  if (testMode) options.test_mode = true;
  if (outputPath) options.puter_output_path = outputPath;

  // Image-to-image: a data URI works for every provider, including guests.
  const ref = asText(inputImage, '');
  if (ref) options.input_image = ref;

  return options;
}

/**
 * Generate one image.
 * @returns {Promise<{ src: string, options: object }>}
 */
export async function generateImage(opts = {}) {
  const prompt = String(opts.prompt ?? '').trim();
  if (!prompt) throw new AIError('Describe the image you want first.', 'prompt_required');

  const hasPuter = typeof puter !== 'undefined' && puter?.ai?.txt2img;
  if (!hasPuter) throw new AIError('Puter.js is still loading.', 'sdk_unavailable');

  const options = buildOptions(opts);

  const result = await puter.ai.txt2img(prompt, options);

  // Browser: an HTMLImageElement. Node/worker: { src, toString, valueOf }.
  const src = result?.src ?? (typeof result === 'string' ? result : null);
  if (!src || typeof src !== 'string') {
    throw new AIError('The model returned no image. Try again.', 'no_image');
  }
  return { src, options };
}

/** Where to park a generated image in the user's drive. */
export function imageOutputPath(prompt, when = Date.now()) {
  const slug = String(prompt || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'image';
  return `puter-chat/${when}-${slug}.png`;
}

/** Fresh, non-expiring-enough URL for an image already in the user's drive. */
export async function readURL(path, expiresIn = '7d') {
  if (typeof puter === 'undefined' || !puter?.fs?.getReadURL) return null;
  try {
    return await puter.fs.getReadURL(path, expiresIn);
  } catch (err) {
    console.warn('[imagegen] could not mint a read URL', err);
    return null;
  }
}

/** Pull a readable source out of whatever txt2img returned. */
export function srcOf(result) {
  return result?.src ?? (typeof result === 'string' ? result : null) ?? '';
}