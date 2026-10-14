"use client";

import { useState } from "react";

import { TONES, profilePrompt } from "../lib/profile";
import { memoryPrompt } from "../lib/memories";
import ThemePicker from "./ThemePicker";
import { IconX } from "./icons";

/** Shared modal shell. `dialog` semantics without the native element, so the
 *  content can be laid out however it likes. */
function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[calc(100dvh-2rem)] w-[min(620px,calc(100vw-1.5rem))]
                   flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-850 shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-ink-700 px-3 py-3">
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-neutral-400 hover:bg-ink-700 hover:text-neutral-100">
            Close
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-ink-700 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const field = "w-full rounded-lg border border-ink-700 bg-ink-750 px-3 py-2.5 text-sm outline-none focus:border-ink-600";
const label = "mb-1.5 block font-medium text-sm";

/* ── Settings ────────────────────────────────────────────── */

export function SettingsDialog({ open, onClose, settings, onChange, onClearChat, onDeleteAll }) {
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="mb-5">
        <label htmlFor="set-system" className={label}>System prompt</label>
        <textarea
          id="set-system" rows={6} value={settings.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          placeholder="You are a helpful assistant…"
          className={`${field} resize-y`}
        />
        <p className="mt-1.5 text-xs text-neutral-400">
          Sent as the <code>system</code> message at the start of every turn.
        </p>
      </div>

      <div className="mb-5">
        <label htmlFor="set-temp" className={label}>
          Temperature <output className="font-mono text-neutral-400">{Number(settings.temperature).toFixed(1)}</output>
        </label>
        <input
          id="set-temp" type="range" min="0" max="2" step="0.1" value={settings.temperature}
          onChange={(e) => onChange({ temperature: Number(e.target.value) })}
          className="w-full accent-accent"
        />
        <p className="mt-1.5 text-xs text-neutral-400">
          0 is focused and deterministic, 2 is loose and random. Some reasoning models ignore this.
        </p>
      </div>

      <div className="mb-5">
        <label htmlFor="set-max" className={label}>Max output tokens</label>
        <input
          id="set-max" type="number" min="1" step="1" placeholder="Model default"
          value={settings.maxTokens ?? ""}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onChange({ maxTokens: Number.isFinite(v) && v > 0 ? v : null });
          }}
          className={`${field} max-w-40`}
        />
      </div>

      <div className="mb-5">
        <ThemePicker />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={!!settings.stream}
                 onChange={(e) => onChange({ stream: e.target.checked })} className="size-4 accent-accent" />
          Stream responses
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={!!settings.showReasoning}
                 onChange={(e) => onChange({ showReasoning: e.target.checked })} className="size-4 accent-accent" />
          Show reasoning
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onClearChat}
          className="rounded-lg px-2.5 py-1.5 text-sm text-neutral-400 hover:bg-ink-700 hover:text-neutral-100">
          Clear this conversation
        </button>
        <button onClick={onDeleteAll}
          className="rounded-lg px-2.5 py-1.5 text-sm text-neutral-400 hover:bg-ink-700 hover:text-danger">
          Delete all data
        </button>
      </div>
    </Modal>
  );
}

/* ── Ask me / profile ────────────────────────────────────── */

