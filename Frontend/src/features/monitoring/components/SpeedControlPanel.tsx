import { useState } from "react";
import { toast } from "sonner";
import { setDeploymentSpeed } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_IDLE_CLASS } from "@/theme/controlClasses";

interface SpeedControlPanelProps {
  deploymentId: string;
  status: string;
}

const SPEED_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "⏸" },
  { value: 1, label: "1x" },
  { value: 10, label: "10x" },
  { value: 60, label: "60x" }
];

export function SpeedControlPanel({ deploymentId, status }: SpeedControlPanelProps) {
  const speed = useSimulationStore((s) => s.speed);
  const [loading, setLoading] = useState(false);
  const isLive = status === "live";

  const handleSpeed = async (value: number) => {
    if (value === speed) return;
    setLoading(true);
    // Optimistic update so the UI feels instant
    const restoreSpeed = useSimulationStore.getState().setSpeed(value);
    try {
      await setDeploymentSpeed(deploymentId, value);
    } catch (err) {
      restoreSpeed();
      toast.error(errorMessage(err, "Failed to set speed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-0.5 bg-[#14161A] border border-[#2A2E37] rounded-lg p-0.5">
      {SPEED_OPTIONS.map((opt) => {
        const isActive = speed === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleSpeed(opt.value)}
            disabled={!isLive || loading}
            className={`px-2 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              isActive ? TOGGLE_ACTIVE_CLASS : `${TOGGLE_IDLE_CLASS} hover:bg-[#2A2E37]/60`
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
