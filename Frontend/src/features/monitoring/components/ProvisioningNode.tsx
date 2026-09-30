import { Server } from "lucide-react";
import { useSimulationStore } from "../store/simulationStore";

interface ProvisioningNodeProps {
  vm: {
    id: string;
    poolId: string;
    x: number;
    y: number;
  };
}

/* Provisioning ghost: bronze dashed box — warning family, not danger. */
export function ProvisioningNode({ vm }: ProvisioningNodeProps) {
  const pool = useSimulationStore((s) => s.pools[vm.poolId]);
  const secondsRemaining = pool?.pending?.secondsRemaining ?? 0;
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: vm.x, top: vm.y }}
    >
      <div className="w-12 h-12 rounded-lg bg-[#1C1F26]/60 border-2 border-dashed border-[#C98A4B]/70 flex items-center justify-center animate-pulse">
        <Server size={20} strokeWidth={1.75} className="text-[#C98A4B]" />
      </div>
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-center whitespace-nowrap">
        <p className="text-[8px] font-mono text-[#C98A4B]">
          booting… {secondsRemaining}s
        </p>
        <p className="text-[8px] font-mono text-[#5A5F6B] truncate max-w-20">
          {vm.id}
        </p>
      </div>
    </div>
  );
}