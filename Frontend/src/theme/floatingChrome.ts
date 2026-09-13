/* The single source of truth for the floating chrome grammar shared by the
topbars, the drawers, the operator dock, and the shell menu. Topbars ride
the standard shadow; drawers and the dock ride the deep one. */
export const FLOATING_CHROME_SURFACE =
  "rounded-xl border border-[#273042] bg-[#12161F]/95 backdrop-blur-md";
export const FLOATING_CHROME_SHADOW = "shadow-[0_8px_24px_rgba(0,0,0,0.45)]";
export const FLOATING_CHROME_SHADOW_DEEP = "shadow-[0_12px_32px_rgba(0,0,0,0.45)]";