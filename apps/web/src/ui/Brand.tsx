import { cx } from "./cx";

/* The mark is one line of a timetable: a request dwells at one station, moves, and
dwells at the next. Time runs to the right, as it does everywhere in InfraForge. */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cx("shrink-0", className)}>
      <rect x="1.5" y="3.5" width="6" height="6" fill="currentColor" />
      <rect x="16.5" y="14.5" width="6" height="6" fill="currentColor" />
      <path d="M7.5 6.5 H11.5 L13.5 17.5 H16.5" fill="none" stroke="var(--if-accent)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 text-ink", className)}>
      <BrandMark />
      <span className="text-[17px] font-[720] leading-none tracking-[-0.03em]">InfraForge</span>
    </span>
  );
}
