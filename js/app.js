/**
 * Next GPT — application shell.
 *
 * Layout rules that shape this file:
 *  - the composer is a single DOM node physically moved between the centred
 *    empty-state slot and the bottom dock, so its state and focus survive
 *  - only the newest Next GPT reply carries an action row
 *  - the sidebar groups chats by date and collapses
 */

import { renderMarkdown, toPlainText } from './markdown.js';
import { store } from './store.js';
import {
  ModelCatalogue, runTurn, toApiMessages, uploadImage, readAsDataURL,
  describeError, asText, formatPrice, usageCostUsd,
} from './ai.js';
import {
  ImageCatalogue, generateImage, imageOutputPath, readURL,
  qualityTiersFor, ASPECT_RATIOS,
} from './imagegen.js';
import {
  listAll, save, saveSync, remove, clearAll,
  loadSettings, saveSettings, clearSettings,
  loadProfile, saveProfile, clearProfile,
  newConversation, newMessage, deriveTitle, dateGroup,
} from './conversations.js';
import {
  TONES, BLANK_PROFILE, hasProfile, profilePrompt, profileSummary,
  effectiveSystemPrompt,
} from './profile.js';

const catalogue = new ModelCatalogue();
const imageCatalogue = new ImageCatalogue();

const state = {
  conversations: [],
  currentId: null,
  settings: null,
  mode: 'chat',          // 'chat' | 'image' — driven by the Image toggle
  profile: { ...BLANK_PROFILE },
  streaming: false,
  controller: null,
  attachments: [],
  previews: new Map(),   // messageId -> data URL[], memory only
};

/* ── DOM ─────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  gate: $('gate'),
  gateSignin: $('gate-signin'),
  gateError: $('gate-error'),
  gateSkip: $('gate-skip'),
  stage: $('stage'),
  scrim: $('scrim'),
  collapse: $('btn-collapse'),
  expand: $('btn-expand'),
  logoNew: $('btn-logo-new'),
  sideImage: $('btn-side-image'),

  convList: $('conv-list'),
  search: $('chat-search'),
  thread: $('thread'),
  threadWrap: $('thread-wrap'),

  composerWrap: $('composer-wrap'),
  composer: $('composer'),
  composerHint: $('composer-hint'),
  centerSlot: $('composer-center'),
  pillsHost: $('pills-host'),
  dock: $('composer-dock'),
  imgBar: $('composer-imgbar'),
  imgToggle: $('btn-image-toggle'),
  imgToggleX: $('img-toggle-x'),

  input: $('input'),
  send: $('btn-send'),
  sendIcon: document.querySelector('.ico--send'),
  stopIcon: document.querySelector('.ico--stop'),
  attach: $('btn-attach'),
  fileInput: $('file-input'),
  attachments: $('attachments'),
  newChat: $('btn-new-chat'),

  topStats: $('topbar-stats'),
  modelBtn: $('btn-model'),
  modelName: $('btn-model-name'),
  modelMenu: $('model-menu'),
  modelSearch: $('model-search'),
  modelList: $('model-list'),
  modelCount: $('model-count'),
  settingsDialog: $('settings-dialog'),
  toasts: $('toasts'),

  accountAvatar: $('account-avatar'),
  accountName: $('account-name'),
  accountSub: $('account-sub'),
  accountBtn: $('btn-account'),
  accountMenu: $('account-menu'),
  acctAvatar: $('acct-avatar'),
  acctName: $('acct-name'),
  acctSub: $('acct-sub'),
  acctStats: $('acct-stats'),
  acctSettings: $('acct-settings'),
  acctAuth: $('acct-auth'),
  acctAuthLabel: $('acct-auth-label'),
  acctAuthIcon: $('acct-auth-icon'),

  imgRatio: $('img-ratio'),
  imgQuality: $('img-quality'),
  imgQualityWrap: $('img-quality-wrap'),
  imgTest: $('img-test'),

  setSystem: $('set-system'),
  setTemp: $('set-temp'),
  setTempOut: $('set-temp-out'),
  setMax: $('set-max'),
  setStream: $('set-stream'),
  setReasoning: $('set-reasoning'),

  askMe: $('btn-ask-me'),
  profileBadge: $('profile-badge'),
  profileDialog: $('profile-dialog'),
  pfName: $('pf-name'),
  pfAccount: $('pf-account'),
  pfRole: $('pf-role'),
  pfTone: $('pf-tone'),
  pfToneHint: $('pf-tone-hint'),
  pfGoals: $('pf-goals'),
  pfAvoid: $('pf-avoid'),
  pfPreview: $('pf-preview'),
  pfSave: $('btn-profile-save'),
  pfClear: $('btn-profile-clear'),
};

/** System prompt actually sent: the user's base prompt plus their profile. */
const sysPrompt = () => effectiveSystemPrompt(state.settings.systemPrompt, state.profile);

const current = () => state.conversations.find((c) => c.id === state.currentId) || null;

/**
 * Phone/tablet boundary. MUST match the media query in css/styles.css that
 * turns the sidebar into an overlay — if these drift apart, JS collapses the
 * sidebar while CSS still lays it out as a persistent column.
 */
const MOBILE_MAX = 767;
const isMobile = () => window.matchMedia(`(max-width: ${MOBILE_MAX}px)`).matches;

const CHAT_PILLS = [
  { label: 'Help me write', tone: 'violet', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z', prompt: 'Help me write a friendly, professional email asking my manager for a day off next Friday.' },
  { label: 'Explain something', tone: 'sky', icon: 'M22 10 12 5 2 10l10 5 10-5ZM6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5', prompt: 'Explain how the stock market works in simple terms, with an example.' },
  { label: 'Code', tone: 'rose', icon: 'm16 18 6-6-6-6M8 6l-6 6 6 6', prompt: 'Write a JavaScript function that checks whether a string is a palindrome, and explain how it works.' },
  { label: 'Brainstorm', tone: 'amber', icon: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z', prompt: 'Give me 10 creative weekend activity ideas for a rainy day.' },
  { label: 'Make a plan', tone: 'teal', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', prompt: 'Make me a simple 4-week beginner workout plan I can do at home.' },
];

const IMAGE_PILLS = [
  { label: 'Cozy cabin', tone: 'emerald', icon: 'M3 21h18M5 21V9l7-6 7 6v12', prompt: 'A cozy cabin in a snowy forest at dusk, warm light glowing from the windows, cinematic' },
  { label: 'Retro poster', tone: 'amber', icon: 'M4 4h16v16H4zM4 10h16M10 4v16', prompt: 'A 1970s retro travel poster for Mars, bold flat colours, screen print texture' },
  { label: 'Flat illustration', tone: 'violet', icon: 'M12 3 2 8l10 5 10-5-10-5ZM2 16l10 5 10-5M2 12l10 5 10-5', prompt: 'A flat vector illustration of a sleeping cat curled on a stack of books' },
  { label: 'Isometric', tone: 'sky', icon: 'm12 2 9 5v10l-9 5-9-5V7l9-5ZM12 12v10M12 12 3 7M12 12l9-5', prompt: 'An isometric view of a tiny cosy library, cutaway, lots of plants' },
  { label: 'Bioluminescent', tone: 'teal', icon: 'M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4', prompt: 'A bioluminescent forest at midnight, glowing mushrooms, deep blues and greens' },
];

/* ── Small helpers ───────────────────────────────────────── */

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ` toast--${kind}` : '');
  node.textContent = asText(message);
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, kind === 'err' ? 5200 : 2600);
}

