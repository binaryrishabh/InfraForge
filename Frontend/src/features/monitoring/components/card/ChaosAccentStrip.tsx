import { CHAOS_LABELS } from "@shared/constants/CHAOS_LABELS.constants";
import type { ChaosEffect } from "@shared/interface/ChaosEffect.interface";

/* Red accent strip along the card's bottom edge while chaos is active. */
export function ChaosAccentStrip({ effect }: { effect: ChaosEffect }) {
  return (
    <div className="mt-1.5 -mx-3 -mb-3 px-3 py-1.5 rounded-b-xl bg-[rgba(240,86,74,0.10)] border-t border-[rgba(240,86,74,0.35)] flex items-center justify-between">
      <span className="text-[10px] font-mono font-semibold text-[#F0564A]">
        {CHAOS_LABELS[effect.chaosType]}
      </span>
      <span className="text-[10px] font-mono text-[#F0564A] tabular-nums">
        {effect.remainingTicks}s
      </span>
    </div>
  );
}