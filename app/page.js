"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Sidebar from "../components/Sidebar";
import Composer from "../components/Composer";
import Message from "../components/Message";
import ModelMenu, { ModelTrigger } from "../components/ModelMenu";
import AccountMenu, { buildAccountStats } from "../components/AccountMenu";
import { SettingsDialog, ProfileDialog } from "../components/Dialogs";
import {
  IconMenu, IconDownload, IconPencil, IconImage, IconCap,
  IconCode, IconBulb, IconChecks, IconHouse, IconFrame,
  IconLayers, IconCube, IconStar,
} from "../components/icons";

import {
  ModelCatalogue, runTurn, toApiMessages, uploadImage, readAsDataURL,
  describeError, asText, usageCostUsd,
} from "../lib/ai";
import {
  ImageCatalogue, generateImage, imageOutputPath, readURL, qualityTiersFor,
} from "../lib/imagegen";
import {
  listAll, save, saveSync, remove, clearAll,
  loadSettings, saveSettings, clearSettings,
  loadProfile, saveProfile, clearProfile,
  newConversation, newMessage, deriveTitle, dateGroup,
} from "../lib/conversations";
import { BLANK_PROFILE, hasProfile, effectiveSystemPrompt } from "../lib/profile";
import { store } from "../lib/store";

const chatModels = new ModelCatalogue();
const imageModels = new ImageCatalogue();

const CHAT_PILLS = [
  { label: "Help me write", Icon: IconPencil, tone: "text-violet-400",
    prompt: "Help me write a friendly, professional email asking my manager for a day off next Friday." },
  { label: "Explain something", Icon: IconCap, tone: "text-sky-400",
    prompt: "Explain how the stock market works in simple terms, with an example." },
  { label: "Code", Icon: IconCode, tone: "text-rose-400",
    prompt: "Write a JavaScript function that checks whether a string is a palindrome, and explain how it works." },
  { label: "Brainstorm", Icon: IconBulb, tone: "text-amber-400",
    prompt: "Give me 10 creative weekend activity ideas for a rainy day." },
  { label: "Make a plan", Icon: IconChecks, tone: "text-teal-400",
    prompt: "Make me a simple 4-week beginner workout plan I can do at home." },
];

const IMAGE_PILLS = [
  { label: "Cozy cabin", Icon: IconHouse, tone: "text-emerald-400",
    prompt: "A cozy cabin in a snowy forest at dusk, warm light glowing from the windows, cinematic" },
  { label: "Retro poster", Icon: IconFrame, tone: "text-amber-400",
    prompt: "A 1970s retro travel poster for Mars, bold flat colours, screen print texture" },
  { label: "Flat illustration", Icon: IconLayers, tone: "text-violet-400",
    prompt: "A flat vector illustration of a sleeping cat curled on a stack of books" },
  { label: "Isometric", Icon: IconCube, tone: "text-sky-400",
    prompt: "An isometric view of a tiny cosy library, cutaway, lots of plants" },
  { label: "Bioluminescent", Icon: IconStar, tone: "text-teal-400",
    prompt: "A bioluminescent forest at midnight, glowing mushrooms, deep blues and greens" },
];

const slug = (s) => (s || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "").slice(0, 48) || "chat";

