import { useId, type ReactNode } from "react";
import { cx } from "./cx";

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        {description && <p id={`${id}-d`} className="mt-0.5 text-xs text-ink-3">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} aria-describedby={description ? `${id}-d` : undefined} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40",
          checked ? "border-ink bg-ink" : "border-line-strong bg-sunken")}>
        <span aria-hidden="true" className={cx("absolute top-0.5 left-0 size-3.5 rounded-full transition-transform", checked ? "translate-x-[18px] bg-inverse" : "translate-x-0.5 bg-ink-3")} />
      </button>
    </div>
  );
}
