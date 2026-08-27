import { useEffect, useState } from "react";
import { toast } from "sonner";
import { injectChaos } from "@/api/deployment.api";
import { DeploymentChaosNames } from "@shared/enum/DeploymentChaosNames.enum";

interface ChaosControlPanelProps {
  deploymentId: string;
  status: string;
  resources: Array<{ id: string; type: string }>;
}

const CHAOS_LABELS: Record<DeploymentChaosNames, string> = {
  [DeploymentChaosNames.Crash]: "Crash",
  [DeploymentChaosNames.CpuSpike]: "CPU Spike",
  [DeploymentChaosNames.MemoryLeak]: "Memory Leak",
  [DeploymentChaosNames.NetworkDelay]: "Network Delay",
  [DeploymentChaosNames.DiskFailure]: "Disk Failure"
};

export function ChaosControlPanel({ deploymentId, status, resources }: ChaosControlPanelProps) {
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");
  const [selectedChaos, setSelectedChaos] = useState<string>(DeploymentChaosNames.Crash);
  const [loading, setLoading] = useState(false);
  const isLive = status === "live";

  useEffect(() => {
    if (resources.length > 0) {
      setSelectedResourceId(resources[0]!.id);
    }
  }, [resources]);

  const handleInject = async () => {
    if (!selectedResourceId) return;
    setLoading(true);
    try {
      const message = await injectChaos(deploymentId, selectedChaos, selectedResourceId);
      toast.success(message);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to inject chaos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400">Chaos Control</h3>
      </div>
      <div className="space-y-2">
        <select
          value={selectedResourceId}
          onChange={(e) => setSelectedResourceId(e.target.value)}
          disabled={!isLive || loading}
          className="w-full h-8 rounded-lg bg-[#0B0E14] border border-[#273042] text-[11px] text-[#EDF1F7] px-2.5 outline-none focus:border-[#5B8CFF] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {resources.map(resource => (
            <option key={resource.id} value={resource.id}>{resource.id}</option>
          ))}
        </select>
        <select
          value={selectedChaos}
          onChange={(e) => setSelectedChaos(e.target.value)}
          disabled={!isLive || loading}
          className="w-full h-8 rounded-lg bg-[#0B0E14] border border-[#273042] text-[11px] text-[#EDF1F7] px-2.5 outline-none focus:border-[#5B8CFF] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {Object.values(DeploymentChaosNames).map(chaos => (
            <option key={chaos} value={chaos}>{CHAOS_LABELS[chaos]}</option>
          ))}
        </select>
        <button
          onClick={handleInject}
          disabled={!isLive || loading || !selectedResourceId}
          className="w-full h-8 rounded-lg bg-[#5B8CFF] border border-[rgba(240,86,74,0.40)] text-[11px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          {loading && (
            <span className="w-3 h-3 border-2 border-[#081018]/30 border-t-[#081018] rounded-full animate-spin" />
          )}
          Inject
        </button>
      </div>
      {!isLive && (
        <p className="text-[9px] text-[#677185] mt-1.5">Chaos can be injected while the environment is live.</p>
      )}
    </div>
  );
}