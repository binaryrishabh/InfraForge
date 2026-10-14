import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  icon: ReactNode;
  size?: "sm" | "md";
  tone?: "default" | "danger";
  pressed?: boolean;
}

// Every icon-only control carries an accessible name and a matching tooltip.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", tone = "default", pressed, className, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} aria-pressed={pressed}
      className={cx("inline-flex items-center justify-center rounded-md border border-transparent transition-colors duration-150",
        "disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "size-8" : "size-9",
        tone === "danger" ? "text-fail hover:bg-fail-soft" : "text-ink-2 hover:bg-sunken hover:text-ink",
        pressed && "bg-sunken text-ink border-line", className)} {...rest}>
      {icon}
    </button>
  );
});
