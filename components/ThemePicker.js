"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  getPrefSnapshot, getServerSnapshot, getThemeSnapshot, initTheme, setPref, subscribe,
} from "../lib/theme";

import { IconSun, IconMoon, IconMonitor } from "./icons";

const label = "mb-1.5 block font-medium text-sm";

const OPTIONS = [
  { id: "night", label: "Night", Icon: IconMoon },
  { id: "light", label: "Light", Icon: IconSun },
  { id: "system", label: "System", Icon: IconMonitor },
];

/**
 * Three-way theme picker, driven by the shared store in lib/theme.
 *
 * Two of these are live at once (topbar and Settings), so state lives in the
 * module rather than in the component — otherwise the topbar icon would keep
 * claiming "night" after Settings had switched to light.
 */
export default function ThemePicker({ compact = false }) {
  // Reading from a store that is not yet initialised yields the server
  // snapshot, so hydration matches and no flash is introduced.
  const pref = useSyncExternalStore(subscribe, getPrefSnapshot, getServerSnapshot);
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);

  // Adopt the stored preference and subscribe to the OS. Runs once per mount;
  // initTheme is idempotent, so the second picker is a no-op.
  useEffect(() => { initTheme(); }, []);

  if (compact) {
    /* Icon-only variant for the topbar. Toggles between the two concrete
       themes; reaching "system" is a Settings choice, not a one-click one. */
    const next = theme === "night" ? "light" : "night";
    const Icon = theme === "night" ? IconSun : IconMoon;
    return (
      <button
        onClick={() => setPref(next)}
        title={`Switch to ${next} mode`}
        aria-label={`Switch to ${next} mode`}
        className="grid size-9 place-items-center rounded-md text-neutral-400 hover:bg-ink-700 hover:text-neutral-100 min-[420px]:size-8"
      >
        <Icon className="size-4" />
      </button>
    );
  }

  return (
    <div>
      <span className={label}>Appearance</span>
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="grid grid-cols-3 gap-1 rounded-xl bg-ink-850 p-1"
      >
        {OPTIONS.map(({ id, label: text, Icon }) => {
          const active = pref === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={active}
              onClick={() => setPref(id)}
              className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-xs transition ${
                active
                  ? "bg-ink-700 text-neutral-100 shadow-sm"
                  : "text-neutral-400 hover:bg-ink-800 hover:text-neutral-200"
              }`}
            >
              <Icon className={`size-4 ${active ? "text-accent" : ""}`} />
              {text}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">
        {pref === "system"
          ? `Following your device — currently ${theme === "night" ? "night" : "light"}.`
          : pref === "night"
            ? "Always dark, whatever your device is doing."
            : "Always light, whatever your device is doing."}
      </p>
    </div>
  );
}
