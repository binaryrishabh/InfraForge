/* Floating pill surface + bare control buttons for the bottom clusters
(zoom, history). Solid surface, no blur; visibility owned by
useAutoHideControls. */
export const CONTROL_PILL_SURFACE =
  "flex items-center gap-1 bg-[#1C1F26] border border-[#2A2E37] rounded-lg px-2 py-1.5 select-none shadow-[0_8px_24px_rgba(0,0,0,0.35)]";
export const BARE_CONTROL_BUTTON =
  "w-8 h-8 rounded-md flex items-center justify-center text-[#8B909C] hover:text-[#EDEEF0] hover:bg-[#2A2E37]/60 active:scale-[0.92] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#8B909C]";