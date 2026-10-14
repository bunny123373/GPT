"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { asText } from "../lib/ai";
import { readURL } from "../lib/imagegen";
import {
  counts, filterItems, formatBytes, listMedia,
} from "../lib/gallery";

import {
  IconX, IconDownload, IconRedo, IconImage, IconFrame, IconStar,
} from "./icons";

/* ── Media tile ───────────────────────────────────────────── */

/**
 * One grid cell.
 *
 * Read URLs are minted lazily per tile and cached by path in `urls`, because
 * minting is a network round-trip each. A 300-image gallery must not fire 300
 * of them on first paint — tiles mint as they scroll into view.
 */
function Tile({ item, url, nonce, onMint, onOpen, onRetry }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [broken, setBroken] = useState(false);         // URL minted, fetch failed
  const [unmintable, setUnmintable] = useState(false); // URL couldn't be minted at all

  // `nonce` is bumped on retry. Keying on `url` alone is not enough: a retry
  // that fails to mint leaves the url empty, so the reset never fires and the
  // tile would refuse to try again.
  useEffect(() => { setBroken(false); setUnmintable(false); }, [url, nonce]);

  // Only mint a URL once the tile is near the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return undefined;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true); },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || url || broken || unmintable) return;
    let cancelled = false;
    Promise.resolve(onMint(item)).then((minted) => {
      // A null result means minting failed; without this the tile would sit on
      // an empty placeholder forever with no way to tell it apart from loading.
      if (!cancelled && !minted) setUnmintable(true);
    });
    return () => { cancelled = true; };
  }, [visible, url, broken, unmintable, item, onMint]);

  const failed = broken || unmintable;

  return (
    <button
      ref={ref}
      onClick={() => (url && !failed ? onOpen(item) : onRetry(item))}
      title={item.name}
      className="group relative aspect-square w-full overflow-hidden rounded-xl bg-ink-850
                 ring-1 ring-ink-700 transition hover:ring-ink-600
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {url && !failed ? (
        item.kind === "video" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            onError={() => setBroken(true)}
            className="size-full bg-black object-cover"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
          />
        )
      ) : (
        <div className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-neutral-500">
          {failed ? "Could not load. Tap to retry." : <IconFrame className="size-6" />}
        </div>
      )}

      {/* Tap affordance on touch, where there's no hover to reveal a label. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2
                      bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 text-left opacity-0
                      transition group-hover:opacity-100 max-sm:opacity-100">
        <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-200">{item.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-neutral-400">
          {item.kind === "video" ? item.ext.toUpperCase() : formatBytes(item.size)}
        </span>
      </div>
    </button>
  );
}

/* ── Lightbox ─────────────────────────────────────────────── */

function Lightbox({ item, url, onClose, onPrev, onNext }) {
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose, onPrev, onNext]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-70 flex flex-col bg-black/85 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-200">{item.name}</p>
          <p className="font-mono text-[11px] text-neutral-500">
            {item.kind === "video" ? "Video" : "Image"} · {item.ext.toUpperCase()} · {formatBytes(item.size)}
            {item.modified ? ` · ${new Date(item.modified).toLocaleDateString()}` : ""}
          </p>
        </div>
        <a
          href={url || "#"}
          download={item.name}
          aria-disabled={!url}
          onClick={(e) => { if (!url) e.preventDefault(); }}
          className={`rounded-lg p-2 hover:bg-white/10 ${url ? "text-neutral-200" : "pointer-events-none text-neutral-600"}`}
          title="Download"
        >
          <IconDownload className="size-5" />
        </a>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-neutral-300 hover:bg-white/10"
          title="Close" aria-label="Close"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-3 sm:px-14">
        <button
          onClick={onPrev}
          className="absolute left-1 z-10 rounded-full bg-black/50 p-2 text-neutral-200 hover:bg-black/80 sm:left-2"
          title="Previous" aria-label="Previous"
        >
          <IconRedo className="size-5 rotate-180" />
        </button>

        {url ? (
          item.kind === "video" ? (
            /* eslint-disable-next-line jsx-a11y/media-has-caption */
            <video src={url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt={item.name} className="max-h-full max-w-full rounded-lg object-contain" />
          )
        ) : (
          <p className="text-sm text-neutral-400">Loading…</p>
        )}

        <button
          onClick={onNext}
          className="absolute right-1 z-10 rounded-full bg-black/50 p-2 text-neutral-200 hover:bg-black/80 sm:right-2"
          title="Next" aria-label="Next"
        >
          <IconRedo className="size-5" />
        </button>
      </div>
    </div>
  );
}

/* ── Gallery ──────────────────────────────────────────────── */

const TABS = [
  { id: "all", label: "All", Icon: IconStar },
  { id: "image", label: "Images", Icon: IconImage },
  { id: "video", label: "Videos", Icon: IconFrame },
];

