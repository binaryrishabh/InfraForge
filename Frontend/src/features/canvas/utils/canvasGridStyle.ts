import type { CSSProperties } from "react";

/* Premium graph-paper canvas surface.
Minor lines sit on the 24px design grid; major lines every 5 cells give
the "engineering paper" scale read. A faint accent vignette adds depth.
All grid layers pan/zoom with the world transform; the vignette stays
fixed so the surface feels like a lit drafting table.
Owner tweak: every line layer is alpha-blended toward the base so the
paper whispers instead of competing with the diagram. The zoomed-out
squares pack denser on screen (fewer, bigger cells per viewport), so they
get their own fainter ink — half the zoomed-in major alpha — to match the
graph's whisper at distance. */
const MINOR_STEP = 24;
const MAJOR_EVERY = 5;
const MINOR_LINE = "rgba(26, 36, 49, 0.50)"; // #1A2431 at 50% over the base
const MAJOR_LINE = "rgba(35, 46, 64, 0.60)"; // #232E40 at 60% over the base
const ZOOMED_OUT_MAJOR_LINE = "rgba(35, 46, 64, 0.30)"; // squares at half ink
const CANVAS_BASE = "#0D1119";
const VIGNETTE =
  "radial-gradient(1100px 700px at 50% 38%, rgba(91, 140, 255, 0.05), transparent 70%)";
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
      VIGNETTE,
      `linear-gradient(to right, ${majorColor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${majorColor} 1px, transparent 1px)`,
      `linear-gradient(to right, ${minorColor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${minorColor} 1px, transparent 1px)`,
    ].join(", "),
    backgroundSize: [
      "auto",
      `${majorStep}px ${majorStep}px`,
      `${majorStep}px ${majorStep}px`,
      `${minorStep}px ${minorStep}px`,
      `${minorStep}px ${minorStep}px`,
    ].join(", "),
    backgroundPosition: [
      "center",
      worldPosition,
      worldPosition,
      worldPosition,
      worldPosition,
    ].join(", "),
    backgroundRepeat: "no-repeat, repeat, repeat, repeat, repeat",
  };
}