import { cx } from "./cx";

/* The mark: a load-bearing beam over three supports, drawn on the drafting grid. */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cx("shrink-0", className)}>
      <rect x="2" y="3.5" width="20" height="5" rx="1" fill="currentColor" />
      <rect x="3.5" y="11" width="4" height="9.5" rx="0.8" fill="currentColor" opacity="0.85" />
      <rect x="10" y="11" width="4" height="9.5" rx="0.8" fill="currentColor" opacity="0.85" />
      <rect x="16.5" y="11" width="4" height="9.5" rx="0.8" fill="var(--if-marker)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-ink", className)}>
      <BrandMark />
      <span className="if-title text-[20px] leading-none tracking-[-0.02em]">InfraForge</span>
    </span>
  );
}
