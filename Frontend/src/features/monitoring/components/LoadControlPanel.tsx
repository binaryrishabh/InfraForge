import { useRef, useState } from "react";
import { toast } from "sonner";
import { setDeploymentLoad } from "@/api/deployment.api";
import { useSimulationStore } from "../store/simulationStore";

interface LoadControlPanelProps {
  deploymentId: string;
  status: string;
}

export function LoadControlPanel({ deploymentId, status }: LoadControlPanelProps) {
  const appliedLoad = useSimulationStore((s) => s.loadFraction);
  const [sliderPct, setSliderPct] = useState(100);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLive = status === "live";

  const commitLoad = async (pct: number) => {
    try {
      const message = await setDeploymentLoad(deploymentId, pct / 100);
      toast.success(message);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to adjust load");
    }
  };

  const handleChange = (value: number) => {
    setSliderPct(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commitLoad(value), 400);
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400">Load Control</h3>
        <span className="text-[9px] font-mono text-[#677185]">applied {Math.round(appliedLoad * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={sliderPct}
        disabled={!isLive}
        onChange={(e) => handleChange(Number(e.target.value))}
        className="w-full accent-[#5B8CFF] disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <div className="flex justify-between mt-1.5">
        <span className="text-[9px] font-mono text-[#677185]">0%</span>
        <span className={`text-[11px] font-mono font-semibold ${sliderPct > 100 ? "text-[#F5A524]" : "text-[#AAB4C5]"}`}>
          target {sliderPct}%
        </span>
        <span className="text-[9px] font-mono text-[#677185]">200%</span>
      </div>
      {!isLive && (
        <p className="text-[9px] text-[#677185] mt-1.5">Load control is available while the environment is live.</p>
      )}
    </div>
  );
}