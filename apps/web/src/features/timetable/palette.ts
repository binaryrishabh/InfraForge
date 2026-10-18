// Canvas cannot read Tailwind classes, so the renderer reads the same CSS tokens at draw time.
export interface Palette {
  bg: string; surface: string; line: string; lineStrong: string; grid: string;
  ink: string; ink2: string; ink3: string; accent: string; accentSoft: string;
  degraded: string; saturated: string; failed: string; ok: string; read: string; write: string;
  sans: string; mono: string;
}

export function readPalette(element: Element = document.documentElement): Palette {
  const css = getComputedStyle(element);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--if-bg", "#0c0d0d"), surface: v("--if-surface", "#121414"), line: v("--if-line", "#242826"),
    lineStrong: v("--if-line-strong", "#383d3a"), grid: v("--if-grid", "#1c201e"),
    ink: v("--if-ink", "#eeeae2"), ink2: v("--if-ink-2", "#b4b0a8"), ink3: v("--if-ink-3", "#85827b"),
    accent: v("--if-accent", "#a9cbff"), accentSoft: v("--if-accent-soft", "#16202d"),
    degraded: v("--if-warn", "#e5b84c"), saturated: v("--if-hot", "#f08848"), failed: v("--if-fail", "#f2604f"),
    ok: v("--if-ok", "#84cfa4"), read: v("--if-read", "#8dd5c6"), write: v("--if-write", "#eec986"),
    sans: "\"Atkinson Hyperlegible Next Variable\", system-ui, sans-serif",
    mono: "\"Atkinson Hyperlegible Mono Variable\", ui-monospace, monospace",
  };
}

export function healthColor(p: Palette, health: string) {
  return health === "degraded" ? p.degraded : health === "saturated" ? p.saturated : health === "failed" || health === "critical" ? p.failed : p.ink3;
}

// Rail weight grows with severity so state survives greyscale and colour-blind viewing.
export function healthWeight(health: string) {
  return health === "degraded" ? 3 : health === "saturated" ? 5 : health === "failed" || health === "critical" ? 6 : 1.5;
}