function isNearBottom() {
  return el.threadWrap.scrollHeight - el.threadWrap.scrollTop - el.threadWrap.clientHeight < 140;
}

function scrollToEnd(force = false) {
  if (force || isNearBottom()) {
    el.threadWrap.scrollTo({ top: el.threadWrap.scrollHeight, behavior: 'smooth' });
  }
}

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.remove();
    toast(ok ? label : 'Could not copy', ok ? 'ok' : 'err');
  }
}

function download(filename, text, type = 'text/markdown') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => (s || 'chat').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 48) || 'chat';

/* ── Sidebar ─────────────────────────────────────────────── */

function setSidebarCollapsed(collapsed) {
  el.app.classList.toggle('sidebar-collapsed', collapsed);
  el.expand.hidden = !collapsed;
  // On narrow screens the sidebar is an overlay; collapse means "closed".
  if (!collapsed) el.app.classList.add('nav-open');
  else el.app.classList.remove('nav-open');
}

function renderSidebar() {
  const q = el.search.value.trim().toLowerCase();
  const list = state.conversations.filter((c) => {
    if (!q) return true;
    if (asText(c.title, '').toLowerCase().includes(q)) return true;
    return c.messages.some((m) => (m.text || '').toLowerCase().includes(q));
  });

  el.convList.innerHTML = '';
  if (!list.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = q ? 'No chats match that search.' : 'No chats yet.';
    el.convList.appendChild(hint);
    return;
  }

  let lastGroup = null;
  for (const conv of list) {
    const group = dateGroup(conv.updatedAt || conv.createdAt || Date.now());
    if (group !== lastGroup) {
      lastGroup = group;
      const head = document.createElement('div');
      head.className = 'conv-group';
      head.textContent = group;
      el.convList.appendChild(head);
    }

    const row = document.createElement('div');
    row.className = 'conv' + (conv.id === state.currentId ? ' active' : '');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'conv__open';
    open.textContent = asText(conv.title, 'New chat');
    open.title = asText(conv.title, 'New chat');
    open.addEventListener('click', () => selectConversation(conv.id));
    row.appendChild(open);

    if (conv.trimmed) {
      const flag = document.createElement('span');
      flag.className = 'conv__flag';
      flag.textContent = 'trimmed';
      flag.title = "Older messages were dropped to fit Puter's storage limit.";
      row.appendChild(flag);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'conv__del';
    del.title = 'Delete chat';
    del.setAttribute('aria-label', `Delete "${asText(conv.title, 'chat')}"`);
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteConversation(conv.id); });
    row.appendChild(del);

    el.convList.appendChild(row);
  }
}

function renderAccount() {
  const user = store.user;

  if (store.signedIn && user) {
    const name = asText(user.username, '') || asText(user.name, '') || 'Puter user';
    el.accountName.textContent = name;
    el.accountSub.textContent = store.isCloud ? 'Synced to your Puter account' : 'Saved on this device';
    el.accountAvatar.textContent = name.slice(0, 1).toUpperCase();
    el.accountBtn.title = `${name} — account & usage`;
    el.accountBtn.setAttribute('aria-label', `Account: ${name}`);
    puter.auth.getProfilePicture?.()
      .then((pic) => {
        if (!pic) return;
        el.accountAvatar.style.backgroundImage = `url(${pic})`;
        el.acctAvatar.style.backgroundImage = `url(${pic})`;
      })
      .catch(() => {});
  } else {
    el.accountName.textContent = 'Guest';
    el.accountSub.textContent = store.isCloud ? 'Sign in to sync chats' : 'Saved on this device';
    el.accountAvatar.textContent = '?';
    el.accountAvatar.style.backgroundImage = '';
    el.accountBtn.title = 'Guest — sign in';
    el.accountBtn.setAttribute('aria-label', 'Account: guest, sign in');
  }
}

/* ── Composer placement ──────────────────────────────────── */

/** Empty chat -> composer sits under the greeting; otherwise it docks. */
function placeComposer(hasMessages) {
  const target = hasMessages ? el.dock : el.centerSlot;
  if (el.composerWrap.parentElement !== target) target.appendChild(el.composerWrap);
  el.stage.classList.toggle('is-empty', !hasMessages);
}

/* ── Messages ────────────────────────────────────────────── */

/** The newest Next GPT reply that has prose — this is what actions hang off. */
function latestReplyId() {
  const conv = current();
  if (!conv) return null;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role === 'assistant' && m.kind !== 'image' && m.text?.trim()) return m.id;
  }
  return null;
}

function replyActions(msg) {
  const row = document.createElement('div');
  row.className = 'reply-actions';

  const add = (label, icon, title, fn, variant) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ract' + (variant ? ` ract--${variant}` : '');
    b.title = title;
    b.innerHTML = `${icon}<span>${label}</span>`;
    b.addEventListener('click', fn);
    row.appendChild(b);
  };

  const ICON_COPY = '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_REDO = '<svg viewBox="0 0 24 24" class="ico"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  const ICON_IMAGE = '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15.5 20.5 18l2.5 1.5-2.5 1.5L19 23l-1.5-2L15 19.5 17.5 18 19 15.5Z"/></svg>';

  add('Copy', ICON_COPY, 'Copy this reply', () => copyText(msg.text || '', 'Reply copied'));
  add('Regenerate', ICON_REDO, 'Answer again', () => regenerate(msg.id));
  add('Show me an image.', ICON_IMAGE, 'Turn this reply into an image', () => showImage(msg.id), 'image');

  const stamp = document.createElement('span');
  stamp.className = 'conv__flag';
  stamp.style.marginLeft = '6px';
  stamp.textContent = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  row.appendChild(stamp);

  return row;
}

/** Download a generated image; falls back to opening it in a new tab. */
async function downloadImage(src, filename) {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Image downloaded', 'ok');
  } catch {
    window.open(src, '_blank', 'noopener');
  }
}

async function saveImageToDrive(msg, src) {
  if (typeof puter === 'undefined' || !puter?.fs?.write) {
    toast('Puter storage unavailable.', 'err');
    return null;
  }
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const saved = await puter.fs.write(imageOutputPath(msg.prompt), blob);
    msg.savedPath = saved.path;
    toast('Saved to your Puter drive', 'ok');
    return saved.path;
  } catch (err) {
    toast(describeError(err), 'err');
    return null;
  }
}

