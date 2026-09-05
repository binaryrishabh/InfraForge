import { useSimulationStore } from "../store/simulationStore";

export function CostBurnTicker() {
  const accumulatedCostUsd = useSimulationStore((s) => s.accumulatedCostUsd);
  const burnRatePerHourUsd = useSimulationStore((s) => s.burnRatePerHourUsd);

  return (
    <div className="flex items-center gap-2 bg-[#12161F] border border-[#273042] rounded-lg px-3 h-8">
      <span className="text-[9px] uppercase tracking-wider text-[#677185] font-medium">
        Burned
      </span>
      <span className="text-[12px] font-mono text-green-400 tabular-nums">
        ${accumulatedCostUsd.toFixed(2)}
      </span>
      <span className="text-[#273042] select-none">·</span>
      <span className="text-[11px] font-mono text-[#AAB4C5] tabular-nums">
        ${burnRatePerHourUsd.toFixed(2)}/hr
      </span>
    </div>
  );
}