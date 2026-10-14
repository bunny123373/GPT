"use client";

import { useEffect, useRef } from "react";
import { formatPrice } from "../lib/ai";
import { IconSearch, IconChevron } from "./icons";

/**
 * Anchored dropdown for the model picker. Closes on outside click and Escape;
 * flips to the right edge on narrow screens so it never overhangs the viewport.
 */
export default function ModelMenu({
  open, onClose, mode, query, onQuery, groups, activeId, onPick, total,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute top-[calc(100%+6px)] right-0 z-40 flex max-h-[min(70dvh,560px)] w-[min(340px,calc(100vw-24px))]
                 flex-col rounded-2xl border border-ink-700 bg-ink-800 p-1.5 shadow-2xl animate-menu-in"
    >
      <div className="px-1 pt-1 pb-1.5">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={mode === "image" ? "Search image models…" : "Search 500+ models…"}
            aria-label="Search models"
            className="w-full rounded-[10px] bg-ink-750 px-3 py-2 pr-2.5 pl-9 text-sm outline-none placeholder-neutral-500 focus:border focus:border-ink-600"
          />
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-neutral-500">No models match that search.</p>
        )}
        {groups.map(({ provider, list }) => (
          <div key={provider}>
            <p className="sticky top-0 bg-ink-800 px-3 pt-2.5 pb-1.5 text-xs font-medium text-neutral-500">
              {provider} ({list.length})
            </p>
            {list.map((m) => (
              <button
                key={m.id}
                role="menuitemradio"
                aria-checked={m.id === activeId}
                onClick={() => onPick(m.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-ink-700
                            ${m.id === activeId ? "bg-emerald-500/15" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name || m.id}</span>
                  <span className="block truncate font-mono text-xs text-neutral-500">
                    {m.id}{m.context ? ` · ${Math.round(Number(m.context) / 1000)}k ctx` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-xs text-neutral-500">
                  {formatPrice(m.cost)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <p className="border-t border-ink-700 px-3 pt-2 pb-1 text-xs text-neutral-500">
        {total} {mode === "image" ? "image model" : "model"}{total === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** The header button that opens the menu above. */
export function ModelTrigger({ name, onClick, expanded, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={expanded}
      title={name}
      className="flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-lg font-medium hover:bg-ink-800"
    >
      <span className="shrink-0">GPT</span>
      <span className="truncate">{children ?? name}</span>
      <IconChevron />
    </button>
  );
}