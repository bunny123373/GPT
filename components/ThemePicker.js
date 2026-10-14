"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_PREF, applyTheme, readPref, writePref,
} from "../lib/theme";

import { IconSun, IconMoon, IconMonitor } from "./icons";

const label = "mb-1.5 block font-medium text-sm";

const OPTIONS = [
  { id: "night", label: "Night", Icon: IconMoon },
  { id: "light", label: "Light", Icon: IconSun },
  { id: "system", label: "System", Icon: IconMonitor },
];

/**
 * Three-way theme picker.
 *
 * Picking "System" stores the *preference*, not the resolved theme, and keeps
 * listening: a phone that flips to dark at sunset must re-theme an already
 * open tab, which only works if we subscribe rather than resolve once.
 */
export default function ThemePicker({ compact = false }) {
  const [pref, setPref] = useState(DEFAULT_PREF);
  const [theme, setTheme] = useState("night");

  // Read storage after mount, not during render: the server has no localStorage
  // and rendering night then switching would be the exact flash we avoided.
  useEffect(() => {
    const stored = readPref();
    setPref(stored);
    setTheme(applyTheme(stored));
  }, []);

  // Follow the OS while, and only while, the preference is "system".
  useEffect(() => {
    if (pref !== "system" || typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(applyTheme("system", mq.matches));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const choose = useCallback((id) => {
    setPref(writePref(id));
    setTheme(applyTheme(id));
  }, []);

  if (compact) {
    /* Icon-only variant for the topbar. Toggles between the two concrete
       themes; reaching "system" is a Settings choice, not a one-click one. */
    const next = theme === "night" ? "light" : "night";
    const Icon = theme === "night" ? IconSun : IconMoon;
    return (
      <button
        onClick={() => choose(next)}
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
              onClick={() => choose(id)}
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
