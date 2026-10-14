/**
 * AI layer — everything that talks to puter.ai.
 *
 * Responsibilities:
 *  - discover the live model catalogue (puter.ai.listModels)
 *  - turn our stored messages into the `messages` array puter.ai.chat wants
 *  - run a turn, streaming or not, and report progress through callbacks
 *  - normalise every failure mode into a readable string
 */

const MODEL_CACHE_MS = 60 * 1000; // matches the server-side catalogue cache

/** Preferred defaults, best first. The first one the catalogue offers wins. */
const PREFERRED_MODELS = [
  'gpt-5.4-nano',
  'gpt-5.6-luna',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'gemini-3.5-flash-lite',
  'deepseek-chat',
];

const hasPuter = () => typeof puter !== 'undefined' && !!puter?.ai;

export class AIError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AIError';
    this.code = code || 'ai_error';
  }
}

/**
 * Coerce anything into a short, human-readable string.
 *
 * The one rule: never return "[object Object]". Puter (like most JSON APIs)
 * rejects with plain objects — `{ code, message }`, `{ error: { message } }`,
 * `{ statusText }` — so blind `String(err)` produces literal "[object Object]"
 * in the UI. Walk the known shapes, then fall back to the JSON.
 */
export function asText(value, fallback = 'Something went wrong.') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return value.message?.trim() || value.name || fallback;

  // Shapes an API rejection realistically takes, most specific first.
  const candidates = [
    value.message, value.error, value.reason, value.detail,
    value.description, value.statusText, value.title, value.data,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (c && typeof c === 'object') {
      const nested = asText(c, '');
      if (nested) return nested;
    }
  }

  try {
    const json = JSON.stringify(value);
    if (json && json !== '{}' && json !== '[]' && json !== 'null') {
      return json.length > 300 ? `${json.slice(0, 300)}…` : json;
    }
  } catch { /* circular or unserialisable */ }

  return fallback;
}

/**
 * Pull every machine-readable code out of whatever shape we were rejected with.
 * Puter sends `{ message, code }` plus `errorCode` when a more specific code
 * exists alongside a general one — e.g. `code: 'bad_request'` with
 * `errorCode: 'moderation_flagged'`. Checking only `code` would miss that.
 */
function errorCodes(err) {
  if (!err || typeof err !== 'object') return [];
  return [err.errorCode, err.code, err.error?.errorCode, err.error?.code]
    .map((v) => asText(v, ''))
    .filter(Boolean);
}

const hasCode = (codes, re) => codes.some((c) => re.test(c));

/** Turn any thrown value into a message worth showing a human. */
export function describeError(err) {
  if (err instanceof AIError) return asText(err.message, 'The request failed.');
  if (err === null || err === undefined) return 'Unknown error.';

  const codes = errorCodes(err);
  // Prefer the specific code when the backend supplied one.
  const code = codes[0] || '';
  const suffix = code ? ` (${code})` : '';
  const msg = asText(err, '');
  const name = typeof err === 'object' ? asText(err.name, '') : '';

  if (name === 'AbortError' || /abort/i.test(msg)) return 'Stopped.';
  if (hasCode(codes, /moderation_flagged/i) || /moderation_flagged/i.test(msg)) {
    return "That prompt was blocked by the provider's content filter. Try rewording it.";
  }
  if (hasCode(codes, /network_error/i)) return `Network error${suffix}. Check your connection and try again.`;
  if (hasCode(codes, /request_timeout/i)) return `The model took too long to respond${suffix}. Try again.`;
  if (hasCode(codes, /invalid_stream_response/i)) return `The model sent a malformed response${suffix}.`;
  if (hasCode(codes, /prompt_required/i)) return 'Type a prompt first.';
  if (hasCode(codes, /no_image/i)) return 'The model returned no image. Try again.';
  if (hasCode(codes, /insufficient_funds/i)) return 'Not enough usage credits for this request.';
  if (hasCode(codes, /upstream_timeout/i)) return 'The image provider timed out. Try again.';
  if (hasCode(codes, /upstream_failed/i)) return 'The image provider failed on their end. Safe to retry.';
  if (hasCode(codes, /^bad_request$/i)) return `That model rejected these settings${suffix}. Try a different aspect ratio or quality.`;
  if (/401|unauthor|auth/i.test(msg)) return 'Your Puter session expired. Sign in again and retry.';
  if (/429|rate.?limit|quota/i.test(msg)) return `Rate limit reached${suffix}. Wait a moment, then try again.`;
  if (/402|insufficient.?credit|payment/i.test(msg)) return 'This Puter account is out of usage credits.';
  if (/model/i.test(msg) && /not (found|available|support)/i.test(msg)) return `Model unavailable${suffix}. Pick another model.`;
  if (/network|fetch failed|failed to fetch|econnrefused/i.test(msg)) return `Could not reach the server${suffix}. Check your connection.`;

  // asText() guarantees a non-empty, non-"[object Object]" string here.
  const clean = msg && msg !== '[object Object]' ? msg : '';
  if (!clean) return 'Something went wrong.';
  // Don't repeat the code if the text already shows it (e.g. the JSON fallback).
  return clean.toLowerCase().includes(code.toLowerCase()) ? clean : clean + suffix;
}

