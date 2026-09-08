/* Floating pill surface + bare control buttons for the bottom clusters
   (zoom, history). Visibility is owned by useAutoHideControls; the surface
   itself now uses the floating-chrome surface (#12161F/90 + backdrop blur)
   instead of the old flat gray slab, so it reads as chrome, not a button bar. */
export const CONTROL_PILL_SURFACE =
  "flex items-center gap-1 bg-[#12161F]/90 backdrop-blur-md rounded-xl px-2 py-1.5 select-none shadow-[0_8px_24px_rgba(0,0,0,0.45)]";

export const BARE_CONTROL_BUTTON =
  "w-8 h-8 rounded-lg flex items-center justify-center text-[#AAB4C5] hover:text-[#EDF1F7] hover:bg-[#1F2633]/70 active:scale-[0.92] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#AAB4C5]";