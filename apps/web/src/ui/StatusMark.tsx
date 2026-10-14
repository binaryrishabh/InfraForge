import { cx } from "./cx";
import { STATUS, type StatusKind } from "./status";

// Result marks pair a distinct shape with a word: check, cross, half-filled, dashed, empty.
export function StatusGlyph({ kind, size = 14 }: { kind: StatusKind; size?: number }) {
  const { tone } = STATUS[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className={cx("shrink-0", tone)}>
      {kind === "met" || kind === "matched" || kind === "ok" ? <><circle cx="7" cy="7" r="6" fill="currentColor" /><path d="m4.2 7.2 1.9 1.9 3.8-4" fill="none" stroke="var(--if-raised)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>
        : kind === "finished" ? <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="currentColor" />
        : kind === "not-met" || kind === "problem" || kind === "different" || kind === "failed" ? <><rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor" /><path d="m4.6 4.6 4.8 4.8m0-4.8-4.8 4.8" stroke="var(--if-raised)" strokeWidth="1.6" strokeLinecap="round" /></>
        : kind === "in-progress" || kind === "pending" || kind === "during-run" ? <><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></>
        : kind === "not-started" ? <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        : <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2" />}
    </svg>
  );
}

export function StatusMark({ kind, label, className, size = "md" }: { kind: StatusKind; label?: string; className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-medium text-ink", size === "sm" ? "text-xs" : "text-[13px]", className)}>
      <StatusGlyph kind={kind} size={size === "sm" ? 12 : 14} />{label ?? STATUS[kind].label}
    </span>
  );
}
