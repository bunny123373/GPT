"use client";

import { useEffect, useRef } from "react";
import { ASPECT_RATIOS } from "../lib/imagegen";
import { IconImage, IconX, IconPaperclip, IconArrowUp, IconStop } from "./icons";

export default function Composer({
  value, onChange, mode, onToggleMode, onSend, onStop, streaming,
  attachments, onAddFiles, onRemoveAttachment,
  ratio, onRatio, tiers, quality, onQuality, test, onTest,
  hasMessages,
}) {
  const ref = useRef(null);

  // Auto-grow, capped so the thread keeps most of the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [value]);

  const image = mode === "image";
  const ready = value.trim().length > 0 || attachments.length > 0;

  const onKeyDown = (e) => {
    // On touch devices the virtual keyboard's Enter must still insert a newline.
    const fine = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && fine) {
      e.preventDefault();
      if (ready && !streaming) onSend();
    }
  };

  return (
    <div className="w-full">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={i} className="relative size-[60px] overflow-hidden rounded-[10px] border border-ink-700 bg-ink-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.dataUrl} alt={a.name} className="size-full object-cover" />
              <button
                onClick={() => onRemoveAttachment(i)}
                title="Remove attachment"
                className="absolute top-[3px] right-[3px] grid size-[18px] place-items-center rounded-full border-0 bg-black/70 text-[12px] leading-none text-white hover:bg-red-500"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-[28px] bg-ink-750 px-3 pt-3 pb-2">
        {image && (
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-ink-700 pb-2.5 px-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-500">
              Shape
              <select
                value={ratio}
                onChange={(e) => onRatio(e.target.value)}
                aria-label="Aspect ratio"
                className="cursor-pointer rounded-lg border border-ink-600 bg-ink-800 px-2 py-[5px] text-[13px] outline-none focus:border-accent"
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r.id} value={r.id}>{r.id}</option>
                ))}
              </select>
            </label>

            {tiers.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                Quality
                <select
                  value={quality}
                  onChange={(e) => onQuality(e.target.value)}
                  aria-label="Image quality"
                  className="cursor-pointer rounded-lg border border-ink-600 bg-ink-800 px-2 py-[5px] text-[13px] outline-none focus:border-accent"
                >
                  {tiers.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
              <input
                type="checkbox"
                checked={test}
                onChange={(e) => onTest(e.target.checked)}
                className="size-3.5 accent-accent"
              />
              Test
            </label>
          </div>
        )}

        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...(e.clipboardData?.files || [])];
            if (files.length) { e.preventDefault(); onAddFiles(files); }
          }}
          aria-label="Message"
          placeholder={image ? "Describe an image" : "Message GPT…"}
          className="block max-h-52 w-full resize-none bg-transparent px-2 pb-2 text-[15px] leading-6 text-neutral-100 outline-none placeholder-neutral-500"
        />

        <div className="mt-2 flex items-center gap-1">
          <button
            onClick={onToggleMode}
            disabled={streaming}
            aria-pressed={image}
            title="Generate an image from your prompt"
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors
                        disabled:opacity-40
                        ${image
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                          : "border-ink-600 text-neutral-300 hover:bg-ink-700"}`}
          >
            <IconImage className="size-4" />
            <span className="max-[400px]:hidden">Image</span>
            {image && <IconX className="size-3.5" />}
          </button>

          <label
            className="grid size-9 cursor-pointer place-items-center rounded-full text-neutral-400 hover:bg-ink-700 hover:text-neutral-100"
            title={image ? "Attach a reference image" : "Attach an image"}
          >
            <IconPaperclip />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { onAddFiles([...e.target.files]); e.target.value = ""; }}
            />
          </label>

          <div className="flex-1" />

          {/* One button: the send arrow becomes a stop square while streaming. */}
          {streaming ? (
            <button
              onClick={onStop}
              title="Stop generating"
              aria-label="Stop generating"
              className="grid size-9 place-items-center rounded-full bg-white text-ink-900 hover:bg-neutral-200"
            >
              <IconStop />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!ready}
              title="Send"
              aria-label="Send"
              className="grid size-9 place-items-center rounded-full bg-white text-ink-900 hover:bg-neutral-200
                         disabled:cursor-default disabled:bg-ink-600 disabled:text-neutral-400"
            >
              <IconArrowUp />
            </button>
          )}
        </div>
      </div>

      {hasMessages && (
        <p className="short-hide mt-2 px-2 pb-2.5 text-center text-xs text-neutral-500">
          GPT can make mistakes — verify important info.
        </p>
      )}
    </div>
  );
}