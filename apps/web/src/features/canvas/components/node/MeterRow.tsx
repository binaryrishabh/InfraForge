import { cx } from "@/ui/cx";
import { meterTone } from "./nodeFacts";

// null means the simulator does not know this value: show "unknown", never a fake 0 %.
export function MeterRow({ label, value }: { label: string; value: number | null }) {
  if (value === null) return (
    <div className="grid grid-cols-[28px_1fr_42px] items-center gap-1.5">
      <span className="if-num text-[10px] text-ink-3">{label}</span>
      <span className="h-1.5 rounded-xs bg-sunken" aria-hidden="true" />
      <span className="if-num text-right text-[11px] text-ink-3" title="Not modelled for this component">unknown</span>
    </div>
  );
  return (
    <div className="grid grid-cols-[28px_1fr_42px] items-center gap-1.5">
      <span className="if-num text-[10px] text-ink-3">{label}</span>
      <span className="relative h-1.5 overflow-hidden rounded-xs bg-sunken" aria-hidden="true">
        <span className={cx("absolute inset-y-0 left-0 transition-[width] duration-500", meterTone(value))} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="if-num text-right text-[11px] text-ink">{value.toFixed(1)}%</span>
    </div>
  );
}