function imageCardEl(msg) {
  const card = document.createElement('div');
  card.className = 'imgcard';
  if (msg.pending) card.classList.add('imgcard--pending');

  const frame = document.createElement('div');
  frame.className = 'imgcard__frame';

  const src = asText(msg.images?.[0]?.image_url?.url ?? msg.images?.[0]?.url, '');

  const note = (iconPath, text) => {
    const wrap = document.createElement('div');
    wrap.className = 'imgcard__note';
    if (iconPath) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'ico');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', iconPath);
      svg.appendChild(p);
      wrap.appendChild(svg);
    }
    const t = document.createElement('span');
    if (msg.pending) t.className = 'shimmer-text';
    t.textContent = text;
    wrap.appendChild(t);
    return wrap;
  };

  const SPARKLE = 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z';

  if (msg.pending) {
    frame.appendChild(note(SPARKLE, 'Creating image…'));
  } else if (src) {
    const img = document.createElement('img');
    img.alt = asText(msg.prompt, 'Generated image');
    img.loading = 'lazy';
    // Fade in once decoded, the way the reference design does.
    img.addEventListener('load', () => img.classList.add('is-loaded'));
    img.addEventListener('error', () => {
      if (!frame.isConnected) return;
      frame.replaceChildren(note(null, msg.savedPath
        ? 'Could not load this image. Try downloading it again.'
        : 'Image link expired — regenerate to view it.'));
    });
    frame.appendChild(img);
    img.src = src;
    if (img.complete && img.naturalWidth) img.classList.add('is-loaded');
  } else {
    frame.appendChild(note(null, msg.error ? '' : 'No image returned.'));
  }
  card.appendChild(frame);

  if (msg.prompt) {
    const p = document.createElement('div');
    p.className = 'imgcard__prompt';
    p.textContent = asText(msg.prompt, '');
    p.title = asText(msg.prompt, '');
    card.appendChild(p);
  }

  const bits = [asText(msg.model, ''), msg.imageMeta?.ratio, msg.imageMeta?.quality].filter(Boolean);
  if (bits.length) {
    const meta = document.createElement('div');
    meta.className = 'imgcard__meta';
    meta.innerHTML = `<span class="ract" style="pointer-events:none">${bits.join(' · ')}${msg.savedPath ? ' · saved' : ''}</span>`;
    card.appendChild(meta);
  }

  if (msg.error) {
    const err = document.createElement('div');
    err.className = 'msg__err';
    err.textContent = asText(msg.error, 'The request failed.');
    card.appendChild(err);
  }

  const bar = document.createElement('div');
  bar.className = 'imgcard__bar';

  const add = (title, icon, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ract';
    b.title = title;
    b.innerHTML = `${icon}<span>${title}</span>`;
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };

  const ICON_DL = '<svg viewBox="0 0 24 24" class="ico"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
  const ICON_COPY = '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICON_REDO = '<svg viewBox="0 0 24 24" class="ico"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

  if (src) add('Download', ICON_DL, () => downloadImage(src, `${slug(msg.prompt || 'image')}.png`));
  if (msg.prompt) add('Copy prompt', ICON_COPY, () => copyText(msg.prompt, 'Prompt copied'));
  if (!msg.savedPath && store.signedIn && src) {
    add('Save to drive', ICON_DL, async () => { if (await saveImageToDrive(msg, src)) renderThread(); });
  }
  if (!msg.pending) add('Regenerate', ICON_REDO, () => regenerate(msg.id));
  add('Delete', ICON_TRASH, () => deleteMessage(msg.id));

  card.appendChild(bar);
  return card;
}

function messageEl(msg, isLatestReply) {
  const wrap = document.createElement('div');
  wrap.className = `msg msg--${msg.role}`;
  wrap.dataset.id = msg.id;

  const body = document.createElement('div');
  body.className = 'msg__body';

  // Image results carry their own actions.
  if (msg.kind === 'image') {
    body.appendChild(imageCardEl(msg));
    wrap.appendChild(body);
    return wrap;
  }

  if (msg.attachments?.length || msg.images?.length || state.previews.get(msg.id)?.length) {
    const imgs = document.createElement('div');
    imgs.className = 'msg-imgs';
    const urls = [
      ...(msg.images || []).map((i) => asText(i?.image_url?.url ?? i?.url, '')),
      ...(state.previews.get(msg.id) || []),
    ].filter((u) => typeof u === 'string' && u);
    for (const url of urls) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'attachment';
      img.loading = 'lazy';
      imgs.appendChild(img);
    }
    body.appendChild(imgs);
  }

  if (msg.reasoning) {
    const think = document.createElement('details');
    think.className = 'think';
    const summary = document.createElement('summary');
    summary.textContent = 'Model reasoning';
    const pre = document.createElement('div');
    pre.className = 'think__body';
    pre.textContent = msg.reasoning;
    think.append(summary, pre);
    body.appendChild(think);
  }

  const content = document.createElement('div');
  if (msg.role === 'user') {
    content.className = 'user-bubble';
    content.textContent = msg.text || '';
  } else {
    content.className = 'md';
    content.innerHTML = renderMarkdown(msg.text || '');
    // Nothing yet and still working: a pulsing dot instead of a blank line.
    if (msg.streaming && !msg.text) content.innerHTML = '<span class="thinking-dot"></span>';
  }
  body.appendChild(content);

  if (msg.error) {
    const err = document.createElement('div');
    err.className = 'msg__err';
    err.textContent = asText(msg.error, 'The request failed.');
    body.appendChild(err);
  }

  // Actions live under the newest reply only.
  if (isLatestReply && !state.streaming) body.appendChild(replyActions(msg));

  wrap.appendChild(body);
  return wrap;
}

function renderGreeting() {
  const isImage = state.mode === 'image';
  const greet = document.createElement('div');
  greet.className = 'greet';
  greet.innerHTML =
    `<h1 class="greet__title">Ask Next GPT anything.</h1>` +
    `<p class="greet__sub">${isImage
      ? 'Describe a picture and any image model will draw it.'
      : 'Ask anything — 500+ models, one place, your data stays in your Puter account.'}</p>`;
  return greet;
}

