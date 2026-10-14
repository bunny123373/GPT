/**
 * Inline SVG icons.
 *
 * Deliberately not Lucide-from-CDN: that library needs a re-scan pass after
 * every render, and a missed one silently ships an empty element. These are
 * plain components, so React guarantees they exist.
 */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/**
 * `className` is always ADDITIVE. It used to replace the icon's own size
 * class, so `<IconSearch className="absolute ...">` shipped an SVG with no
 * dimensions at all and the browser fell back to its 300x150 replaced-element
 * default — a giant, misplaced glyph. Pass `size` to change the dimensions.
 */
const Icon = ({ children, size = "size-4", className = "", ...rest }) => (
  <svg
    {...base}
    className={`${size} shrink-0 ${className}`.trim()}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const IconMenu = (p) => (
  <Icon size="size-5" {...p}><path d="M3 6h18M3 12h18M3 18h18" /></Icon>
);

export const IconPanelClose = (p) => (
  <Icon size="size-5" {...p}><path d="M3 6h18M3 12h11M3 18h18" /></Icon>
);

export const IconPencil = (p) => (
  <Icon {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
);

export const IconImage = (p) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></Icon>
);

export const IconSparkle = (p) => (
  <Icon {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M19 15.5 20.5 18l2.5 1.5-2.5 1.5L19 23l-1.5-2L15 19.5 17.5 18 19 15.5Z" />
  </Icon>
);

export const IconChevron = (p) => (
  <Icon size="size-4" {...p}><path d="m6 9 6 6 6-6" /></Icon>
);

export const IconSearch = (p) => (
  <Icon size="size-3.5" {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>
);

export const IconCopy = (p) => (
  <Icon {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Icon>
);

export const IconRedo = (p) => (
  <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>
);

export const IconTrash = (p) => (
  <Icon {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Icon>
);

export const IconDownload = (p) => (
  <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></Icon>
);

export const IconArrowUp = (p) => (
  <Icon size="size-5" strokeWidth={2} {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
);

export const IconStop = (p) => (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPaperclip = (p) => (
  <Icon size="size-[18px]" {...p}><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Icon>
);

export const IconSettings = (p) => (
  <Icon size="size-4" {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);

export const IconLogin = (p) => (
  <Icon {...p}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></Icon>
);

export const IconLogout = (p) => (
  <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></Icon>
);

export const IconX = (p) => (
  <Icon size="size-3.5" {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>
);

/* Starter-pill glyphs */
export const IconCap = (p) => (
  <Icon {...p}><path d="M22 10 12 5 2 10l10 5 10-5ZM6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /></Icon>
);
export const IconCode = (p) => (
  <Icon {...p}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></Icon>
);
export const IconBulb = (p) => (
  <Icon {...p}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" /></Icon>
);
export const IconChecks = (p) => (
  <Icon {...p}><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Icon>
);
export const IconHouse = (p) => (
  <Icon {...p}><path d="M3 21h18M5 21V9l7-6 7 6v12" /></Icon>
);
export const IconFrame = (p) => (
  <Icon {...p}><path d="M4 4h16v16H4zM4 10h16M10 4v16" /></Icon>
);
export const IconLayers = (p) => (
  <Icon {...p}><path d="M12 3 2 8l10 5 10-5-10-5ZM2 16l10 5 10-5M2 12l10 5 10-5" /></Icon>
);
export const IconCube = (p) => (
  <Icon {...p}><path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM12 12v10M12 12 3 7M12 12l9-5" /></Icon>
);
export const IconStar = (p) => (
  <Icon {...p}><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" /></Icon>
);
export const IconGrid = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Icon>
);