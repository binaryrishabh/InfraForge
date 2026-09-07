import type { CSSProperties } from "react";

/* Premium graph-paper canvas surface.
   Minor lines sit on the 24px design grid; major lines every 5 cells give
   the "engineering paper" scale read. A faint accent vignette adds depth.
   All grid layers pan/zoom with the world transform; the vignette stays
   fixed so the surface feels like a lit drafting table. */
const MINOR_STEP = 24;
const MAJOR_EVERY = 5;
const MINOR_LINE = "#141B27";
const MAJOR_LINE = "#1B2434";
const CANVAS_BASE = "#0B0E14";
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
  const minorColor = scale >= MINOR_LOD_MIN_SCALE ? MINOR_LINE : "transparent";
  const worldPosition = `${translateX}px ${translateY}px`;

  return {
    backgroundColor: CANVAS_BASE,
    backgroundImage: [
      VIGNETTE,
      `linear-gradient(to right, ${MAJOR_LINE} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${MAJOR_LINE} 1px, transparent 1px)`,
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