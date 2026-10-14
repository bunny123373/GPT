# GPT

A streaming AI chat **and image generation** app built on [Puter.js](https://developer.puter.com).
No backend, no API keys, no server of your own — pick any of 500+ chat models or an image model, and
your conversations are stored in your own Puter account.

![Stack](https://img.shields.io/badge/Next.js-16-000000) ![React](https://img.shields.io/badge/React-19-61dafb) ![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)

**Night by default**, with a light mode and a system-following option — see [Themes](#themes).

---

## Themes

Night is the default. A three-way picker — **Night / Light / System** — lives in Settings, with a
one-click toggle in the topbar. The preference is stored in `localStorage` under `gpt-theme` and
resolved *before first paint* by a small inline script in `app/layout.js`, so a light-mode user never
sees a dark flash. `lib/theme.js` is the whole implementation; `test/theme.js` executes the boot
script against a stub DOM rather than trusting it.

`gpt-theme` is deliberately **not** under the `puter-chat:` prefix: "Delete all data" sweeps every key
with that prefix, and clearing your chats should not also flip the app back to dark.

## Design tokens

Two palettes — warm charcoal and warm off-white — behind one set of names. Every colour utility is
`bg-ink-*`, `text-neutral-*` or a semantic token, and `@theme inline` in `app/globals.css` points each
one at a CSS variable (`--c-*`) that the theme redefines. So `bg-ink-800` means *"the hover surface"*
in both themes, and switching themes re-points every utility at once — no component mentions a
literal colour.

| Token | Role | Night | Light |
|---|---|---|---|
| `--c-sunken` | `bg-ink-950` — sidebar | `#131312` | `#f0eee6` |
| `--c-base` | `bg-ink-900` — canvas | `#1f1e1d` | `#faf9f5` |
| `--c-raised` | `bg-ink-850` — cards | `#262625` | `#ffffff` |
| `--c-hover` | `bg-ink-800` — hovered rows | `#30302e` | `#e8e5dc` |
| `--c-field` | `bg-ink-750` — composer | `#2b2b29` | `#ffffff` |
| `--c-line` | `bg-ink-700` — hairlines | `#3e3e3a` | `#e5e3dc` |
| `--c-line-strong` | `bg-ink-600` — borders | `#52514c` | `#cfccc1` |
| `--c-fg-strong` | `text-neutral-100` | `#f5f4ef` | `#141413` |
| `--c-fg-muted` | `text-neutral-400` | `#a8a69c` | `#6b6a63` |
| `--c-accent` | primary accent | `#d97757` | `#b3542f` |
| `--c-invert-*` | send button | light on dark | dark on light |
| `--c-success` / `--c-danger` | status | `#4ec98f` / `#e5645e` | `#1f7a4d` / `#c4362f` |

The light canvas is a warm off-white rather than `#fff`: a pure-white page against white cards has no
depth. Some elements are intentionally **fixed** — the gallery lightbox and the badges that sit on a
photo use hard light-on-dark values, because they sit on a dark scrim or an image in both themes and
would otherwise invert into dark-on-dark.

Type is **Inter** (400/500/600/700). The composer is a rounded slab and the header is 56px.

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
| **Memories** | Durable facts about you — your tools, your role, how you like answers — applied to *every* chat. Add them by hand, or have the model propose some from a conversation you have already had |
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
| **Light & dark themes** | Night by default, with a light mode and a system-following option |
| **Gallery** | Browse generated images and uploads in a filterable grid |
| **Dark, responsive** | Works down to mobile widths |

## Memories

The profile (Settings → *Ask me*) is a fixed questionnaire: name, role, tone, goals, what to avoid.
Memories are the looser cousin — free-form lines that follow you into **every** chat, so you don't
repeat yourself to a new conversation. Open them from the sidebar; there's also a live count on the
nav item.

Two ways to fill them:

- **By hand.** Type a fact ("Prefers TypeScript over JavaScript"), Add, done.
- **From a conversation.** *Suggest from this chat* sends the conversation to the current model and
  adds whatever it thinks is worth keeping.

Everything is visible, individually deletable, and nothing is written without you seeing it.

Some deliberate choices, because this is the part of the app that stores something you didn't
explicitly type:

- **Extraction is on demand, never automatic.** It costs a model call and a wrong-but-confident fact
  is the failure mode. It runs when you press the button, and the result goes through the same
  review-and-dedupe path as a typed memory.
- **Only your turns are read.** The assistant quoting something back is not evidence you said it;
  reading both directions would let a hallucinated fact about the *assistant* become permanent.
- **Facts, not instructions.** A memory renders as `- The user's timezone is Europe/London`, never
  as "always use X". Instructions in a system prompt get obeyed rather than recalled, and a memory
  is one paraphrase away from turning into a command.
- **Capped and deduplicated.** 60 entries, 240 characters each, case-insensitively deduplicated —
  an unbounded list would grow the system prompt on every request forever.

`lib/memories.js` holds the logic and `test/memories.js` covers it. The parser is the interesting
part: it accepts a fenced array, a chatty preamble, or a bare array, but **rejects**
`{"facts": [...]}` — slicing from the inner `[` to the outer `]` parses as valid JSON and would
silently accept an object as if it were the list, storing nothing while reporting success.

## Run it

```bash
cd "puter chat"
npm install
npm run dev          # http://localhost:3000
```

For a production run:

```bash
npm run build
npm start
```

Puter identifies an app by its origin, so it must be served over HTTP either way.

Then open the URL, sign in with Puter (optional), and start chatting.

## Modes

An **Image** toggle sits inside the message box (it lights up in the accent colour and shows an ✕ when active, plus
shape and quality controls above the input). **Create image** in the sidebar starts a fresh
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
npm test           # everything below, plus the static-asset guard
npm run test:unit  # markdown, chat engine, image generation, profile, storage
npm run test:theme # the theme store and the pre-paint boot script
npm run test:memories
npm run test:gallery
npm run test:css   # rebuilds, then checks every class token compiles
npm run test:sdk   # fetches the live Puter.js bundle and checks the API surface
```

**681 assertions across ten suites.** The unit suites run against a fake `puter` global, so they
cover streaming, aborts, error chunks, reasoning, images, image option building, quality-tier
whitelisting, usage capture, the 400 KB KV ceiling, Markdown XSS escaping and theme resolution
without needing a browser or an account. The theme suite goes a step further and *executes* the
pre-paint boot script against a stub DOM, because a script that must run before React exists is
exactly the kind of code that silently stops working. `test/tokens.mjs` then checks the stylesheet
itself: both palettes must declare the same tokens, every `var(--c-*)` must resolve, every colour that
has to differ between themes must actually differ, and every text tone must clear a contrast floor
against its own canvas — a token missing from one palette does not error, it just inherits the wrong
value and leaves one unreadable element. That last check is not theoretical: it caught the accent
landing at 4.0:1 on cream when the overnight value had looked fine.

`test:css` is the safety net for styling: it walks every `className` in `app/` and `components/`,
then asserts each Tailwind token actually appears in the compiled stylesheet — the usual cause of
"the CSS looks wrong" is a utility that silently failed to generate.

## How it works

```
app/layout.js         <html>, the pre-paint theme script, fonts, metadata
app/page.js           the client shell: view state, chat flow, gallery wiring
app/globals.css       design tokens, both palettes, markdown styles
components/           Sidebar, Composer, Message, Gallery, ModelMenu, Dialogs,
                      AccountMenu, ThemePicker, icons
lib/ai.js             chat: everything that talks to puter.ai.chat (models, uploads, errors)
lib/imagegen.js       image generation: puter.ai.txt2img, model catalogue, option building
lib/store.js          persistence adapter: puter.kv, falling back to localStorage
lib/conversations.js  conversation model, titles, size limits
lib/gallery.js        gallery data layer: classify, sort, filter, scan the drive
lib/memories.js       durable per-user facts: prompt rendering, merging, extraction parsing
lib/theme.js          theme store + the boot script
lib/markdown.js       dependency-free Markdown renderer
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

It is a Next.js app, so it needs a build step — any Node host works, and Vercel is the least fuss:

```bash
npx vercel --prod        # first run links/creates the project
```

No environment variables and no secrets to leak: everything talks to Puter from the browser.

## Notes

- AI output can be wrong. Verify anything that matters.
- You pay the model provider directly through Puter's user-pays model; the price shown in
  the picker is what you pay.
- Reasoning models may ignore `temperature` — that's the model's choice, not a bug here.