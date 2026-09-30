import type { CSSProperties } from "react";

/* Control-room graph paper: warm near-black base with highly transparent
divider inks. No vignette, no gradients — the paper stays flat and
engineered, sitting well behind cards and tubes.
Minor lines sit on the 24px design grid; major lines every 5 cells. */
const MINOR_STEP = 24;
const MAJOR_EVERY = 5;
const MINOR_LINE = "rgba(42, 46, 55, 0.16)"; // #2A2E37 family, near-ghost
const MAJOR_LINE = "rgba(42, 46, 55, 0.32)"; // faint structure, still findable
const ZOOMED_OUT_MAJOR_LINE = "rgba(42, 46, 55, 0.16)";
const CANVAS_BASE = "#14161A";
// Level-of-detail: far zoom-out hides minor lines to avoid moiré noise.
const MINOR_LOD_MIN_SCALE = 0.5;

export function canvasGridStyle(
  scale: number,
  translateX: number,
  translateY: number,
): CSSProperties {
  const minorStep = MINOR_STEP * scale;
  const majorStep = MINOR_STEP * MAJOR_EVERY * scale;
  const isZoomedOut = scale < MINOR_LOD_MIN_SCALE;
  const minorColor = isZoomedOut ? "transparent" : MINOR_LINE;
  const majorColor = isZoomedOut ? ZOOMED_OUT_MAJOR_LINE : MAJOR_LINE;
  const worldPosition = `${translateX}px ${translateY}px`;
  return {
    backgroundColor: CANVAS_BASE,
    backgroundImage: [
      `linear-gradient(to right, ${majorColor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${majorColor} 1px, transparent 1px)`,
      `linear-gradient(to right, ${minorColor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${minorColor} 1px, transparent 1px)`,
    ].join(", "),
    backgroundSize: [
      `${majorStep}px ${majorStep}px`,
      `${majorStep}px ${majorStep}px`,
      `${minorStep}px ${minorStep}px`,
      `${minorStep}px ${minorStep}px`,
    ].join(", "),
    backgroundPosition: [
      worldPosition,
      worldPosition,
      worldPosition,
      worldPosition,
    ].join(", "),
    backgroundRepeat: "repeat, repeat, repeat, repeat",
  };
}