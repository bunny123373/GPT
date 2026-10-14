# GPT

A streaming AI chat **and image generation** app built on [Puter.js](https://developer.puter.com).
No backend, no API keys, no build step — pick any of 500+ chat models or an image model, and your
conversations are stored in your own Puter account.

![Stack](https://img.shields.io/badge/vanilla-JS-f7df1e) ![Deps](https://img.shields.io/badge/dependencies-0-3ddc97)

The visual language — palette, component metrics, markdown treatment and motion — is adopted from
the reference design in `C:\Users\korra\Downloads\chat`.

---

## Design tokens

| Token | Value | Used for |
|---|---|---|
| `--ink-950` | `#171717` | Sidebar |
| `--ink-900` | `#212121` | Canvas |
| `--ink-800` | `#2f2f2f` | Rows, dialogs, model menu |
| `--ink-750` | `#303030` | Composer, user bubble |
| `--ink-700` | `#3a3a3a` | Hairlines, scrollbars |
| `--ink-600` | `#4a4a4a` | Borders |
| `--accent` | `#10a37f` | Image mode, focus rings |
| `--link` | `#7ab7ff` | Markdown links |

Type is **Inter** (400/500/600/700). The composer is a 28px-radius `#303030` slab and the header
is 56px — both matching the reference.

## Responsive layout

Five bands, defined in `css/styles.css` and covered by `npm run test:layout`:

| Band | Width | Behaviour |
|---|---|---|
| **Narrow phone** | ≤ 400px | Tighter pills, icon-only Image toggle, 16px input (stops iOS zoom-on-focus) |
| **Phone** | ≤ 767px | Sidebar becomes a scrim overlay, one column, token stats hidden |
| **Tablet** | 768–1023px | Sidebar persists but narrows to 240px, content caps at 600px, roomier rows |
| **Desktop** | ≥ 1024px | Full 260px sidebar, 660px content column |
| **Ultra-wide** | ≥ 1600px | Column stays at 660px and simply centres |

The content column is **660px**, which at 15px Inter is roughly **84 characters per line**. The
comfortable reading band is 45–75; this runs a little wider on purpose so code blocks and generated
images still fit without being squeezed. `npm run test:layout` fails if that measure ever creeps
back past ~90 characters.

Plus three cross-cutting bands:

- **Landscape phones** (`max-height: 560px and orientation: landscape`) — disclaimer hidden,
  textarea capped at 120px, greeting compacted, so a 375px-tall screen still has a reading area.
- **Touch** (`hover: none`) — hit targets grow to 40px, delete buttons stay visible.
- **Small screens** (`max-width: 520px`) — dialogs go near full-bleed and only the body scrolls.

Notch and home-indicator insets flow from `--safe-t/r/b/l` (`env(safe-area-inset-*)`) into the
topbar, composer and content column. The app is `100dvh` with a `100vh` fallback, so mobile browser
chrome collapsing doesn't clip the composer.

The phone/tablet boundary lives in **one** place: `MOBILE_MAX` in `js/app.js`, asserted against the
CSS overlay breakpoint by the test suite. If those two ever drift, JS collapses the sidebar while
CSS still lays it out as a persistent column — which is exactly what happened before this check
existed.

## Account & usage menu

The **account row at the bottom of the sidebar** — the only place your profile lives — opens a
ChatGPT-style menu reading **live** data from your Puter account. Nothing is hardcoded or cached.

| Row | Source | Shows |
|---|---|---|
| Account | `puter.auth.getUser()` | Avatar, username |
| Storage | `puter.fs.space()` | Used of capacity, with a usage bar |
| This month | `puter.auth.getMonthlyUsage()` | Call count and spend for **this app**, plus remaining allowance |

Two details worth knowing:

- **Units.** Puter reports resources in **microcents** (`$0.01 = 1,000,000`), and storage in raw
  bytes. `usd()` and `bytes()` in `app.js` convert both; skipping that would show `$0.0000`.
- **Scope.** `getMonthlyUsage()` returns *account-wide* data, but `appTotals` is keyed by app id.
  The menu sums only the entry matching `puter.appID`, so the number is this app's spend, not
  everything you've run on Puter.

Each API call is wrapped independently. If you're signed out, or `fs.space()` is unavailable,
that row is simply omitted — one failing call never blanks the menu.

## Message treatment

Following ChatGPT: **your messages are rounded bubbles** pushed to the right, with the text
**left-aligned inside** the bubble. The bubble **shrinks to fit its text** (`width: fit-content`)
but is capped at 98% of the column, so short messages stay tight while long ones use the full
width. An earlier fixed-width version put a two-word message in a mostly-empty 650px box.
Replies are full-width plain text with no bubble and no avatar.

Long words wrap at the word boundary rather than being chopped mid-character
(`overflow-wrap: break-word`, not `anywhere`), and nothing is shrunk to fit.

`npm run test:layout` asserts all of that, so the treatment can't quietly drift.

## Features

| | |
|---|---|
| **500+ chat models** | Live catalogue via `puter.ai.listModels()`, grouped by provider, searchable, with real per-1M-token prices |
| **Image generation** | GPT Image, Gemini, Grok, FLUX, Seedream and more, with aspect ratio and per-model quality tiers |
| **Image-to-image** | Attach or paste a reference image and ask for a variation |
| **Test mode** | Generate a sample image without spending credits |
| **Streaming** | Token-by-token rendering with a Stop button, cancellable mid-response via `AbortSignal` |
| **Your chats, your cloud** | Persisted in Puter's key-value store — signed in, they follow you across devices |
| **Guest mode** | Not signed in? Everything still works, stored locally in `localStorage` |
| **Image input in chat** | Attach or paste images; they're uploaded to your Puter drive and passed to the model by path |
| **Markdown** | Custom zero-dependency renderer: code blocks with copy, tables, lists, quotes |
| **Reasoning models** | Optional collapsible "Model reasoning" panel for thinking models |
| **Token & cost stats** | Live input/output token counts and the exact dollar cost of each reply |
| **Regenerate / copy / delete** | Per-message actions |
| **Anchored model picker** | Dropdown under the header button, searchable, grouped by provider, with live pricing — no full-screen takeover |
| **Account & usage menu** | ChatGPT-style avatar dropdown showing your real Puter storage, this month's calls and spend, plus Settings and sign-out |
| **Export** | Markdown (or Shift+click for JSON) |
| **Dark, responsive** | Works down to mobile widths |

## Run it

Puter identifies an app by its origin, so the app **must be served over HTTP**. Opening
`index.html` from disk (`file://`) will not work.

```bash
cd "puter chat"
npm start            # http://localhost:3000
```

Any static server works just as well:

```bash
python -m http.server 8000      # then open http://localhost:8000
npx serve .
```

Then open the URL, sign in with Puter (optional), and start chatting.

## Modes

An **Image** toggle sits inside the message box (it turns green and shows an ✕ when active, plus
shape / quality / test controls above the input). **Create image** in the sidebar starts a fresh
chat already in that mode.

Generated images land in the conversation as a square card that breathes while it renders, then
fades in — with download, copy-prompt, regenerate and *Save to Puter drive*.

## Keyboard

| Key | Action |
|---|---|
| `Enter` | Send / generate (only on fine-pointer devices, so touch keyboards still insert newlines) |
| `Shift` + `Enter` | New line |
| `Ctrl`/`Cmd` + `K` | Focus chat search |
| `Ctrl`/`Cmd` + `B` | Collapse / expand sidebar |
| `Ctrl`/`Cmd` + `N` | New chat |
| `Esc` | Close dialog / sidebar |

## Tests

```bash
npm test           # everything
npm run test:unit  # markdown, chat engine, image generation, storage — no network
npm run test:dom   # app.js ↔ index.html ↔ styles.css contract
npm run test:sdk   # fetches the live Puter.js bundle and checks the API surface
```

229 assertions across five suites. The unit suites run against a fake `puter` global, so they
cover streaming, aborts, error chunks, reasoning, images, image option building, quality-tier
whitelisting, usage capture, the 400 KB KV ceiling and Markdown XSS escaping without needing a
browser or an account.

## How it works

```
index.html          markup + dialogs
css/styles.css      all styling
js/app.js           UI wiring, chat flow, image flow, streaming render loop
js/ai.js            chat: everything that talks to puter.ai.chat (models, uploads, errors)
js/imagegen.js      image generation: puter.ai.txt2img, model catalogue, option building
js/store.js         persistence adapter: puter.kv, falling back to localStorage
js/conversations.js conversation model, titles, size limits
js/markdown.js      dependency-free Markdown renderer
server.js           zero-dependency static server for local dev
```

**Storage.** Each conversation is one item inside a single KV entry keyed by its id
(`puter.kv.update('conversations', { [id]: conv })`), rather than an entry in an array. With
an array, a delete in one tab shifts the indexes and another tab edits the wrong chat. Writes
touch one path, so two tabs editing two different chats never clobber each other.

One KV value caps at 400 KB. `conversations.save()` measures the payload and, if it would
overflow, keeps the newest half of the exchange and flags the chat as *trimmed* in the
sidebar — the live session is unaffected.

**Streaming.** `runTurn()` walks the async iterator and dispatches each chunk by type
(`text`, `reasoning`, `image`, `usage`, `error`). The UI re-renders on `requestAnimationFrame`
rather than per chunk, so a fast model doesn't thrash layout. Provider errors arrive as an
`error` chunk rather than a rejection, so those are checked explicitly; network failures,
timeouts and malformed streams throw and are surfaced with a readable message.

**Image models live somewhere else.** `puter.ai.listModels()` lists *chat* models only. Image
models come from a separate driver — `puter.drivers.call('puter-image-generation', 'models', {})`
— so `js/imagegen.js` has its own catalogue with a built-in fallback list if that driver is
unreachable.

**Quality tiers are whitelisted per model, never guessed.** Gemini rejects an unsupported tier
with `bad_request` *before* it checks credits, so `qualityTiersFor()` returns the exact list each
model accepts and `buildOptions()` omits the key entirely when it isn't sure. The quality control
disappears for models with no tier concept (FLUX, Grok) rather than showing options that would fail.

**Generated images are saved to your drive.** `txt2img` often returns a temporary hosted URL, which
would 404 the moment you reopened the chat. When you're signed in we pass `puter_output_path` so the
image lands in `puter-chat/` in your Puter drive, then re-mint a fresh read URL via
`puter.fs.getReadURL()` on load. An image that fails to load says so instead of showing a broken icon.

**Security.** Model output is untrusted input. `markdown.js` escapes all HTML before any
inline transformation runs, and URLs are restricted to `http(s):`, `mailto:`, `tel:`, and
`data:image/*` — so `javascript:` links and `onerror=` payloads render as inert text. There
are 7 assertions covering this in `test/run.js`. Separately, every value that reaches the DOM
goes through `asText()`, so a JSON rejection can never surface as literal `[object Object]`.

## Deploying

The app is fully static, so any static host works:

```bash
npx @heyputer/cli deploy          # or:
# GitHub Pages, Netlify, Vercel, Cloudflare Pages — just upload the directory
```

No server-side code, no environment variables, no secrets to leak.

## Notes

- AI output can be wrong. Verify anything that matters.
- You pay the model provider directly through Puter's user-pays model; the price shown in
  the picker is what you pay.
- Reasoning models may ignore `temperature` — that's the model's choice, not a bug here.