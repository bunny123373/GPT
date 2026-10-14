"use client";

import { useEffect, useRef } from "react";
import { IconSettings, IconLogin, IconLogout } from "./icons";

const bytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};

/** Puter reports resources in microcents ($0.01 = 1,000,000). */
const usd = (m) => (Number.isFinite(m) ? `$${(m / 1_000_000).toFixed(4)}` : "—");

/** Sidebar account row + the menu it opens. Upward, so never clipped. */
export default function AccountMenu({ user, stats, open, onToggle, onSettings, onAuth }) {
  const ref = useRef(null);
  const signedIn = !!user?.signedIn;
  const name = user?.name || "Guest";

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onToggle(false); };
    const onKey = (e) => { if (e.key === "Escape") onToggle(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => onToggle()}
        aria-haspopup="menu"
        aria-expanded={open}
        title={signedIn ? `${name} — account & usage` : "Guest — sign in"}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-ink-800"
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent bg-cover bg-center text-sm font-semibold text-on-accent"
          style={user?.picture ? { backgroundImage: `url(${user.picture})` } : undefined}
        >
          {!user?.picture && name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name}</span>
          <span className="block truncate text-[11px] text-neutral-500">{user?.subtitle || "Saved on this device"}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+6px)] right-2 left-2 z-45 animate-menu-in rounded-2xl
                     border border-ink-700 bg-ink-850 p-1.5 shadow-2xl"
        >
          <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-3">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent bg-cover bg-center text-sm font-semibold text-on-accent"
              style={user?.picture ? { backgroundImage: `url(${user.picture})` } : undefined}
            >
              {!user?.picture && name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block text-xs text-neutral-500">
                {signedIn ? "Puter account" : "Not signed in"}
              </span>
            </span>
          </div>

          <div className="border-t border-ink-700 px-3 py-2.5">
            {stats.length === 0 && (
              <p className="text-sm text-neutral-400">
                Sign in to see your plan, storage and usage.
              </p>
            )}
            {stats.map((s) => (
              <div key={s.label} className={s.note || s.pct != null ? "mb-3 last:mb-0" : ""}>
                <div className="mb-1.25 flex justify-between gap-2.5 text-xs text-neutral-500">
                  <span>{s.label}</span><b className="font-medium text-neutral-400">{s.value}</b>
                </div>
                {s.pct != null && (
                  <div className="h-[5px] overflow-hidden rounded-full bg-ink-700">
                    <i className="block h-full rounded-full bg-accent transition-[width] duration-300"
                       style={{ width: `${Math.max(2, Math.min(100, s.pct))}%` }} />
                  </div>
                )}
                {s.note && <p className="mt-1.25 text-[11.5px] text-neutral-500">{s.note}</p>}
              </div>
            ))}
          </div>

          <div className="border-t border-ink-700 pt-1.5">
            <button onClick={onSettings} role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm hover:bg-ink-700">
              <IconSettings className="size-4 text-neutral-400" /><span>Settings</span>
            </button>
            <button onClick={onAuth} role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm hover:bg-ink-700">
              {signedIn
                ? <IconLogout className="size-4 text-neutral-400" />
                : <IconLogin className="size-4 text-neutral-400" />}
              <span>{signedIn ? "Sign out" : "Sign in"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Build the stats rows from live Puter data. Each source fails independently. */
export function buildAccountStats(space, usage, appId) {
  const rows = [];

  if (space && Number.isFinite(space.used) && Number.isFinite(space.capacity) && space.capacity > 0) {
    rows.push({
      label: "Storage",
      value: `${bytes(space.used)} of ${bytes(space.capacity)}`,
      pct: (space.used / space.capacity) * 100,
    });
  }

  if (usage) {
    const totals = usage.appTotals || {};
    let calls = 0, spend = 0;
    for (const [id, v] of Object.entries(totals)) {
      if (appId && id !== appId) continue;   // this app only
      calls += Number(v?.count) || 0;
      spend += Number(v?.total) || 0;
    }
    const remaining = Number(usage?.allowanceInfo?.remaining);
    rows.push({
      label: "This month",
      value: `${calls.toLocaleString()} calls · ${usd(spend)}`,
      note: Number.isFinite(remaining)
        ? `${usd(remaining)} of allowance left this month`
        : "Resets at the start of each month",
    });
  }

  return rows;
}