export default function Gallery({ signedIn, onSignIn, onToast }) {
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState({});        // path -> read URL
  const [nonce, setNonce] = useState({});      // path -> retry counter
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openPath, setOpenPath] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listMedia();
      setItems(res.items);
      // listMedia resolves with a reason rather than throwing when it couldn't
      // read anything at all — a total failure is still a failed load.
      setError(asText(res.error, ""));
      // Read URLs are minted per-tile, but a refresh must invalidate them:
      // these are signed and expire, so a stale map shows broken images.
      setUrls({});
      setNonce({});
    } catch (err) {
      setError(asText(err, "Could not read your drive."));
    } finally {
      setLoading(false);
    }
  }, []);

  // Don't scan at all while signed out: every directory read would fail, and
  // the result is discarded by the sign-in prompt below.
  useEffect(() => { if (signedIn) load(); }, [signedIn, load]);

  const mint = useCallback(async (item) => {
    try {
      const url = await readURL(item.path);
      if (url) setUrls((u) => (u[item.path] ? u : { ...u, [item.path]: url }));
      return url;
    } catch (err) {
      onToast?.(asText(err, "Could not open that file."), "err");
      return null;
    }
  }, [onToast]);

  const retry = useCallback((item) => {
    setUrls((u) => { const n = { ...u }; delete n[item.path]; return n; });
    setNonce((n) => ({ ...n, [item.path]: (n[item.path] || 0) + 1 }));
    mint(item);
  }, [mint]);

  const totals = useMemo(() => counts(items), [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = filterItems(items, tab);
    return (q ? base.filter((i) => i.name.toLowerCase().includes(q)) : base)
      .slice()
      .sort((a, b) => (b.modified - a.modified) || a.name.localeCompare(b.name));
  }, [items, tab, query]);

  const openIndex = visible.findIndex((i) => i.path === openPath);
  const openItem = openIndex >= 0 ? visible[openIndex] : null;

  const step = useCallback((delta) => {
    if (!visible.length) return;
    const i = (openIndex + delta + visible.length) % visible.length;
    setOpenPath(visible[i].path);
  }, [openIndex, visible]);

  // Mint the lightbox's URL up front so it never shows an empty frame.
  useEffect(() => {
    if (openItem && !urls[openItem.path]) mint(openItem);
  }, [openItem, urls, mint]);

  if (!signedIn) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="max-w-sm text-center">
          <IconImage className="mx-auto mb-4 size-9 text-neutral-600" />
          <h2 className="mb-1.5 text-lg font-medium">Your gallery lives in your Puter account</h2>
          <p className="mb-5 text-sm text-neutral-400">
            Sign in to see the images you've generated. They stay in your own drive — nothing is uploaded anywhere else.
          </p>
          <button
            onClick={onSignIn}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-950 hover:bg-emerald-400"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filters stay put while the grid scrolls — the whole point of a
          filterable grid is that changing the filter doesn't lose your place. */}
      <div className="shrink-0 border-b border-black px-3 pb-2.5">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-ink-850 p-1">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition ${
                  tab === id
                    ? "bg-ink-700 text-neutral-100"
                    : "text-neutral-400 hover:bg-ink-800 hover:text-neutral-200"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
                <span className="font-mono text-[11px] text-neutral-500">{totals[id]}</span>
              </button>
            ))}
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name"
            aria-label="Filter gallery by name"
            className="min-w-0 flex-1 rounded-lg bg-ink-850 px-3 py-1.5 text-[13.5px]
                       outline-none focus:border focus:border-ink-700 sm:max-w-xs"
          />

          <button
            onClick={load}
            disabled={loading}
            title="Rescan your drive"
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-neutral-400 hover:bg-ink-800 hover:text-neutral-100 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4
                      pl-3 max-sm:pl-[calc(0.75rem+var(--safe-l))]
                      pr-3 max-sm:pr-[calc(0.75rem+var(--safe-r))]">
        <div className="mx-auto w-full max-w-content">
          {error && (
            <p className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading && !items.length && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-ink-850" />
              ))}
            </div>
          )}

          {!loading && !items.length && !error && (
            <p className="py-10 text-center text-sm text-neutral-500">
              Nothing here yet. Images you generate are saved to your Puter drive automatically.
            </p>
          )}

          {!!items.length && !visible.length && (
            <p className="py-10 text-center text-sm text-neutral-500">
              {query ? `Nothing matches “${query}”.` : `No ${tab === "image" ? "images" : "videos"} yet.`}
            </p>
          )}

          {!!visible.length && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((item) => (
                <Tile
                  key={item.path}
                  item={item}
                  url={urls[item.path] || ""}
                  nonce={nonce[item.path] || 0}
                  onMint={mint}
                  onOpen={(i) => setOpenPath(i.path)}
                  onRetry={retry}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Lightbox
        item={openItem}
        url={openItem ? urls[openItem.path] || "" : ""}
        onClose={() => setOpenPath(null)}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
      />
    </div>
  );
}