function renderPills() {
  const wrap = document.createElement('div');
  wrap.className = 'pills';
  const items = state.mode === 'image' ? IMAGE_PILLS : CHAT_PILLS;
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pill pill--${item.tone}`;
    b.title = item.prompt;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ico');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', item.icon);
    svg.appendChild(path);
    b.appendChild(svg);

    const label = document.createElement('span');
    label.textContent = item.label;
    b.appendChild(label);

    b.addEventListener('click', () => {
      el.input.value = item.prompt;
      autoGrow();
      send();
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function renderThread({ forceScroll = false } = {}) {
  const conv = current();
  const hasMessages = !!conv?.messages.length;
  placeComposer(hasMessages);

  el.thread.innerHTML = '';
  el.pillsHost.innerHTML = '';
  if (!hasMessages) {
    // Vertical order: greeting, composer (already in the centre slot), pills.
    el.thread.appendChild(renderGreeting());
    el.pillsHost.appendChild(renderPills());
  } else {
    // No action row while a reply is being written — it would flicker between
    // the previous reply and the new one.
    const latest = state.streaming ? null : latestReplyId();
    for (const msg of conv.messages) {
      if (msg.deleted) continue;
      el.thread.appendChild(messageEl(msg, msg.id === latest));
    }
  }

  // The disclaimer only makes sense once there is a conversation on screen.
  el.composerHint.hidden = !hasMessages;

  // Title tracks the open chat, like the reference design.
  document.title = hasMessages
    ? `${asText(conv.title, 'Chat')} · Next GPT`
    : 'Next GPT — AI Chat & Images';

  requestAnimationFrame(() => {
    if (hasMessages) scrollToEnd(forceScroll);
    else el.threadWrap.scrollTop = 0;
  });
}

function renderTopbar() {
  const isImage = state.mode === 'image';
  const cat = isImage ? imageCatalogue : catalogue;
  const id = isImage ? state.settings.imageModel : state.settings.model;
  const m = cat.get(id);
  el.modelName.textContent = asText(m?.name, '') || asText(id, 'Select a model');
  el.modelBtn.title = asText(id, '');
}

function renderImageControls() {
  if (!el.imgRatio.options.length) {
    for (const r of ASPECT_RATIOS) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.id;
      el.imgRatio.appendChild(o);
    }
  }
  el.imgRatio.value = state.settings.imageRatio || '1:1';

  const tiers = qualityTiersFor(state.settings.imageModel);
  el.imgQualityWrap.hidden = tiers.length === 0;
  el.imgQuality.innerHTML = '';
  for (const t of tiers) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    el.imgQuality.appendChild(o);
  }
  const wanted = tiers.includes(state.settings.imageQuality) ? state.settings.imageQuality : tiers[0];
  el.imgQuality.value = wanted ?? '';
  if (state.settings.imageQuality !== wanted) {
    state.settings.imageQuality = wanted ?? '';
    saveSettings({ imageQuality: state.settings.imageQuality });
  }

  el.imgTest.checked = !!state.settings.imageTest;
}

function setMode(mode) {
  state.mode = mode === 'image' ? 'image' : 'chat';
  el.imgToggle.setAttribute('aria-pressed', String(state.mode === 'image'));
  el.imgToggleX.hidden = state.mode !== 'image';
  el.imgBar.hidden = state.mode !== 'image';
  el.input.placeholder = state.mode === 'image' ? 'Describe an image' : 'Message Next GPT…';
  el.attach.title = state.mode === 'image' ? 'Attach a reference image' : 'Attach an image';
  renderImageControls();
  renderTopbar();
  renderThread();
  updateComposerState();
}

function renderAll({ forceScroll = false } = {}) {
  renderSidebar();
  renderThread({ forceScroll });
  renderTopbar();
  renderAccount();
}

/* ── Account menu: live Puter account + usage ────────────── */

const bytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};

// Puter reports resources in microcents ($0.01 = 1,000,000).
const usd = (microcents) =>
  Number.isFinite(miccents) ? `$${(microcents / 1_000_000).toFixed(4)}` : '—';

const stat = (label, value, extra) => {
  const row = document.createElement('div');
  row.className = 'acct-stat';
  const head = document.createElement('div');
  head.className = 'acct-stat__label';
  const l = document.createElement('span');
  l.textContent = label;
  const v = document.createElement('b');
  v.textContent = value;
  head.append(l, v);
  row.appendChild(head);
  if (extra) row.appendChild(extra);
  return row;
};

const meter = (pct) => {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  const bar = document.createElement('i');
  bar.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  wrap.appendChild(bar);
  return wrap;
};

/**
 * Pull the account's real figures from Puter. Every call is independent and
 * failure-tolerant: a signed-out user, a blocked API or a missing field just
 * leaves that one row out rather than breaking the menu.
 */
async function loadAccountStats() {
  el.acctStats.innerHTML = '';
  const user = store.user;

  const name = asText(user?.username, '') || asText(user?.name, '') || 'Guest';
  el.acctName.textContent = name;
  el.acctSub.textContent = store.signedIn ? 'Puter account' : 'Not signed in';
  el.acctAvatar.textContent = name.slice(0, 1).toUpperCase();
  el.acctAuthLabel.textContent = store.signedIn ? 'Sign out' : 'Sign in';
  // Arrow points out when leaving, in when arriving.
  el.acctAuthIcon.querySelector('path').setAttribute('d', store.signedIn
    ? 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
    : 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3');

  if (!store.signedIn) {
    const note = document.createElement('p');
    note.className = 'acct-stat__note';
    note.textContent = 'Sign in to see your plan, storage and usage.';
    el.acctStats.appendChild(stat('Account', 'Guest', note));
    return;
  }

  // ---- storage -------------------------------------------------
  try {
    const space = await puter.fs.space();
    const used = Number(space?.used);
    const cap = Number(space?.capacity);
    if (Number.isFinite(used) && Number.isFinite(cap) && cap > 0) {
      el.acctStats.appendChild(
        stat('Storage', `${bytes(used)} of ${bytes(cap)}`, meter((used / cap) * 100))
      );
    }
  } catch { /* storage unavailable — omit that row */ }

  // ---- this month's usage --------------------------------------
  try {
    const usage = await puter.auth.getMonthlyUsage();
    const totals = usage?.appTotals || {};
    const appId = typeof puter !== 'undefined' ? puter.appID : null;

    let calls = 0;
    let spend = 0;
    for (const [id, v] of Object.entries(totals)) {
      if (appId && id !== appId) continue;   // this app only
      calls += Number(v?.count) || 0;
      spend += Number(v?.total) || 0;
    }

    const note = document.createElement('p');
    note.className = 'acct-stat__note';
    const remaining = Number(usage?.allowanceInfo?.remaining);
    note.textContent = Number.isFinite(remaining)
      ? `${usd(remaining)} of allowance left this month`
      : 'Resets at the start of each month';

    el.acctStats.appendChild(
      stat('This month', `${calls.toLocaleString()} calls · ${usd(spend)}`, note)
    );
  } catch { /* usage unavailable — omit that row */ }
}

function toggleAccountMenu(force) {
  const open = force ?? el.accountMenu.hidden;
  el.accountMenu.hidden = !open;
  el.accountBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    closeModelMenu();
    loadAccountStats();
  }
}

const closeAccountMenu = () => toggleAccountMenu(false);

/** Sign in / out, shared by the sidebar row and the account menu. */
async function handleAuthToggle() {
  try {
    if (store.signedIn) {
      const res = await puter.auth.signOut();
      if (res && res.success === false) {
        toast(asText(res.message ?? res.error, 'Could not sign out.'), 'err');
        return;
      }
      location.reload();
    } else {
      await puter.auth.signIn();
      location.reload();
    }
  } catch (err) {
    toast(describeError(err), 'err');
  }
}

/* ── Model picker ────────────────────────────────────────── */

function toggleModelMenu(force) {
  const open = force ?? el.modelMenu.hidden;
  el.modelMenu.hidden = !open;
  el.modelBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    el.modelSearch.placeholder = state.mode === 'image' ? 'Search image models…' : 'Search 500+ models…';
    el.modelSearch.value = '';
    renderModelList('');
    setTimeout(() => el.modelSearch.focus(), 20);
  }
}

const closeModelMenu = () => toggleModelMenu(false);

function renderModelList(query = '') {
  const isImage = state.mode === 'image';
  const cat = isImage ? imageCatalogue : catalogue;
  const activeId = isImage ? state.settings.imageModel : state.settings.model;

  const groups = cat.search(query);
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  el.modelCount.textContent = `${total} ${isImage ? 'image model' : 'model'}${total === 1 ? '' : 's'}`;

  el.modelList.innerHTML = '';
  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'No models match that search.';
    el.modelList.appendChild(empty);
    return;
  }

  for (const { provider, list } of groups) {
    const group = document.createElement('div');
    group.className = 'mgroup';

    const label = document.createElement('div');
    label.className = 'mgroup__label';
    label.textContent = `${asText(provider, 'other')} (${list.length})`;
    group.appendChild(label);

    for (const m of list) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mrow' + (m.id === activeId ? ' active' : '');
      row.dataset.model = m.id;

      const meta = document.createElement('div');
      meta.className = 'mrow__name';
      const title = document.createElement('div');
      title.textContent = asText(m.name, '') || asText(m.id, 'model');
      const id = document.createElement('div');
      id.className = 'mrow__id';
      const ctx = Number(m.context);
      const ctxLabel = Number.isFinite(ctx) && ctx > 0 ? ` · ${Math.round(ctx / 1000)}k ctx` : '';
      id.textContent = asText(m.id, '') + ctxLabel;
      meta.append(title, id);

      const price = document.createElement('div');
      price.className = 'mrow__price';
      price.textContent = formatPrice(m.cost);

      row.append(meta, price);
      row.addEventListener('click', () => {
        if (isImage) setImageModel(m.id);
        else setModel(m.id);
        closeModelMenu();
      });
      group.appendChild(row);
    }
    el.modelList.appendChild(group);
  }
}

async function setModel(id) {
  state.settings.model = id;
  await saveSettings({ model: id });
  renderTopbar();
}

async function setImageModel(id) {
  state.settings.imageModel = id;
  await saveSettings({ imageModel: id });
  const tiers = qualityTiersFor(id);
  if (!tiers.includes(state.settings.imageQuality)) {
    state.settings.imageQuality = tiers[0] || '';
    await saveSettings({ imageQuality: state.settings.imageQuality });
  }
  renderImageControls();
  renderTopbar();
}

/* ── Attachments ─────────────────────────────────────────── */

function renderAttachments() {
  el.attachments.innerHTML = '';
  el.attachments.hidden = state.attachments.length === 0;
  state.attachments.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'attach';
    card.title = a.name;

    const img = document.createElement('img');
    img.src = a.dataUrl;
    card.appendChild(img);

    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Remove attachment';
    x.addEventListener('click', () => {
      state.attachments.splice(i, 1);
      renderAttachments();
      updateComposerState();
    });
    card.appendChild(x);
    el.attachments.appendChild(card);
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) { toast(`${file.name} is not an image.`, 'err'); continue; }
    if (file.size > 12 * 1024 * 1024) { toast(`${file.name} is larger than 12 MB.`, 'err'); continue; }
    try {
      const dataUrl = await readAsDataURL(file);
      state.attachments.push({ name: file.name, size: file.size, type: file.type, dataUrl, file });
    } catch (err) {
      toast(describeError(err), 'err');
    }
  }
  renderAttachments();
  updateComposerState();
}

function clearAttachments() {
  state.attachments = [];
  renderAttachments();
  el.fileInput.value = '';
}

/* ── Chat flow ───────────────────────────────────────────── */

/**
 * The send button doubles as the stop button: one control whose icon, label
 * and behaviour all follow the streaming state, so the row never shifts.
 */
function setStreaming(on) {
  state.streaming = on;

  el.sendIcon.hidden = on;
  el.stopIcon.hidden = !on;
  el.send.title = on ? 'Stop generating' : 'Send';
  el.send.setAttribute('aria-label', on ? 'Stop generating' : 'Send');
  el.send.setAttribute('aria-pressed', String(on));

  el.imgToggle.disabled = on;
  el.modelBtn.disabled = on;
  updateComposerState();
}

function updateComposerState() {
  const hasText = el.input.value.trim().length > 0;
  const hasFiles = state.attachments.length > 0;
  const ready = state.mode === 'image' ? hasText : (hasText || hasFiles);
  // While streaming the button must stay enabled — that is how you stop.
  el.send.disabled = state.streaming ? false : !ready;
}

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
  updateComposerState();
}

async function send() {
  if (state.streaming) return;

  const text = el.input.value.trim();
  const attachments = state.attachments.slice();
  if (!text && !attachments.length) return;

  const isImage = state.mode === 'image';
  if (isImage && !text) {
    toast('Describe the image you want first.', 'err');
    el.input.focus();
    return;
  }

  let conv = current();
  if (!conv) conv = await createConversation(true);

  const userMsg = newMessage('user', text);
  conv.messages.push(userMsg);
  if (asText(conv.title, 'New chat') === 'New chat' && text) conv.title = deriveTitle(conv);

  const inlinePreview = attachments.map((a) => a.dataUrl).filter(Boolean);
  if (inlinePreview.length) state.previews.set(userMsg.id, inlinePreview);

  el.input.value = '';
  clearAttachments();
  autoGrow();

  // ---- image mode -------------------------------------------------
  if (isImage) {
    userMsg.attachments = attachments.map((a) => ({ name: a.name, size: a.size }));
    renderThread({ forceScroll: true });
    renderSidebar();
    await save(conv);
    await runImageGen(conv, text, inlinePreview);
    return;
  }

  // ---- chat mode --------------------------------------------------
  renderThread();

  userMsg.attachments = [];
  for (const a of attachments) {
    if (store.signedIn && a.file) {
      try {
        userMsg.attachments.push(await uploadImage(a.file));
      } catch {
        userMsg.attachments.push({ name: a.name, dataUrl: a.dataUrl, size: a.size });
      }
    } else {
      userMsg.attachments.push({ name: a.name, dataUrl: a.dataUrl, size: a.size });
    }
  }

  renderSidebar();
  await save(conv);
  renderThread({ forceScroll: true });

  await runAssistant(conv);
}

async function runAssistant(conv) {
  const apiMessages = toApiMessages(conv.messages, sysPrompt());
  if (!apiMessages.length) return;

  const botMsg = newMessage('assistant', '');
  botMsg.model = asText(catalogue.get(state.settings.model)?.name, '') || asText(state.settings.model, 'Next GPT');
  botMsg.streaming = true;
  conv.messages.push(botMsg);

  const controller = new AbortController();
  state.controller = controller;
  setStreaming(true);
  renderThread({ forceScroll: true });

  const node = el.thread.lastElementChild;
  const md = node.querySelector('.md');

  let dirty = false;
  let rafId = 0;
  const paint = () => {
    rafId = 0;
    if (!dirty) return;
    dirty = false;
    // Trailing inline dot, removed as soon as real text arrives.
    md.innerHTML = renderMarkdown(botMsg.text) +
      (botMsg.streaming ? '<span class="thinking-dot inline"></span>' : '');
    scrollToEnd();
  };
  const invalidate = () => {
    dirty = true;
    if (!rafId) rafId = requestAnimationFrame(paint);
  };

  let thinkNode = null;
  const ensureThink = () => {
    if (thinkNode || !state.settings.showReasoning) return;
    const body = node.querySelector('.msg__body');
    thinkNode = document.createElement('details');
    thinkNode.className = 'think live';
    const summary = document.createElement('summary');
    summary.textContent = 'Model reasoning';
    const pre = document.createElement('div');
    pre.className = 'think__body';
    thinkNode.append(summary, pre);
    body.insertBefore(thinkNode, md);
  };

  try {
    const result = await runTurn({
      messages: apiMessages,
      model: state.settings.model,
      stream: state.settings.stream,
      temperature: state.settings.temperature,
      maxTokens: state.settings.maxTokens,
      signal: controller.signal,
    }, {
      onText: (_d, all) => { botMsg.text = all; invalidate(); },
      onReasoning: (_d, all) => {
        botMsg.reasoning = all;
        ensureThink();
        if (thinkNode) {
          thinkNode.querySelector('.think__body').textContent = all;
          scrollToEnd();
        }
      },
      onImage: (img) => { botMsg.images = [...(botMsg.images || []), img]; },
      onUsage: (usage, finishReason, usageDetails) => {
        botMsg.usage = usage;
        botMsg.usageDetails = usageDetails;
        botMsg.finishReason = finishReason;
        updateTopStats(usage, usageDetails);
      },
    });

    botMsg.text = result.text;
    if (result.reasoning) botMsg.reasoning = result.reasoning;
    if (result.images.length) botMsg.images = result.images;
    if (result.usageDetails) botMsg.usageDetails = result.usageDetails;
  } catch (err) {
    if (err?.name === 'AbortError' || /stopped/i.test(err?.message || '')) {
      botMsg.stopped = true;
      if (!botMsg.text) botMsg.text = '_Stopped._';
    } else {
      botMsg.error = describeError(err);
      toast(describeError(err), 'err');
    }
  } finally {
    if (rafId) cancelAnimationFrame(rafId);
    dirty = false;
    md.innerHTML = renderMarkdown(botMsg.text);
    if (thinkNode) thinkNode.classList.remove('live');
    botMsg.streaming = false;
    setStreaming(false);
    state.controller = null;

    // Swap in the canonical node so the action row appears.
    node.replaceWith(messageEl(botMsg, botMsg.id === latestReplyId()));
    renderSidebar();
    await save(conv);
    renderTopbar();
    el.input.focus();
  }
}

function updateTopStats(usage, usageDetails) {
  if (!usage && !usageDetails) { el.topStats.textContent = ''; return; }
  const cost = usageCostUsd(usage);
  const t = usageDetails?.inputTokens ?? usage?.prompt_tokens;
  const o = usageDetails?.outputTokens ?? usage?.completion_tokens;
  const parts = [];
  if (typeof t === 'number') parts.push(`<b>${t.toLocaleString()}</b> in`);
  if (typeof o === 'number') parts.push(`<b>${o.toLocaleString()}</b> out`);
  if (cost != null) parts.push(`<b>$${cost.toFixed(4)}</b>`);
  el.topStats.innerHTML = parts.join(' · ');
}

/** Generate one image and drop the result into the conversation. */
async function runImageGen(conv, prompt, inputImages = []) {
  const botMsg = newMessage('assistant', '');
  botMsg.kind = 'image';
  botMsg.prompt = prompt;
  botMsg.model = asText(imageCatalogue.get(state.settings.imageModel)?.name, '')
    || asText(state.settings.imageModel, 'Image model');
  botMsg.pending = true;
  botMsg.imageMeta = {
    ratio: state.settings.imageRatio || '1:1',
    quality: state.settings.imageQuality || null,
    test: !!state.settings.imageTest,
  };
  conv.messages.push(botMsg);

  setStreaming(true);
  renderThread({ forceScroll: true });

  // Hosted URLs from txt2img are temporary — keep a copy in the user's drive.
  const outPath = store.signedIn && !state.settings.imageTest ? imageOutputPath(prompt) : null;

  try {
    const { src } = await generateImage({
      prompt,
      model: state.settings.imageModel,
      ratioId: state.settings.imageRatio,
      quality: state.settings.imageQuality,
      inputImage: inputImages?.[0],
      testMode: state.settings.imageTest,
      outputPath: outPath,
    });
    botMsg.images = [{ image_url: { url: src } }];
    if (outPath) botMsg.savedPath = outPath;
  } catch (err) {
    botMsg.error = describeError(err);
    toast(describeError(err), 'err');
  } finally {
    botMsg.pending = false;
    setStreaming(false);
    renderThread({ forceScroll: true });
    renderSidebar();
    await save(conv);
    el.input.focus();
  }
}

/** Stored chats keep a Puter path; hosted URLs may have expired. Re-mint them. */
async function hydrateImages() {
  let changed = false;
  for (const conv of state.conversations) {
    for (const msg of conv.messages) {
      if (msg.kind !== 'image' || !msg.savedPath || msg.pending) continue;
      const fresh = await readURL(msg.savedPath);
      if (fresh) {
        msg.images = [{ image_url: { url: fresh } }];
        changed = true;
      }
    }
  }
  if (changed) renderThread();
}

/** "Show me an image." — turn the reply into a generated picture. */
async function showImage(replyId) {
  if (state.streaming) return;
  const conv = current();
  if (!conv) return;
  const source = conv.messages.find((m) => m.id === replyId);
  if (!source?.text?.trim()) return;

  const excerpt = source.text.replace(/\s+/g, ' ').trim().slice(0, 600);
  const prompt = `A beautifully styled food photograph inspired by this: ${excerpt}`;

  // Leave chat mode behind so the composer matches what we just did.
  setMode('image');
  await runImageGen(conv, prompt, []);
}

/* ── Message / conversation management ───────────────────── */

async function regenerate(assistantId) {
  if (state.streaming) return;
  const conv = current();
  if (!conv) return;

  const idx = conv.messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return;

  const target = conv.messages[idx];

  if (target.kind === 'image') {
    let p = idx - 1;
    while (p >= 0 && conv.messages[p].role !== 'user') p--;
    const src = p >= 0 ? conv.messages[p] : null;
    const prompt = asText(src?.text, '') || asText(target.prompt, '');
    const ref = src ? (state.previews.get(src.id)?.[0] || '') : '';
    conv.messages = conv.messages.slice(0, idx);
    await save(conv);
    renderThread();
    if (prompt) await runImageGen(conv, prompt, ref ? [ref] : []);
    return;
  }

  conv.messages = conv.messages.slice(0, idx);
  renderThread();
  await runAssistant(conv);
}

async function deleteMessage(id) {
  const conv = current();
  if (!conv) return;
  conv.messages = conv.messages.filter((m) => m.id !== id);
  state.previews.delete(id);
  await save(conv);
  renderThread();
  renderSidebar();
}

async function deleteConversation(id) {
  await remove(id);
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.currentId === id) {
    state.currentId = state.conversations[0]?.id || null;
    if (!state.currentId) {
      const fresh = newConversation();
      state.conversations = [fresh];
      state.currentId = fresh.id;
    }
    renderAll({ forceScroll: true });
  } else {
    renderSidebar();
  }
}

async function createConversation(activate = true) {
  const conv = newConversation();
  state.conversations.unshift(conv);
  await save(conv);
  if (activate) {
    state.currentId = conv.id;
    el.input.value = '';
    clearAttachments();
    autoGrow();
    el.search.value = '';
    renderAll();
    el.input.focus();
  }
  return conv;
}

async function selectConversation(id) {
  if (state.streaming) {
    toast('Finish or stop the current reply first.');
    return;
  }
  state.currentId = id;
  el.search.value = '';
  clearAttachments();
  el.input.value = '';
  autoGrow();
  if (isMobile()) {
    el.app.classList.add('sidebar-collapsed');
    el.app.classList.remove('nav-open');
  }
  renderAll({ forceScroll: true });
}

/* ── Export ──────────────────────────────────────────────── */

function exportChat(format) {
  const conv = current();
  if (!conv || !conv.messages.length) {
    toast('Nothing to export yet.', 'err');
    return;
  }
  const stamp = new Date(conv.createdAt || Date.now()).toISOString().slice(0, 10);
  const base = `${slug(conv.title)}-${stamp}`;

  if (format === 'json') {
    download(`${base}.json`, JSON.stringify(conv, null, 2), 'application/json');
  } else {
    const lines = [`# ${asText(conv.title, 'Chat')}`, '', `_Exported ${new Date().toLocaleString()}_`, ''];
    for (const m of conv.messages) {
      if (m.deleted) continue;
      lines.push(m.role === 'user' ? '## You' : `## ${asText(m.model, 'Next GPT')}`);
      if (m.attachments?.length) {
        lines.push('', ...m.attachments.map((a) => `- 📎 ${asText(a.name, 'attachment')}${a.path ? ` (${a.path})` : ''}`));
      }
      if (m.kind === 'image') {
        const src = asText(m.images?.[0]?.image_url?.url, '');
        lines.push('', `**Prompt:** ${asText(m.prompt, '')}`);
        if (src) lines.push('', `![Generated image](${src})`);
        if (m.savedPath) lines.push('', `_Saved to ${m.savedPath}_`);
        if (m.error) lines.push('', `_Error: ${asText(m.error, '')}_`);
        lines.push('');
        continue;
      }
      lines.push('', m.text || '', '');
    }
    download(`${base}.md`, lines.join('\n'));
  }
  toast(`Exported as ${format.toUpperCase()}`, 'ok');
}