export function ProfileDialog({
  open, onClose, profile, onSave, onClear, knownUser, signedIn, basePrompt,
}) {
  const value = profile;
  const set = (k, v) => onSave({ ...value, [k]: v }, { draft: true });

  const block = profilePrompt(value);
  const tone = TONES.find((t) => t.id === value.tone);

  return (
    <Modal
      open={open} onClose={onClose} title="Ask me"
      footer={
        <div className="flex items-center gap-2">
          <button onClick={onClear}
            className="rounded-lg px-2.5 py-1.5 text-sm text-neutral-400 hover:bg-ink-700 hover:text-neutral-100">
            Clear profile
          </button>
          <div className="flex-1" />
          <button onClick={() => onSave(value, { commit: true })}
            className="rounded-lg bg-invert px-3.5 py-1.5 text-sm font-medium text-invert-fg hover:bg-invert-hover">
            Save
          </button>
        </div>
      }
    >
      <p className="mt-0 mb-4 text-xs text-neutral-400">
        Answer as much or as little as you like. Your answers stay in your own Puter account and are
        used to tailor every reply — you never have to repeat yourself.
      </p>

      <div className="mb-5">
        <label htmlFor="pf-name" className={label}>What should I call you?</label>
        <input id="pf-name" type="text" value={value.name} onChange={(e) => set("name", e.target.value)}
               placeholder={knownUser || "Your name or nickname"} autoComplete="off" className={field} />
        <p className="mt-1.5 text-xs text-neutral-500">
          {signedIn
            ? (knownUser ? `Signed in to Puter as ${knownUser}.` : "Signed in to Puter.")
            : "Not signed in — this is stored on this device."}
        </p>
      </div>

      <div className="mb-5">
        <label htmlFor="pf-role" className={label}>What do you do?</label>
        <input id="pf-role" type="text" value={value.role} onChange={(e) => set("role", e.target.value)}
               placeholder="e.g. backend engineer, student, founder" autoComplete="off" className={field} />
      </div>

      <div className="mb-5">
        <label htmlFor="pf-tone" className={label}>How should I answer?</label>
        <select id="pf-tone" value={value.tone} onChange={(e) => set("tone", e.target.value)} className={field}>
          {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {tone && <p className="mt-1.5 text-xs text-neutral-400">{tone.hint}</p>}
      </div>

      <div className="mb-5">
        <label htmlFor="pf-goals" className={label}>What are you working on right now?</label>
        <textarea id="pf-goals" rows={3} value={value.goals} onChange={(e) => set("goals", e.target.value)}
                  placeholder="Projects, problems or topics you keep coming back to." className={`${field} resize-y`} />
      </div>

      <div className="mb-4">
        <label htmlFor="pf-avoid" className={label}>Anything you'd rather I didn't do?</label>
        <textarea id="pf-avoid" rows={2} value={value.avoid} onChange={(e) => set("avoid", e.target.value)}
                  placeholder="No emojis. Don't ask follow-up questions." className={`${field} resize-y`} />
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none py-1.5 text-[13px] text-neutral-400">
          What gets sent with each message
        </summary>
        <pre className="mt-1.5 max-h-[220px] overflow-y-auto rounded-[10px] border border-ink-700 bg-code p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-neutral-400">
          {block
            ? [basePrompt, block].filter(Boolean).join("\n\n")
            : "Nothing yet — answer a question above to see what gets sent."}
        </pre>
      </details>
    </Modal>
  );
}

/* ── Memories ────────────────────────────────────────────────
   Free-form durable facts, applied to every chat. The user writes them by
   hand, or presses "Suggest from this chat" and has the model propose some
   that can then be reviewed one at a time. Nothing is ever written to
   storage without the user seeing it. */

export function MemoriesDialog({
  open, onClose, memories, onAdd, onDelete, onClear, onSuggest,
  canSuggest, extracting, basePrompt,
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Memories"
      footer={
        <div className="flex items-center gap-2">
          <button onClick={onClear}
            className="rounded-lg px-2.5 py-1.5 text-sm text-neutral-400 hover:bg-ink-700 hover:text-neutral-100">
            Clear all
          </button>
          <div className="flex-1" />
          <button onClick={onClose}
            className="rounded-lg bg-invert px-3.5 py-1.5 text-sm font-medium text-invert-fg hover:bg-invert-hover">
            Done
          </button>
        </div>
      }
    >
      <p className="mt-0 mb-4 text-xs text-neutral-400">
        Things worth knowing about you in every chat — your tools, your role, how you like
        answers written. They are added to the system prompt of each message you send.
      </p>

      <div className="mb-5">
        <label htmlFor="mem-new" className={label}>Add a memory</label>
        <div className="flex gap-2">
          <input
            id="mem-new" type="text" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder="e.g. Prefers TypeScript over JavaScript"
            autoComplete="off" className={field}
          />
          <button
            onClick={submit} disabled={!draft.trim()}
            className="shrink-0 rounded-lg bg-invert px-3.5 text-sm font-medium text-invert-fg
                       hover:bg-invert-hover disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <span className={label}>Remembered</span>
          <button
            onClick={onSuggest} disabled={!canSuggest || extracting}
            title={canSuggest ? "Have the model read this chat and suggest facts worth keeping"
                              : "Nothing in this chat to learn from yet"}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1
                       text-xs text-neutral-300 hover:bg-ink-700 disabled:opacity-40"
          >
            {extracting ? "Reading…" : "Suggest from this chat"}
          </button>
        </div>

        {memories.length === 0 ? (
          <p className="rounded-lg border border-ink-700 bg-ink-800 px-3.5 py-3 text-sm text-neutral-400">
            Nothing remembered yet. Add one above, or let the model suggest some from a chat
            you have already had.
          </p>
        ) : (
          <ul className="thin-scroll max-h-[280px] overflow-y-auto rounded-lg border border-ink-700">
            {memories.map((m) => (
              <li key={m}
                className="flex items-start gap-2 border-b border-ink-700 px-3.5 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1 text-sm">{m}</span>
                <button
                  onClick={() => onDelete(m)}
                  title="Forget this" aria-label={`Forget: ${m}`}
                  className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-ink-700 hover:text-danger"
                >
                  <IconX className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="rounded-lg border border-ink-700 px-3.5 py-2">
        <summary className="cursor-pointer list-none py-1.5 text-[13px] text-neutral-400">
          What gets sent with each message
        </summary>
        <pre className="mt-1.5 max-h-[220px] overflow-y-auto rounded-[10px] border border-ink-700 bg-code p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-neutral-400">
          {[basePrompt, memoryPrompt(memories)].filter(Boolean).join("\n\n")
            || "Nothing yet — add a memory above to see what gets sent."}
        </pre>
      </details>
    </Modal>
  );
}