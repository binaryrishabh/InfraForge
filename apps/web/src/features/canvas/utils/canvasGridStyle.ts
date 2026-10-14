import type { CSSProperties } from "react";

/* Drafting paper: a 24px grid of faint rules with a stronger rule every five
cells. Colours come from theme tokens, so the same grid reads on paper and ink.
Far zoom-out drops the minor rules to avoid moire. */
const MINOR = 24, MAJOR = 5;

export function canvasGridStyle(scale: number, translateX: number, translateY: number): CSSProperties {
  const minor = MINOR * scale, major = MINOR * MAJOR * scale;
  const minorColor = scale < 0.5 ? "transparent" : "color-mix(in srgb, var(--if-grid) 55%, transparent)";
  const majorColor = "var(--if-grid)";
  const at = `${translateX}px ${translateY}px`;
  return {
    backgroundColor: "var(--if-canvas)",
    backgroundImage: [
      `linear-gradient(to right, ${majorColor} 1px, transparent 1px)`, `linear-gradient(to bottom, ${majorColor} 1px, transparent 1px)`,
      `linear-gradient(to right, ${minorColor} 1px, transparent 1px)`, `linear-gradient(to bottom, ${minorColor} 1px, transparent 1px)`,
    ].join(", "),
    backgroundSize: [`${major}px ${major}px`, `${major}px ${major}px`, `${minor}px ${minor}px`, `${minor}px ${minor}px`].join(", "),
    backgroundPosition: [at, at, at, at].join(", "),
  };
}
