import { useState } from "react";
import { toast } from "sonner";
import { scalePool } from "@/api/deployment.api";
import { useSimulationStore } from "../store/simulationStore";

interface ManualScalePanelProps {
  deploymentId: string;
  status: string;
}

export function ManualScalePanel({ deploymentId, status }: ManualScalePanelProps) {
  const pools = useSimulationStore((s) => s.pools);
  const [loadingLb, setLoadingLb] = useState<string | null>(null);
  const isLive = status === "live";

  const sortedPools = Object.values(pools).sort((a, b) => a.lbId.localeCompare(b.lbId));

  const handleScale = async (lbId: string, delta: number) => {
    setLoadingLb(lbId);
    try {
      const message = await scalePool(deploymentId, lbId, delta);
      toast.success(message);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to scale pool");
    } finally {
      setLoadingLb(null);
    }
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400">Manual Scale</h3>
      </div>

      {sortedPools.length === 0 ? (
        <p className="text-[9px] text-[#677185]">No VM pools detected — place VMs behind a Load Balancer.</p>
      ) : (
        <div className="space-y-2.5">
          {sortedPools.map((pool) => {
            const isLoading = loadingLb === pool.lbId;
            const hasPending = pool.pending !== null;
            const minusDisabled =
              !isLive ||
              isLoading ||
              hasPending ||
              pool.currentReplicas <= pool.minReplicas ||
              pool.currentReplicas <= pool.baseVmIds.length;
            const plusDisabled =
              !isLive ||
              isLoading ||
              hasPending ||
              pool.currentReplicas >= pool.maxReplicas;

            return (
              <div key={pool.lbId}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-mono text-[#EDF1F7]">{pool.lbId}</p>
                    <p className="text-[9px] font-mono text-[#677185]">
                      min {pool.minReplicas} · max {pool.maxReplicas}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleScale(pool.lbId, -1)}
                      disabled={minusDisabled}
                      className="w-6 h-6 rounded-lg bg-[#5B8CFF] text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-[13px] font-medium leading-none"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-[13px] font-mono font-semibold text-[#EDF1F7]">
                      {pool.currentReplicas}
                    </span>
                    <button
                      onClick={() => handleScale(pool.lbId, 1)}
                      disabled={plusDisabled}
                      className="w-6 h-6 rounded-lg bg-[#5B8CFF] text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.95] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-[13px] font-medium leading-none"
                    >
                      +
                    </button>
                  </div>
                </div>
                {pool.pending && (
                  <p className="text-[9px] font-mono text-[#F5A524] mt-1">
                    {pool.pending.action === "up" ? "provisioning…" : "draining…"} {pool.pending.secondsRemaining}s
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-[#677185] mt-1.5">Base replicas are never removed by manual scale-down.</p>
      {!isLive && (
        <p className="text-[9px] text-[#677185] mt-1.5">Manual scaling is available while the environment is live.</p>
      )}
    </div>
  );
}