import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentOption<T extends string | number> { value: T; label: ReactNode; title?: string; disabled?: boolean }

// A radio group drawn as a segmented control; arrow keys move the selection.
export function Segmented<T extends string | number>({ options, value, onChange, label, size = "md", className, disabled }: {
  options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; label: string; size?: "sm" | "md"; className?: string; disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled || disabled ? -1 : i)).filter((i) => i >= 0);
  const onKey = (event: KeyboardEvent, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const at = enabled.indexOf(index);
    const target = enabled[(at + step + enabled.length) % enabled.length];
    if (target === undefined) return;
    onChange(options[target]!.value);
    refs.current[target]?.focus();
  };
  const focusable = options.some((o) => o.value === value) ? value : options[enabled[0] ?? 0]?.value;
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-md border border-line-strong bg-sunken p-0.5", className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button key={String(option.value)} ref={(node) => { refs.current[index] = node; }} type="button" role="radio" aria-checked={checked}
            tabIndex={option.value === focusable ? 0 : -1} disabled={option.disabled || disabled} title={option.title}
            onClick={() => onChange(option.value)} onKeyDown={(event) => onKey(event, index)}
            className={cx("inline-flex items-center justify-center gap-1 rounded-sm font-medium transition-colors disabled:opacity-40",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
              checked ? "bg-raised text-ink shadow-e1" : "text-ink-3 hover:text-ink")}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