/* ── Model catalogue ──────────────────────────────────────── */

export class ModelCatalogue {
  constructor() {
    this.models = [];
    this.byId = new Map();
    this.loadedAt = 0;
    this.loading = null;
    this.error = null;
  }

  async load({ force = false } = {}) {
    if (!hasPuter()) {
      this.error = 'Puter.js is still loading. Check your network connection.';
      throw new AIError(this.error, 'sdk_unavailable');
    }
    if (!force && this.models.length && Date.now() - this.loadedAt < MODEL_CACHE_MS) {
      return this.models;
    }
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const list = await puter.ai.listModels();
        this.models = (list || []).filter((m) => m && m.id);
        this.byId = new Map(this.models.map((m) => [m.id, m]));
        this.loadedAt = Date.now();
        this.error = null;
        return this.models;
      } catch (err) {
        this.error = describeError(err);
        throw new AIError(this.error, err?.code || 'list_models_failed');
      } finally {
        this.loading = null;
      }
    })();

    return this.loading;
  }

  get(id) { return this.byId.get(id) || null; }

  /** First model from our preferred list, else whatever the catalogue has. */
  getDefaultId() {
    for (const id of PREFERRED_MODELS) {
      if (this.byId.has(id)) return id;
    }
    return this.models[0]?.id ?? null;
  }

  /** Filter + group by provider for the picker UI. */
  search(query = '') {
    const q = query.trim().toLowerCase();
    const hit = (m) =>
      !q ||
      m.id.toLowerCase().includes(q) ||
      (m.name || '').toLowerCase().includes(q) ||
      (m.provider || '').toLowerCase().includes(q);

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

/** Format the per-1M-token price from a model's cost object, in dollars. */
export function formatPrice(cost) {
  if (!cost || typeof cost.input !== 'number') return '';

  // "0.010" -> "0.01", "5.00" is left alone by the caller branch below.
  const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

  const per = (c) => {
    const usd = c / 100; // usd-cents -> dollars
    if (usd === 0) return 'free';
    if (usd < 0.01) return `$${trim(usd.toFixed(4))}`;
    if (usd < 1) return `$${trim(usd.toFixed(3))}`;
    return `$${usd.toFixed(2)}`;
  };

  return `${per(cost.input)} in / ${per(cost.output)} out`;
}

/* ── Message preparation ─────────────────────────────────── */

/**
 * Convert stored messages into the array `puter.ai.chat(messages, …)` expects.
 * System prompt is prepended; images are passed as Puter file parts.
 */
export function toApiMessages(messages, systemPrompt) {
  const out = [];
  const sys = (systemPrompt || '').trim();
  if (sys) out.push({ role: 'system', content: sys });

  for (const msg of messages) {
    if (!msg || msg.deleted) continue;

    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const text = (msg.text || '').trim();

    // An image card carries no prose — its prompt already lives on the user
    // turn above it. Sending "(no text)" would just confuse the model.
    if (msg.kind === 'image') continue;

    if (msg.attachments?.length) {
      const parts = [];
      for (const a of msg.attachments) {
        if (a?.path) {
          // Uploaded to the user's Puter drive — the documented file part.
          parts.push({ type: 'file', puter_path: a.path });
        } else if (a?.dataUrl) {
          // Guest mode: no drive to write to, so send the bytes inline.
          parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
        }
      }
      if (text) parts.push({ type: 'text', text });
      if (parts.length) out.push({ role, content: parts });
      continue;
    }

    if (!text && !msg.images?.length) continue;
    out.push({ role, content: text || '(no text)' });
  }

  return out;
}

/**
 * Run one chat turn.
 *
 * @param {object}   opts
 * @param {Array}    opts.messages   API-format messages
 * @param {string}   opts.model
 * @param {boolean}  opts.stream
 * @param {number}  [opts.temperature]
 * @param {number}  [opts.maxTokens]
 * @param {AbortSignal} [opts.signal]
 * @param {object}  [handlers]       { onText, onReasoning, onImage, onUsage, onError }
 * @returns {Promise<{ text, reasoning, images, usage, usageDetails, finishReason }>}
 */
export async function runTurn(opts, handlers = {}) {
  const {
    messages, model, stream = true,
    temperature, maxTokens, signal,
  } = opts;

  if (!hasPuter()) throw new AIError('Puter.js is not loaded yet.', 'sdk_unavailable');

  const options = { stream };
  if (model) options.model = model;
  if (typeof temperature === 'number') options.temperature = temperature;
  if (Number.isFinite(maxTokens) && maxTokens > 0) options.max_tokens = maxTokens;
  if (signal) options.signal = signal;

  const result = { text: '', reasoning: '', images: [], usage: null, usageDetails: null, finishReason: null };

  /* ── non-streaming ─────────────────────────────────────── */
  if (!stream) {
    const response = await puter.ai.chat(messages, options);
    // `normalize: true` semantics — content may be a string or vendor blocks.
    const content = response?.message?.content;
    result.text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('')
        : '';
    if (typeof response?.message?.reasoning === 'string') result.reasoning = response.message.reasoning;
    if (Array.isArray(response?.message?.images)) result.images = response.message.images;
    result.usage = response?.usage ?? null;
    result.usageDetails = response?.usageDetails ?? null;
    result.finishReason = response?.finish_reason ?? null;

    handlers.onText?.(result.text);
    if (result.reasoning) handlers.onReasoning?.(result.reasoning);
    result.images.forEach((img) => handlers.onImage?.(img));
    if (result.usage || result.usageDetails) {
      handlers.onUsage?.(result.usage, result.finishReason, result.usageDetails);
    }
    return result;
  }

  /* ── streaming ─────────────────────────────────────────── */
  let streamError = null;
  const response = await puter.ai.chat(messages, options);

  for await (const part of response) {
    if (!part) continue;

    switch (part.type) {
      case 'text':
        if (part.text) {
          result.text += part.text;
          handlers.onText?.(part.text, result.text);
        }
        break;

      case 'reasoning':
        if (part.reasoning) {
          result.reasoning += part.reasoning;
          handlers.onReasoning?.(part.reasoning, result.reasoning);
        }
        break;

      case 'image':
        if (part.image) {
          result.images.push(part.image);
          handlers.onImage?.(part.image);
        }
        break;

      case 'usage':
        result.usage = part.usage ?? null;
        // usageDetails is a sibling of usage on the chunk, not a field of it.
        result.usageDetails = part.usageDetails ?? null;
        result.finishReason = part.finish_reason ?? part.stopReason ?? null;
        handlers.onUsage?.(result.usage, result.finishReason, result.usageDetails);
        break;

      case 'error':
        streamError = part.message || 'The model reported an error while streaming.';
        break;

      default:
        // tool_use / compaction / server_tool etc. — nothing to render here.
        break;
    }

    if (streamError) break;
  }

  if (streamError) throw new AIError(describeError(streamError), 'stream_error');

  if (!result.usage && !result.usageDetails) {
    // Provider omitted usage; still finish cleanly.
    handlers.onUsage?.(null, result.finishReason, null);
  }
  return result;
}

/* ── Attachments ─────────────────────────────────────────── */

/**
 * Upload an image into the user's Puter drive so it can be referenced by path.
 * Falls back to a local object when the user isn't signed in — in that case the
 * caller falls back to sending the image inline.
 */
export async function uploadImage(file) {
  if (!hasPuter() || !puter.fs) throw new AIError('Puter storage unavailable.', 'fs_unavailable');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5);
  const name = `chat-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const saved = await puter.fs.write(name, file);
  return { name: file.name, path: saved.path, size: file.size, type: file.type };
}

/** Turn a File into a data URL (used for previews and guest-mode sends). */
export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new AIError('Could not read that file.', 'file_read_failed'));
    fr.readAsDataURL(file);
  });
}

/** Total dollar cost of a usage chunk. Puter reports microcents. */
export function usageCostUsd(usage) {
  if (!usage || typeof usage.cost !== 'number') return null;
  return usage.cost / 1_000_000;
}