export default function Page() {
  /* ── state ─────────────────────────────────────────────── */
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState({ ...BLANK_PROFILE });
  const [mode, setMode] = useState("chat");
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [previews, setPreviews] = useState({});
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [stats, setStats] = useState("");
  const [draft, setDraft] = useState({});

  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountStats, setAccountStats] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const abortRef = useRef(null);
  const scrollerRef = useRef(null);
  const bootedRef = useRef(false);

  const conv = useMemo(
    () => conversations.find((c) => c.id === currentId) || null,
    [conversations, currentId]
  );
  const messages = conv?.messages || [];
  const hasMessages = messages.length > 0;

  const sysPrompt = () => effectiveSystemPrompt(settings?.systemPrompt, profile);

  /* ── toast ─────────────────────────────────────────────── */
  const toast = useCallback((message, kind = "") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text: asText(message), kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 5200 : 2600);
  }, []);

  /* ── persistence helpers ───────────────────────────────── */
  const patchConv = useCallback((id, mutate) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? mutate(c) : c)));
  }, []);

  const persist = useCallback(async (id) => {
    const found = conversations.find((c) => c.id === id);
    if (found) await save(found);
  }, [conversations]);

  /* ── boot ──────────────────────────────────────────────── */
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    (async () => {
      if (typeof puter === "undefined") {
        // The SDK may still be arriving; wait briefly rather than bail out.
        for (let i = 0; i < 40 && typeof puter === "undefined"; i++) {
          await new Promise((r) => setTimeout(r, 150));
        }
        if (typeof puter === "undefined") {
          toast("Puter.js failed to load. Check your connection and reload.", "err");
          setReady(true);
          return;
        }
      }

      try { puter.ui?.setWindowTitle?.("GPT"); } catch { /* not inside Puter */ }

      await store.init();
      const s = await loadSettings();
      const p = await loadProfile();
      setSettings(s);
      setProfile(p);
      setSidebarOpen(window.matchMedia("(max-width: 767px)").matches ? false : !s.sidebarCollapsed);

      try { await chatModels.load(); } catch (err) { toast(describeError(err), "err"); }
      await imageModels.load();

      if (!s.model || !chatModels.get(s.model)) {
        const id = chatModels.getDefaultId();
        if (id) { s.model = id; await saveSettings({ model: id }); setSettings({ ...s }); }
      }
      if (!s.imageModel || !imageModels.get(s.imageModel)) {
        const id = imageModels.getDefaultId();
        if (id) { s.imageModel = id; await saveSettings({ imageModel: id }); setSettings({ ...s }); }
      }

      const list = await listAll();
      if (list.length) {
        setConversations(list);
        setCurrentId(list[0].id);
      } else {
        const fresh = newConversation();
        setConversations([fresh]);
        setCurrentId(fresh.id);
      }
      setReady(true);
    })();
  }, [toast]);

  /* ── re-mint stored image URLs ─────────────────────────── */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      let changed = false;
      for (const c of conversations) {
        for (const m of c.messages) {
          if (m.kind !== "image" || !m.savedPath || m.pending) continue;
          const fresh = await readURL(m.savedPath);
          if (fresh) { m.images = [{ image_url: { url: fresh } }]; changed = true; }
        }
      }
      if (changed) setConversations((prev) => [...prev]);
    })();
  }, [ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── scroll ────────────────────────────────────────────── */
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && hasMessages) el.scrollTop = el.scrollHeight;
  }, [messages, hasMessages]);

  useEffect(() => {
    document.title = hasMessages ? `${conv?.title || "Chat"} · GPT` : "GPT — AI Chat & Images";
  }, [hasMessages, conv?.title]);

  useEffect(() => {
    if (!ready) return;
    const onUnload = () => { if (conv?.messages.length) saveSync(conv); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [ready, conv]);

  /* ── actions ───────────────────────────────────────────── */
  const createConversation = useCallback(async () => {
    const fresh = newConversation();
    setConversations((prev) => [fresh, ...prev]);
    setCurrentId(fresh.id);
    setSearch("");
    await save(fresh);
    setInput("");
    setAttachments([]);
    setPreviews({});
  }, []);

  const selectConversation = useCallback(async (id) => {
    if (streaming) { toast("Finish or stop the current reply first."); return; }
    setCurrentId(id);
    setSearch("");
    setInput("");
    setAttachments([]);
    setPreviews({});
    if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false);
  }, [streaming, toast]);

  const deleteConversation = useCallback(async (id) => {
    await remove(id);
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === currentId) {
        const fallback = next[0] || newConversation();
        setCurrentId(fallback.id);
        if (!next.length) save(fallback);
        return next.length ? next : [fallback];
      }
      return next;
    });
  }, [currentId]);

  const deleteMessage = useCallback(async (id) => {
    patchConv(currentId, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== id) }));
    setPreviews((p) => { const n = { ...p }; delete n[id]; return n; });
    setTimeout(() => persist(currentId), 0);
  }, [currentId, patchConv, persist]);

  const addFiles = useCallback(async (files) => {
    const accepted = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) { toast(`${f.name} is not an image.`, "err"); continue; }
      if (f.size > 12 * 1024 * 1024) { toast(`${f.name} is larger than 12 MB.`, "err"); continue; }
      try {
        const dataUrl = await readAsDataURL(f);
        accepted.push({ name: f.name, size: f.size, type: f.type, dataUrl, file: f });
      } catch (err) { toast(describeError(err), "err"); }
    }
    if (accepted.length) setAttachments((prev) => [...prev, ...accepted]);
  }, [toast]);

  /* ── streaming reply ───────────────────────────────────── */
  const runAssistant = useCallback(async (convId) => {
    const snapshot = conversations.find((c) => c.id === convId);
    if (!snapshot) return;

    const api = toApiMessages(snapshot.messages, sysPrompt());
    if (!api.length) return;

    const bot = newMessage("assistant", "");
    bot.model = asText(chatModels.get(settings.model)?.name, "") || asText(settings.model, "GPT");
    bot.streaming = true;

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    patchConv(convId, (c) => ({ ...c, messages: [...c.messages, bot] }));

    const apply = (mutate) => patchConv(convId, (c) => {
      const messages = [...c.messages];
      const i = messages.findIndex((m) => m.id === bot.id);
      if (i >= 0) messages[i] = mutate({ ...messages[i] });
      return { ...c, messages };
    });

    try {
      const result = await runTurn({
        messages: api,
        model: settings.model,
        stream: settings.stream,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        signal: controller.signal,
      }, {
        onText: (_d, all) => apply((m) => ({ ...m, text: all })),
        onReasoning: (_d, all) => apply((m) => ({ ...m, reasoning: all })),
        onImage: (img) => apply((m) => ({ ...m, images: [...(m.images || []), img] })),
        onUsage: (usage, finishReason, usageDetails) => {
          apply((m) => ({ ...m, usage, finishReason, usageDetails }));
          setStats(describeUsage(usage, usageDetails));
        },
      });
      apply((m) => ({
        ...m,
        text: result.text,
        reasoning: result.reasoning || m.reasoning,
        images: result.images.length ? result.images : m.images,
        usageDetails: result.usageDetails || m.usageDetails,
      }));
    } catch (err) {
      if (err?.name === "AbortError" || /stopped/i.test(err?.message || "")) {
        apply((m) => ({ ...m, stopped: true, text: m.text || "_Stopped._" }));
      } else {
        apply((m) => ({ ...m, error: describeError(err) }));
        toast(describeError(err), "err");
      }
    } finally {
      apply((m) => ({ ...m, streaming: false }));
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => persist(convId), 0);
    }
  }, [conversations, settings, patchConv, persist, toast]);

  /* ── image generation ─────────────────────────────────── */
  const runImageGen = useCallback(async (convId, prompt, inputImages = []) => {
    const bot = newMessage("assistant", "");
    bot.kind = "image";
    bot.prompt = prompt;
    bot.canSave = store.signedIn;
    bot.model = asText(imageModels.get(settings.imageModel)?.name, "") || asText(settings.imageModel, "Image model");
    bot.pending = true;
    bot.imageMeta = {
      ratio: settings.imageRatio || "1:1",
      quality: settings.imageQuality || null,
      test: !!settings.imageTest,
    };

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    patchConv(convId, (c) => ({ ...c, messages: [...c.messages, bot] }));

    const apply = (mutate) => patchConv(convId, (c) => {
      const messages = [...c.messages];
      const i = messages.findIndex((m) => m.id === bot.id);
      if (i >= 0) messages[i] = mutate({ ...messages[i] });
      return { ...c, messages };
    });

    // txt2img often returns a temporary URL; keep a copy in the user's drive.
    const outPath = store.signedIn && !settings.imageTest ? imageOutputPath(prompt) : null;

    try {
      const { src } = await generateImage({
        prompt,
        model: settings.imageModel,
        ratioId: settings.imageRatio,
        quality: settings.imageQuality,
        inputImage: inputImages?.[0],
        testMode: settings.imageTest,
        outputPath: outPath,
      });
      apply((m) => ({ ...m, images: [{ image_url: { url: src } }], savedPath: outPath || undefined }));
    } catch (err) {
      apply((m) => ({ ...m, error: describeError(err) }));
      toast(describeError(err), "err");
    } finally {
      apply((m) => ({ ...m, pending: false }));
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => persist(convId), 0);
    }
  }, [settings, patchConv, persist, toast]);

  /* ── send ──────────────────────────────────────────────── */
  const send = useCallback(async () => {
    if (streaming) return;
    const text = input.trim();
    if (!text && !attachments.length) return;

    let target = conv;
    if (!target) { await createConversation(); return; }
    const convId = target.id;
    const image = mode === "image";
    if (image && !text) { toast("Describe the image you want first.", "err"); return; }

    const userMsg = newMessage("user", text);
    if (text) userMsg.attachments = attachments.map((a) => ({ name: a.name, size: a.size }));
    const inline = attachments.map((a) => a.dataUrl).filter(Boolean);
    if (inline.length) setPreviews((p) => ({ ...p, [userMsg.id]: inline }));

    const title = !text ? target.title : (target.title === "New chat" ? deriveTitle({ messages: [userMsg] }) : target.title);

    setInput("");
    setAttachments([]);

    // Optimistic insert, then upload in the background.
    patchConv(convId, (c) => ({
      ...c,
      title,
      messages: [...c.messages, userMsg],
    }));

    if (image) {
      setTimeout(() => runImageGen(convId, text, inline), 0);
      return;
    }

    if (attachments.length) {
      const uploaded = [];
      for (const a of attachments) {
        if (store.signedIn && a.file) {
          try { uploaded.push(await uploadImage(a.file)); continue; } catch { /* fall through */ }
        }
        uploaded.push({ name: a.name, dataUrl: a.dataUrl, size: a.size });
      }
      patchConv(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === userMsg.id ? { ...m, attachments: uploaded } : m)),
      }));
    }
    setTimeout(() => runAssistant(convId), 0);
  }, [streaming, input, attachments, conv, mode, createConversation, patchConv, runAssistant, runImageGen, toast]);

  /* ── regenerate / show-image ───────────────────────────── */
  const regenerate = useCallback(async (messageId) => {
    if (streaming) return;
    const c = conversations.find((x) => x.id === currentId);
    if (!c) return;
    const idx = c.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const target = c.messages[idx];
    if (target.kind === "image") {
      let p = idx - 1;
      while (p >= 0 && c.messages[p].role !== "user") p--;
      const src = p >= 0 ? c.messages[p] : null;
      const prompt = asText(src?.text, "") || asText(target.prompt, "");
      const ref = src ? (previews[src.id]?.[0] || "") : "";
      patchConv(currentId, (x) => ({ ...x, messages: x.messages.slice(0, idx) }));
      setTimeout(() => { if (prompt) runImageGen(currentId, prompt, ref ? [ref] : []); }, 0);
      return;
    }

    patchConv(currentId, (x) => ({ ...x, messages: x.messages.slice(0, idx) }));
    setTimeout(() => runAssistant(currentId), 0);
  }, [streaming, conversations, currentId, previews, patchConv, runAssistant, runImageGen]);

  const showImage = useCallback(async (messageId) => {
    if (streaming) return;
    const c = conversations.find((x) => x.id === currentId);
    const source = c?.messages.find((m) => m.id === messageId);
    if (!source?.text?.trim()) return;
    const excerpt = source.text.replace(/\s+/g, " ").trim().slice(0, 600);
    const prompt = `A beautifully styled food photograph inspired by this: ${excerpt}`;
    setMode("image");
    await runImageGen(currentId, prompt, []);
  }, [streaming, conversations, currentId, runImageGen]);

  /* ── image download / save ─────────────────────────────── */
  const downloadImage = useCallback(async (message, src) => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(message.prompt || "image")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Image downloaded", "ok");
    } catch {
      window.open(src, "_blank", "noopener");
    }
  }, [toast]);

  const saveImageToDrive = useCallback(async (message, src) => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const saved = await puter.fs.write(imageOutputPath(message.prompt), blob);
      patchConv(currentId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === message.id ? { ...m, savedPath: saved.path } : m)),
      }));
      toast("Saved to your Puter drive", "ok");
    } catch (err) { toast(describeError(err), "err"); }
  }, [currentId, patchConv, toast]);

  /* ── settings ──────────────────────────────────────────── */
  const onSettingChange = useCallback(async (patch) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(patch);
      return next;
    });
  }, []);

  const exportChat = useCallback((format) => {
    if (!conv?.messages.length) { toast("Nothing to export yet.", "err"); return; }
    const stamp = new Date(conv.createdAt || Date.now()).toISOString().slice(0, 10);
    const base = `${slug(conv.title)}-${stamp}`;
    if (format === "json") {
      downloadBlob(`${base}.json`, JSON.stringify(conv, null, 2), "application/json");
    } else {
      const lines = [`# ${asText(conv.title, "Chat")}`, "", `_Exported ${new Date().toLocaleString()}_`, ""];
      for (const m of conv.messages) {
        if (m.deleted) continue;
        lines.push(m.role === "user" ? "## You" : `## ${asText(m.model, "GPT")}`);
        if (m.attachments?.length) {
          lines.push("", ...m.attachments.map((a) => `- 📎 ${asText(a.name, "attachment")}${a.path ? ` (${a.path})` : ""}`));
        }
        if (m.kind === "image") {
          const src = asText(m.images?.[0]?.image_url?.url, "");
          lines.push("", `**Prompt:** ${asText(m.prompt, "")}`);
          if (src) lines.push("", `![Generated image](${src})`);
          if (m.savedPath) lines.push("", `_Saved to ${m.savedPath}_`);
          if (m.error) lines.push("", `_Error: ${asText(m.error, "")}_`);
          lines.push("");
          continue;
        }
        lines.push("", m.text || "", "");
      }
      downloadBlob(`${base}.md`, lines.join("\n"));
    }
    toast(`Exported as ${format.toUpperCase()}`, "ok");
  }, [conv, toast]);

  /* ── auth ──────────────────────────────────────────────── */
  const loadAccountStats = useCallback(async () => {
    if (!store.signedIn) { setAccountStats([]); return; }
    const [space, usage] = await Promise.all([
      puter.fs.space().catch(() => null),
      puter.auth.getMonthlyUsage().catch(() => null),
    ]);
    setAccountStats(buildAccountStats(space, usage, puter.appID));
  }, []);

  const toggleAccount = useCallback((force) => {
    const next = force ?? !accountOpen;
    setAccountOpen(next);
    setModelOpen(false);
    if (next) loadAccountStats();
  }, [accountOpen, loadAccountStats]);

  const handleAuth = useCallback(async () => {
    setAccountOpen(false);
    try {
      if (store.signedIn) {
        const res = await puter.auth.signOut();
        if (res && res.success === false) { toast(asText(res.message ?? res.error, "Could not sign out."), "err"); return; }
        location.reload();
      } else {
        await puter.auth.signIn();
        location.reload();
      }
    } catch (err) { toast(describeError(err), "err"); }
  }, [toast]);

  /* ── profile ───────────────────────────────────────────── */
  const saveProfileDraft = useCallback((next, opts = {}) => {
    setProfile(next);
    setDraft(next);
    if (opts.commit) {
      saveProfile(next);
      setProfileOpen(false);
      setDraft({});
      toast(hasProfile(next) ? "Profile saved — replies will use it" : "Profile cleared",
        hasProfile(next) ? "ok" : "");
    }
  }, [toast]);

  const doClearProfile = useCallback(() => {
    const blank = { ...BLANK_PROFILE };
    setProfile(blank);
    setDraft(blank);
    clearProfile();
    toast("Profile cleared", "ok");
  }, [toast]);

  /* ── models menu ───────────────────────────────────────── */
  const catalogue = mode === "image" ? imageModels : chatModels;
  const activeModel = mode === "image" ? settings?.imageModel : settings?.model;
  const groups = useMemo(
    () => (ready && catalogue ? catalogue.search(modelQuery) : []),
    [ready, catalogue, modelQuery]
  );
  const totalModels = groups.reduce((n, g) => n + g.list.length, 0);

  const pickModel = useCallback(async (id) => {
    setModelOpen(false);
    if (mode === "image") {
      const tiers = qualityTiersFor(id);
      const patch = { imageModel: id };
      if (!tiers.includes(settings.imageQuality)) patch.imageQuality = tiers[0] || "";
      setSettings((s) => ({ ...s, ...patch }));
      saveSettings(patch);
    } else {
      setSettings((s) => ({ ...s, model: id }));
      saveSettings({ model: id });
    }
  }, [mode, settings?.imageQuality]);

  /* ── keyboard ──────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        const next = !sidebarOpen;
        setSidebarOpen(next);
        saveSettings({ sidebarCollapsed: !next });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !streaming) {
        e.preventDefault();
        createConversation();
      }
      if (e.key === "Escape") { setSidebarOpen(false); setModelOpen(false); setAccountOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen, streaming, createConversation]);

  /* ── render ────────────────────────────────────────────── */
  if (!ready || !settings) {
    return (
      <div className="grid h-dvh place-items-center bg-ink-900 text-neutral-500">
        <p className="font-mono text-sm">Loading GPT…</p>
      </div>
    );
  }

  const pills = mode === "image" ? IMAGE_PILLS : CHAT_PILLS;

  // Side gutters respect the notch; the bottom gutter clears the home indicator.
  const gutter =
    "px-4 pl-4 max-sm:pl-[calc(1rem+var(--safe-l))] pr-4 max-sm:pr-[calc(1rem+var(--safe-r))] pb-[max(0.25rem,var(--safe-b))]";
  const latestReplyId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.kind !== "image" && m.text?.trim()) return m.id;
    }
    return null;
  })();

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      mode={mode}
      onToggleMode={() => setMode(mode === "image" ? "chat" : "image")}
      onSend={send}
      onStop={() => abortRef.current?.abort()}
      streaming={streaming}
      attachments={attachments}
      onAddFiles={addFiles}
      onRemoveAttachment={(i) => setAttachments((a) => a.filter((_, x) => x !== i))}
      ratio={settings.imageRatio}
      onRatio={(v) => onSettingChange({ imageRatio: v })}
      tiers={qualityTiersFor(settings.imageModel)}
      quality={settings.imageQuality}
      onQuality={(v) => onSettingChange({ imageQuality: v })}
      test={!!settings.imageTest}
      onTest={(v) => onSettingChange({ imageTest: v })}
      hasMessages={hasMessages}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        open={sidebarOpen}
        onCollapse={() => { setSidebarOpen(false); saveSettings({ sidebarCollapsed: true }); }}
        nav={{
          new: createConversation,
          image: async () => { await createConversation(); setMode("image"); },
          ask: () => { setAccountOpen(false); setDraft({ ...profile }); setProfileOpen(true); },
        }}
        search={search}
        onSearch={setSearch}
        conversations={conversations}
        currentId={currentId}
        onSelect={selectConversation}
        onDelete={deleteConversation}
        profileOn={hasProfile(profile)}
        account={
          <AccountMenu
            user={{
              name: asText(store.user?.username, "") || asText(store.user?.name, "") || "Guest",
              picture: store.picture || "",
              signedIn: store.signedIn,
              subtitle: store.isCloud ? "Synced to your Puter account" : "Saved on this device",
            }}
            stats={accountStats}
            open={accountOpen}
            onToggle={toggleAccount}
            onSettings={() => { setAccountOpen(false); setSettingsOpen(true); }}
            onAuth={handleAuth}
          />
        }
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-1 px-2 pt-[var(--safe-t)] pb-2 md:px-3">
          <button
            onClick={() => { setSidebarOpen(true); saveSettings({ sidebarCollapsed: false }); }}
            /* Must appear on desktop too: once collapsed, the only reopen
               control is this button (the collapse button lives inside the
               hidden sidebar). Hiding it at md+ left PC users stuck. */
            className={`grid size-10 place-items-center rounded-lg text-neutral-400 hover:bg-ink-800 hover:text-neutral-100 ${
              sidebarOpen ? "md:hidden" : ""
            }`}
            title="Show sidebar" aria-label="Show sidebar"
          >
            <IconMenu className="size-5" />
          </button>

          <div className="relative min-w-0">
            <ModelTrigger
              name={asText(catalogue.get(activeModel)?.name, "") || asText(activeModel, "Select a model")}
              expanded={modelOpen}
              onClick={() => { setModelOpen((o) => !o); setAccountOpen(false); }}
            />
            <ModelMenu
              open={modelOpen}
              onClose={() => setModelOpen(false)}
              mode={mode}
              query={modelQuery}
              onQuery={setModelQuery}
              groups={groups}
              activeId={activeModel}
              onPick={pickModel}
              total={totalModels}
            />
          </div>

          <div className="flex-1" />
          <div className="font-mono text-[11.5px] text-neutral-500 max-sm:hidden">{stats}</div>
          <button
            onClick={(e) => exportChat(e.shiftKey ? "json" : "md")}
            title="Export as Markdown (Shift+click for JSON)"
            aria-label="Export"
            className="grid size-9 place-items-center rounded-md text-neutral-400 hover:bg-ink-700 hover:text-neutral-100 min-[420px]:size-8"
          >
            <IconDownload className="size-4" />
          </button>
        </header>

        <div className={`flex min-h-0 flex-1 flex-col ${hasMessages ? "" : "justify-center"}`}>
          <div ref={scrollerRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-content space-y-8 px-4 pt-1 pb-2.5 max-sm:px-4
                            pl-4 max-sm:pl-[calc(1rem+var(--safe-l))] pr-4 max-sm:pr-[calc(1rem+var(--safe-r))]">
              {!hasMessages ? (
                <div className="pt-6 text-center">
                  <h1 className="mb-2 text-2xl font-medium tracking-tight sm:text-3xl">
                    Ask GPT anything.
                  </h1>
                  <p className="text-sm text-neutral-400">
                    {mode === "image"
                      ? "Describe a picture and any image model will draw it."
                      : "500+ models, one place, your data stays in your Puter account."}
                  </p>
                </div>
              ) : (
                messages.map((m) => (
                  <Message
                    key={m.id}
                    message={m}
                    isLatest={m.id === latestReplyId}
                    streaming={streaming}
                    previews={previews[m.id]}
                    onCopy={(msg) => navigator.clipboard?.writeText(msg.text || "").then(
                      () => toast("Reply copied", "ok"), () => toast("Could not copy", "err"))}
                    onRegenerate={regenerate}
                    onShowImage={showImage}
                    onDelete={deleteMessage}
                    onDownload={downloadImage}
                    onSave={saveImageToDrive}
                  />
                ))
              )}
            </div>
          </div>

          {/* Safe-area gutters: notch on the sides, home indicator below. */}
          {!hasMessages ? (
            <>
              <div className={`mx-auto w-full max-w-content shrink-0 ${gutter}`}>{composer}</div>
              <div className={`pills-row mx-auto mt-5 flex w-full flex-wrap justify-center gap-2 ${gutter} pb-2`}>
                {pills.map(({ label, Icon, tone, prompt }) => (
                  <button
                    key={label}
                    onClick={() => { setInput(`${prompt} `); }}
                    title={prompt}
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-ink-700 px-3.5 py-2 text-sm text-neutral-300 hover:bg-ink-800"
                  >
                    <Icon className={`size-4 ${tone}`} />{label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className={`mx-auto w-full max-w-content shrink-0 ${gutter} pb-1`}>{composer}</div>
          )}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={onSettingChange}
        onClearChat={async () => {
          patchConv(currentId, (c) => ({ ...c, messages: [], trimmed: false }));
          await save({ ...conv, messages: [] });
          setSettingsOpen(false);
          toast("Conversation cleared", "ok");
        }}
        onDeleteAll={async () => {
          if (!confirm("Delete every conversation and setting stored by this app? This cannot be undone.")) return;
          await clearAll();
          await clearSettings();
          location.reload();
        }}
      />

      <ProfileDialog
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setDraft({}); }}
        profile={draft.name || draft.role || draft.goals || draft.avoid || draft.tone !== "balanced" ? draft : profile}
        onSave={saveProfileDraft}
        onClear={doClearProfile}
        knownUser={asText(store.user?.username, "") || asText(store.user?.name, "")}
        signedIn={store.signedIn}
        basePrompt={settings.systemPrompt}
      />

      <div className="pointer-events-none fixed bottom-5 left-1/2 z-100 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-toast-in max-w-[90vw] rounded-[10px] border px-3.5 py-2 text-sm shadow-2xl
                        ${t.kind === "err" ? "border-red-400/40 bg-ink-700 text-red-300"
                          : t.kind === "ok" ? "border-emerald-400/40 bg-ink-700 text-emerald-200"
                          : "border-ink-600 bg-ink-700"}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

function downloadBlob(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describeUsage(usage, usageDetails) {
  if (!usage && !usageDetails) return "";
  const cost = usageCostUsd(usage);
  const t = usageDetails?.inputTokens ?? usage?.prompt_tokens;
  const o = usageDetails?.outputTokens ?? usage?.completion_tokens;
  const parts = [];
  if (typeof t === "number") parts.push(`${t.toLocaleString()} in`);
  if (typeof o === "number") parts.push(`${o.toLocaleString()} out`);
  if (cost != null) parts.push(`$${cost.toFixed(4)}`);
  return parts.join(" · ");
}

export { dateGroup };