/* ── "Ask me" — personal profile ─────────────────────────── */

function readProfileForm() {
  return {
    name: el.pfName.value.trim(),
    role: el.pfRole.value.trim(),
    tone: el.pfTone.value || 'balanced',
    goals: el.pfGoals.value.trim(),
    avoid: el.pfAvoid.value.trim(),
  };
}

/** Live preview of the exact block that will ride along with each message. */
function refreshProfilePreview() {
  const block = profilePrompt(readProfileForm());
  el.pfPreview.textContent = block
    ? `${effectiveSystemPrompt(state.settings.systemPrompt, readProfileForm())}`
    : 'Nothing yet — answer a question above to see what gets sent.';
  const tone = TONES.find((t) => t.id === el.pfTone.value);
  el.pfToneHint.textContent = tone ? tone.hint : '';
}

function openProfileDialog() {
  const p = state.profile;

  // Offer the real Puter username so they don't retype what we already know.
  const known = asText(store.user?.username, '') || asText(store.user?.name, '');
  if (known && !p.name) el.pfName.placeholder = known;
  if (store.signedIn) {
    el.pfAccount.hidden = false;
    el.pfAccount.textContent = known
      ? `Signed in to Puter as ${known}.`
      : 'Signed in to Puter.';
  } else {
    el.pfAccount.hidden = false;
    el.pfAccount.textContent = 'Not signed in — this is stored on this device.';
  }

  el.pfName.value = p.name;
  el.pfRole.value = p.role;
  el.pfGoals.value = p.goals;
  el.pfAvoid.value = p.avoid;

  if (!el.pfTone.options.length) {
    for (const t of TONES) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.label;
      el.pfTone.appendChild(o);
    }
  }
  el.pfTone.value = p.tone;

  refreshProfilePreview();
  el.profileDialog.showModal();
}

