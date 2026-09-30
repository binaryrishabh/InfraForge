import { useSimulationStore } from "../store/simulationStore";

/* Live burn readout for the live topbar pill.
shrink-0 + whitespace-nowrap are the wrap fix: the topbar pill carries a
max-width, and as a shrinkable flex child this ticker used to get squeezed
until "$0.00/hr" broke onto two lines and blew the pill's height. Now the
ticker keeps one line at its natural width and the layout name (the only
truncatable child) absorbs any squeeze instead. */
export function CostBurnTicker() {
  const accumulatedCostUsd = useSimulationStore((s) => s.accumulatedCostUsd);
  const burnRatePerHourUsd = useSimulationStore((s) => s.burnRatePerHourUsd);
  return (
    <div className="flex items-center gap-2 bg-[#14161A] border border-[#2A2E37] rounded-lg px-3 h-8 shrink-0 whitespace-nowrap">
      <span className="text-[9px] uppercase tracking-wider text-[#5A5F6B] font-medium">
        Burned
      </span>
      <span className="text-[12px] font-mono text-[#4FA89B] tabular-nums">
        ${accumulatedCostUsd.toFixed(2)}
      </span>
      <span className="text-[#2A2E37] select-none">·</span>
      <span className="text-[11px] font-mono text-[#8B909C] tabular-nums">
        ${burnRatePerHourUsd.toFixed(2)}/hr
      </span>
    </div>
  );
}