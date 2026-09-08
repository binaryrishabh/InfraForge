/* Seamless control surface shared by the floating canvas clusters (zoom,
   history): bare icons on a soft blurred pill — no borders, no per-button
   boxes. Interactivity is revealed only on hover; disabled icons fade
   without any chrome. */
export const SEAMLESS_CONTROL_BUTTON =
  "w-7 h-7 rounded-md flex items-center justify-center text-[#677185] hover:text-[#EDF1F7] hover:bg-[#1F2633]/70 active:scale-[0.92] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#677185]";

export const SEAMLESS_CONTROL_SURFACE =
  "flex items-center gap-0.5 px-1 py-1 rounded-lg bg-[#12161F]/85 backdrop-blur-md shadow-[0_6px_20px_rgba(0,0,0,0.35)]";