function renderProfileBadge() {
  const on = hasProfile(state.profile);
  el.profileBadge.hidden = !on;
  if (on) {
    const s = profileSummary(state.profile);
    el.askMe.title = s ? `Personalised for ${s} — edit` : 'Edit your profile';
  }
}

/* ── Settings ────────────────────────────────────────────── */

function openSettings() {
  el.setSystem.value = state.settings.systemPrompt || '';
  el.setTemp.value = state.settings.temperature;
  el.setTempOut.textContent = Number(state.settings.temperature).toFixed(1);
  el.setMax.value = state.settings.maxTokens ?? '';
  el.setStream.checked = !!state.settings.stream;
  el.setReasoning.checked = !!state.settings.showReasoning;
  el.settingsDialog.showModal();
}

async function onSettingChange(patch, { rerender = false } = {}) {
  Object.assign(state.settings, patch);
  await saveSettings(patch);
  if (rerender) renderThread();
}

/* ── Events ──────────────────────────────────────────────── */

function bindEvents() {
  // ---- signed-out gate ----
  el.gateSignin.addEventListener('click', async () => {
    el.gateError.textContent = '';
    try {
      await puter.auth.signIn();
      location.reload();
    } catch {
      el.gateError.textContent = 'Sign-in was cancelled. Try again when you are ready.';
    }
  });
  el.gateSkip.addEventListener('click', () => {
    // boot() already ran and warmed the caches underneath — just lift the gate.
    el.gate.hidden = true;
    el.input.focus();
  });

  el.logoNew.addEventListener('click', () => { if (!state.streaming) createConversation(); });
  el.sideImage.addEventListener('click', async () => {
    if (state.streaming) return;
    await createConversation();
    setMode('image');
    el.input.focus();
  });

  // ---- Ask me / profile ----
  el.askMe.addEventListener('click', () => { closeAccountMenu(); openProfileDialog(); });
  for (const field of [el.pfName, el.pfRole, el.pfGoals, el.pfAvoid, el.pfTone]) {
    field.addEventListener('input', refreshProfilePreview);
  }
  el.pfSave.addEventListener('click', async () => {
    state.profile = readProfileForm();
    await saveProfile(state.profile);
    renderProfileBadge();
    el.profileDialog.close();
    toast(hasProfile(state.profile) ? 'Profile saved — replies will use it' : 'Profile cleared',
      hasProfile(state.profile) ? 'ok' : '');
  });
  el.pfClear.addEventListener('click', async () => {
    state.profile = { ...BLANK_PROFILE };
    await clearProfile();
    el.pfName.value = '';
    el.pfRole.value = '';
    el.pfGoals.value = '';
    el.pfAvoid.value = '';
    el.pfTone.value = 'balanced';
    refreshProfilePreview();
    renderProfileBadge();
    toast('Profile cleared', 'ok');
  });

  el.newChat.addEventListener('click', () => {
    if (!state.streaming) createConversation();
  });

  el.collapse.addEventListener('click', () => {
    setSidebarCollapsed(true);
    saveSettings({ sidebarCollapsed: true });
  });
  el.expand.addEventListener('click', () => {
    setSidebarCollapsed(false);
    saveSettings({ sidebarCollapsed: false });
  });
  el.scrim.addEventListener('click', () => {
    el.app.classList.remove('nav-open');
  });

  // One button: send while idle, stop while a reply streams.
  el.send.addEventListener('click', () => {
    if (state.streaming) state.controller?.abort();
    else send();
  });
  el.imgToggle.addEventListener('click', () => setMode(state.mode === 'image' ? 'chat' : 'image'));

  el.input.addEventListener('input', autoGrow);
  el.input.addEventListener('keydown', (e) => {
    // Enter sends on keyboards with a real pointer; on touch the virtual
    // keyboard's Enter must still insert a newline.
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && fine) {
      e.preventDefault();
      if (!el.send.disabled) send();
    }
  });
  el.input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  el.attach.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => { addFiles([...el.fileInput.files]); });
  el.search.addEventListener('input', renderSidebar);

  el.modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleModelMenu();
  });
  el.modelSearch.addEventListener('input', () => renderModelList(el.modelSearch.value));

  // Dismiss the dropdown the way a menu should behave.
  el.modelMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { closeModelMenu(); closeAccountMenu(); });

  // ---- account menu ----
  el.accountBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAccountMenu();
  });
  el.accountMenu.addEventListener('click', (e) => e.stopPropagation());
  el.acctSettings.addEventListener('click', () => { closeAccountMenu(); openSettings(); });
  el.acctAuth.addEventListener('click', () => { closeAccountMenu(); handleAuthToggle(); });

  el.imgRatio.addEventListener('change', () => onSettingChange({ imageRatio: el.imgRatio.value }));
  el.imgQuality.addEventListener('change', () => onSettingChange({ imageQuality: el.imgQuality.value }));
  el.imgTest.addEventListener('change', () => onSettingChange({ imageTest: el.imgTest.checked }));

  $('btn-export').addEventListener('click', (e) => exportChat(e.shiftKey ? 'json' : 'md'));

  el.setSystem.addEventListener('change', () => onSettingChange({ systemPrompt: el.setSystem.value }));
  el.setTemp.addEventListener('input', () => {
    el.setTempOut.textContent = Number(el.setTemp.value).toFixed(1);
  });
  el.setTemp.addEventListener('change', () => onSettingChange({ temperature: Number(el.setTemp.value) }));
  el.setMax.addEventListener('change', () => {
    const v = parseInt(el.setMax.value, 10);
    onSettingChange({ maxTokens: Number.isFinite(v) && v > 0 ? v : null });
  });
  el.setStream.addEventListener('change', () => onSettingChange({ stream: el.setStream.checked }));
  el.setReasoning.addEventListener('change', () => onSettingChange({ showReasoning: el.setReasoning.checked }, { rerender: true }));

  $('btn-clear-chat').addEventListener('click', async () => {
    const conv = current();
    if (!conv) return;
    conv.messages = [];
    conv.trimmed = false;
    await save(conv);
    renderThread();
    toast('Conversation cleared', 'ok');
  });

  $('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Delete every conversation and setting stored by this app? This cannot be undone.')) return;
    await clearAll();
    await clearSettings();
    location.reload();
  });

  el.thread.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    copyText(btn.closest('.codeblock')?.querySelector('code')?.textContent || '', 'Code copied');
  });

  window.addEventListener('beforeunload', () => {
    const conv = current();
    if (conv?.messages.length) saveSync(conv);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.app.classList.remove('nav-open');
      closeModelMenu();
      closeAccountMenu();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); el.search.focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      const next = !el.app.classList.contains('sidebar-collapsed');
      setSidebarCollapsed(next);
      saveSettings({ sidebarCollapsed: next });
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !state.streaming) {
      e.preventDefault();
      createConversation();
    }
  });

  window.addEventListener('resize', autoGrow);
}

