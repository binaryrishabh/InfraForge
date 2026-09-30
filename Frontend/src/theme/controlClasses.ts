/* Shared control grammar for the control-room sweep: one input style, one
cancel, one teal primary, one amber (Deploy only), one brick danger pair,
one toggle pair. Keeps every modal and panel from re-inventing tones. */
export const INPUT_CLASS =
  "w-full h-9 rounded-lg bg-[#14161A] border border-[#2A2E37] text-[13px] text-[#EDEEF0] placeholder-[#5A5F6B] px-3 outline-none focus:border-[#4FA89B] focus:shadow-[0_0_0_3px_rgba(79,168,155,0.18)] transition-colors duration-150";
export const LABEL_CLASS = "block text-xs font-medium text-[#8B909C] mb-1.5";
export const MICRO_LABEL_CLASS =
  "text-[9px] uppercase tracking-wider text-[#5A5F6B] font-semibold";
export const CANCEL_BUTTON_CLASS =
  "h-8 px-3 rounded-lg bg-[#1C1F26] border border-[#2A2E37] text-[13px] font-medium text-[#8B909C] hover:bg-[#2A2E37]/60 hover:border-[#3A3F4A] hover:text-[#EDEEF0] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
export const PRIMARY_BUTTON_CLASS =
  "h-8 px-3 rounded-lg bg-[#4FA89B] text-[13px] font-medium text-[#14161A] hover:bg-[#5FBBA9] active:bg-[#459788] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5";
export const AMBER_BUTTON_CLASS =
  "h-8 px-3 rounded-lg bg-[#E8A33D] text-[13px] font-medium text-[#14161A] hover:bg-[#F0B45C] active:bg-[#D99630] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5";
export const DANGER_SOLID_CLASS =
  "bg-[#C4574A] text-[#EDEEF0] hover:bg-[#D0685C] active:bg-[#B34C40] active:scale-[0.98]";
export const TOGGLE_ACTIVE_CLASS = "bg-[#4FA89B] text-[#14161A] font-medium";
export const TOGGLE_IDLE_CLASS = "bg-[#14161A] text-[#8B909C] hover:text-[#EDEEF0]";