import { cx } from "./cx";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "quiet-danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-inverse border border-ink hover:bg-ink-2 hover:border-ink-2",
  accent: "bg-accent text-inverse border border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-transparent text-ink border border-line-strong hover:border-ink-3 hover:bg-raised",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-fail text-inverse border border-fail hover:opacity-90",
  "quiet-danger": "bg-transparent text-fail border border-transparent hover:bg-fail-soft",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx("inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap select-none",
    "transition-colors duration-150 disabled:opacity-45 disabled:pointer-events-none", VARIANT[variant], SIZE[size], extra);
}
