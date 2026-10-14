import { Server } from "lucide-react";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { NODE_CARD_WIDTH } from "../../utils/nodeGeometry";

/* A replica the autoscaler is still bringing online: a dashed outline with the remaining provisioning time. */
export function ProvisioningNode({ vm }: { vm: { id: string; poolId: string; x: number; y: number } }) {
  const remaining = useSimulationStore((s) => s.pools[vm.poolId]?.pending?.secondsRemaining ?? null);
  return (
    <div className="pointer-events-none absolute" style={{ left: vm.x, top: vm.y, width: NODE_CARD_WIDTH }}>
      <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-warn/70 bg-warn-soft/60 text-warn">
        <Server size={18} aria-hidden="true" />
        <p className="text-xs font-semibold">Provisioning replica</p>
        <p className="if-num text-[11px]">{remaining !== null ? `${remaining}s remaining` : vm.id}</p>
      </div>
    </div>
  );
}
