"use client";

import { useEffect, useState } from "react";
import { renderMarkdown } from "../lib/markdown";
import { asText } from "../lib/ai";
import { IconCopy, IconRedo, IconDownload, IconTrash, IconSparkle } from "./icons";

/* ── Reply actions (newest reply only) ───────────────────── */

function ReplyActions({ message, onCopy, onRegenerate, onShowImage }) {
  return (
    <div className="-ml-1.5 mt-2 flex flex-wrap items-center gap-0.5">
      <button onClick={onCopy} title="Copy this reply"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
        <IconCopy className="size-4" /><span>Copy</span>
      </button>
      <button onClick={onRegenerate} title="Answer again"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
        <IconRedo className="size-4" /><span>Regenerate</span>
      </button>
      <button onClick={onShowImage} title="Turn this reply into an image"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-accent hover:bg-accent-soft hover:text-emerald-300">
        <IconSparkle className="size-4" /><span>Show me an image.</span>
      </button>
      <span className="ml-1.5 text-xs text-neutral-500">
        {new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

/* ── Generated image card ────────────────────────────────── */

function ImageCard({ message, onDownload, onSave, onRegenerate, onDelete }) {
  const src = asText(message.images?.[0]?.image_url?.url ?? message.images?.[0]?.url, "");
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const bits = [asText(message.model, ""), message.imageMeta?.ratio, message.imageMeta?.quality].filter(Boolean);

  return (
    <div className="max-w-[448px]">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-ink-800">
        {message.pending ? (
          <div className={`absolute inset-0 grid place-items-center ${!failed ? "animate-plating" : ""}`}>
            <div className="flex flex-col items-center gap-3 text-sm text-neutral-400">
              <IconSparkle className="size-7 animate-pulse text-emerald-400" />
              <span className="animate-fade-text">Creating image…</span>
            </div>
          </div>
        ) : src && !failed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt={asText(message.prompt, "Generated image")}
            loading="lazy"
            onError={() => setFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-neutral-400">
            {failed
              ? (message.savedPath
                  ? "Could not load this image. Try downloading it again."
                  : "Image link expired — regenerate to view it.")
              : "No image returned."}
          </div>
        )}
      </div>

      {message.prompt && (
        <p className="mt-2 max-w-[448px] truncate text-sm text-neutral-400" title={asText(message.prompt, "")}>
          {asText(message.prompt, "")}
        </p>
      )}

      {bits.length > 0 && (
        <p className="-ml-1.5 mt-0.5 font-mono text-[11px] text-neutral-500">
          {bits.join(" · ")}{message.savedPath ? " · saved" : ""}
        </p>
      )}

      {message.error && (
        <div className="mt-2.5 rounded-lg border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
          {asText(message.error, "The request failed.")}
        </div>
      )}

      <div className="-ml-1.5 mt-1 flex items-center gap-0.5">
        {src && !failed && (
          <button onClick={() => onDownload(message, src)} title="Download"
            className="rounded-md p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
            <IconDownload className="size-4" />
          </button>
        )}
        {message.prompt && (
          <button onClick={() => navigator.clipboard?.writeText(message.prompt)} title="Copy prompt"
            className="rounded-md p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
            <IconCopy className="size-4" />
          </button>
        )}
        {!message.savedPath && message.canSave && src && !failed && (
          <button onClick={() => onSave(message, src)} title="Save to drive"
            className="rounded-md p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
            <IconDownload className="size-4" />
          </button>
        )}
        {!message.pending && (
          <button onClick={onRegenerate} title="Generate another"
            className="rounded-md p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
            <IconRedo className="size-4" />
          </button>
        )}
        <button onClick={onDelete} title="Delete"
          className="rounded-md p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100">
          <IconTrash className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ── Message ─────────────────────────────────────────────── */

export default function Message({
  message, isLatest, streaming, onCopy, onRegenerate, onShowImage,
  onDelete, onDownload, onSave, previews,
}) {
  if (message.deleted) return null;

  if (message.kind === "image") {
    return (
      <div data-id={message.id}>
        <ImageCard
          message={message}
          onDownload={onDownload}
          onSave={onSave}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
        />
      </div>
    );
  }

  const isUser = message.role === "user";
  const extraImages = (previews || []).filter(Boolean);

  return (
    <div data-id={message.id} className={`flex ${isUser ? "justify-end" : ""}`}>
      <div className={`min-w-0 ${isUser ? "max-w-[88%] md:max-w-[75%]" : "w-full"}`}>
        {(message.attachments?.length || message.images?.length || extraImages.length > 0) && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {[...(message.images || []).map((i) => i?.image_url?.url || i?.url), ...extraImages]
              .filter((u) => typeof u === "string" && u)
              .map((u, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={i} src={u} alt="attachment" loading="lazy"
                  className="size-auto max-h-[280px] max-w-[280px] rounded-2xl border border-ink-700 object-cover" />
              ))}
          </div>
        )}

        {message.reasoning && (
          <details className="mb-3 overflow-hidden rounded-lg border border-ink-700 bg-ink-800">
            <summary className="cursor-pointer list-none px-3.5 py-2 text-[13px] text-neutral-400">
              Model reasoning
            </summary>
            <div className="max-h-[340px] overflow-y-auto border-t border-ink-700 px-3.5 pt-1 pb-3 font-mono text-[13px] whitespace-pre-wrap text-neutral-400">
              {message.reasoning}
            </div>
          </details>
        )}

        {isUser ? (
          /* ChatGPT-style bubble: shrink to the text, capped at 75%, left-aligned inside. */
          <div className="w-fit max-w-full min-w-0 rounded-[24px] border border-ink-700 bg-ink-750 px-[18px] py-3 text-left text-[15px] leading-7 whitespace-pre-wrap break-words [overflow-wrap:break-word]">
            {message.text || ""}
          </div>
        ) : (
          <div className="md">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text || "") }} />
            {message.streaming && !message.text && <span className="thinking-dot" />}
          </div>
        )}

        {message.error && (
          <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-red-300">
            {asText(message.error, "The request failed.")}
          </div>
        )}

        {isLatest && !streaming && (
          <ReplyActions
            message={message}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onShowImage={onShowImage}
          />
        )}
      </div>
    </div>
  );
}