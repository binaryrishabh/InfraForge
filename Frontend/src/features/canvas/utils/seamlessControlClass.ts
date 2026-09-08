/* Seamless floating control clusters (zoom, history): no borders, no
   per-button boxes. Glyphs float directly on the canvas; a faint blurred
   pill appears only while the cluster is hovered, so the chrome never
   competes with the diagram. */
export const SEAMLESS_CONTROL_SURFACE =
  "flex items-center gap-0.5 px-1.5 py-1 rounded-lg transition-all duration-150 hover:bg-[#12161F]/70 hover:backdrop-blur-md";

export const SEAMLESS_CONTROL_BUTTON =
  "w-9 h-8 rounded-md flex items-center justify-center text-[#677185] hover:text-[#EDF1F7] hover:bg-[#1F2633]/60 active:scale-[0.92] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#677185]";