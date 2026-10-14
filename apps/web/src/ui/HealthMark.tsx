import { cx } from "./cx";
import { COLOR, LABEL, healthState, type HealthState } from "./health";

// Shape carries the state as well as colour: circle, half circle, triangle, crossed square, octagon, dashed ring.
export function HealthGlyph({ state, size = 12, className }: { state: HealthState; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className={cx("shrink-0", COLOR[state], className)}>
      {state === "healthy" && <circle cx="6" cy="6" r="4.5" fill="currentColor" />}
      {state === "degraded" && <><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6 1.75a4.25 4.25 0 0 1 0 8.5z" fill="currentColor" /></>}
      {state === "saturated" && <path d="M6 1.2 11 10.4H1z" fill="currentColor" />}
      {state === "failed" && <><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="currentColor" /><path d="m4 4 4 4m0-4-4 4" stroke="var(--if-raised)" strokeWidth="1.4" strokeLinecap="round" /></>}
      {state === "critical" && <path d="M4 1h4l3 3v4l-3 3H4L1 8V4z" fill="currentColor" />}
      {state === "unknown" && <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" />}
    </svg>
  );
}

export function HealthMark({ value, size = "md", className, label }: { value: string | null | undefined; size?: "sm" | "md"; className?: string; label?: string }) {
  const state = healthState(value);
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-medium", size === "sm" ? "text-xs" : "text-[13px]", className)}>
      <HealthGlyph state={state} size={size === "sm" ? 10 : 12} />
      <span className={state === "unknown" ? "text-ink-3" : "text-ink"}>{label ?? LABEL[state]}</span>
    </span>
  );
}