/* ── Boot ────────────────────────────────────────────────── */

async function boot() {
  if (typeof puter === 'undefined') {
    toast('Puter.js failed to load. Check your connection and reload.', 'err');
    return;
  }

  try { puter.ui?.setWindowTitle?.('Next GPT'); } catch { /* not inside Puter */ }

  let signedIn = false;
  try {
    signedIn = await puter.auth.isSignedIn();
  } catch {
    signedIn = false;
  }

  // Signed-out visitors get the welcome screen first — chat still works behind
  // "Continue as guest", just stored on this device.
  if (!signedIn) {
    el.gate.hidden = false;
    el.app.style.visibility = 'hidden';
  }

  bindEvents();
  autoGrow();

  await store.init();
  renderAccount();

  state.settings = await loadSettings();
  state.profile = await loadProfile();
  renderProfileBadge();

  try {
    await catalogue.load();
  } catch (err) {
    toast(describeError(err), 'err');
  }
  if (!state.settings.model || !catalogue.get(state.settings.model)) {
    const fallback = catalogue.getDefaultId();
    if (fallback) await setModel(fallback);
  }

  // Image models live behind a different driver than the chat catalogue.
  await imageCatalogue.load();
  if (!state.settings.imageModel || !imageCatalogue.get(state.settings.imageModel)) {
    const imgFallback = imageCatalogue.getDefaultId();
    if (imgFallback) await setImageModel(imgFallback);
  }

  renderImageControls();

  state.conversations = await listAll();
  if (!state.conversations.length) {
    const fresh = newConversation();
    state.conversations = [fresh];
    state.currentId = fresh.id;
  } else {
    state.currentId = state.conversations[0].id;
  }

  // Narrow screens start closed so the greeting isn't hidden behind the panel.
  const startCollapsed = isMobile() ? true : !!state.settings.sidebarCollapsed;
  setSidebarCollapsed(startCollapsed);
  renderTopbar();
  renderAll();
  setMode(state.mode);
  el.input.focus();

  hydrateImages();

  // Reveal the app once everything is ready, and only nag guests who chose it.
  el.app.style.visibility = '';
  if (!signedIn) {
    toast('Browsing as guest — chats are saved on this device. Sign in to sync.', 'ok');
  }
}

boot();