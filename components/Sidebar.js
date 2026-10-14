"use client";

import { dateGroup } from "../lib/conversations";
import {
  IconPanelClose, IconPencil, IconImage, IconSparkle,
  IconSearch, IconTrash, IconGrid,
} from "./icons";

const NAV = [
  { id: "new", label: "New chat", Icon: IconPencil },
  { id: "image", label: "Create image", Icon: IconImage },
  { id: "gallery", label: "Gallery", Icon: IconGrid },
  { id: "ask", label: "Ask me", Icon: IconSparkle },
];

export default function Sidebar({
  open, onCollapse, nav, view, search, onSearch, conversations, currentId,
  onSelect, onDelete, account, profileOn,
}) {
  const q = search.trim().toLowerCase();
  const visible = conversations.filter((c) => {
    if (!q) return true;
    if ((c.title || "").toLowerCase().includes(q)) return true;
    return c.messages.some((m) => (m.text || "").toLowerCase().includes(q));
  });

  // Date buckets, emitted only where the group changes.
  const rows = [];
  let last = null;
  for (const conv of visible) {
    const group = dateGroup(conv.updatedAt || conv.createdAt || Date.now());
    if (group !== last) {
      rows.push({ type: "group", key: `g-${group}`, label: group });
      last = group;
    }
    rows.push({ type: "chat", key: conv.id, conv });
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-[min(260px,82vw)] flex-col bg-ink-950 border-r border-black
                  transition-transform duration-200 md:static md:translate-x-0
                  ${open ? "translate-x-0 shadow-2xl" : "-translate-x-[102%] md:hidden"}`}
    >
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <button
          onClick={nav.new}
          className="grid size-10 place-items-center rounded-lg hover:bg-ink-800"
          title="New chat" aria-label="New chat"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-7" />
        </button>
        <div className="flex-1" />
        <button
          onClick={onCollapse}
          className="grid size-10 place-items-center rounded-lg text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
          title="Collapse sidebar" aria-label="Collapse sidebar"
        >
          <IconPanelClose />
        </button>
      </div>

      <div className="space-y-0.5 px-2">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => nav[id]()}
            /* `ask` opens a dialog over whatever view is showing, so it never
               reads as the active view. The rest are destinations. */
            aria-current={id !== "ask" && view === id ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${
              view === id ? "bg-ink-800 text-neutral-100" : "hover:bg-ink-800"
            }`}
          >
            <Icon className={`size-4 ${view === id ? "text-accent" : ""}`} />
            {label}
            {id === "ask" && profileOn && (
              <span className="ml-auto rounded-full bg-accent-soft px-2 py-px text-[11px] text-emerald-300">
                on
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="relative px-3 pt-5 pb-2">
        <IconSearch className="pointer-events-none absolute top-1/2 left-[22px] -translate-y-1/2 text-neutral-500" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="w-full rounded-lg bg-ink-850 py-[7px] pl-[30px] pr-2.5 text-[13.5px]
                     outline-none focus:border focus:border-ink-700 focus:bg-ink-800"
        />
      </div>

      <p className="px-5 pb-1 text-xs font-medium text-neutral-500">Chats</p>

      <nav aria-label="Conversations" className="thin-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {rows.length === 0 && (
          <p className="px-3 py-1 text-sm text-neutral-500">
            {q ? "No chats match that search." : "Your chats will show up here."}
          </p>
        )}
        {rows.map((row) =>
          row.type === "group" ? (
            <p key={row.key} className="px-3 pt-4 pb-1 text-xs font-medium text-neutral-500">
              {row.label}
            </p>
          ) : (
            <div
              key={row.key}
              className={`group flex items-center rounded-lg ${
                row.conv.id === currentId ? "bg-ink-800" : "hover:bg-ink-800/70"
              }`}
            >
              <button
                onClick={() => onSelect(row.conv.id)}
                title={row.conv.title}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-neutral-200"
              >
                {row.conv.title}
              </button>
              {row.conv.trimmed && (
                <span
                  className="mr-1 text-[10px] text-neutral-500"
                  title="Older messages were dropped to fit Puter's storage limit."
                >
                  trimmed
                </span>
              )}
              <button
                onClick={() => onDelete(row.conv.id)}
                title="Delete chat"
                aria-label={`Delete "${row.conv.title}"`}
                className="mr-1 rounded-md p-1.5 text-neutral-400 hover:bg-ink-700 hover:text-red-400
                           md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100
                           md:max-md:opacity-100"
              >
                <IconTrash className="size-3.5" />
              </button>
            </div>
          )
        )}
      </nav>

      <div className="relative border-t border-black p-2">{account}</div>
    </aside>
  );
}