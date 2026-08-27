import { useState } from "react";
import { Modal } from "@/components/UI/Modal";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";

interface DeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceCount: number;
  connectionCount: number;
  loading?: boolean;
  onDeploy: (profile: WorkloadProfile) => void;
}

export function DeployModal({ open, onOpenChange, resourceCount, connectionCount, loading = false, onDeploy }: DeployModalProps) {
  const [targetThroughput, setTargetThroughput] = useState(1_000_000);
  const [throughputUnit, setThroughputUnit] = useState<"per-minute" | "per-hour">("per-hour");
  const [trafficShape, setTrafficShape] = useState<"steady" | "peak">("steady");
  const [peakMultiplier, setPeakMultiplier] = useState(3);
  const [readWriteRatio, setReadWriteRatio] = useState(0.8);
  const [payloadSize, setPayloadSize] = useState<"light" | "medium" | "heavy">("medium");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const divisor = throughputUnit === "per-minute" ? 60 : 3600;
  const rpsPreview = targetThroughput > 0 ? Math.round(targetThroughput / divisor) : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetThroughput || targetThroughput <= 0) return;
    const profile: WorkloadProfile = {
      targetThroughput,
      throughputUnit,
      trafficShape,
      peakMultiplier: trafficShape === "peak" ? peakMultiplier : undefined,
      readWriteRatio,
      payloadSize
    };
    onDeploy(profile);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Deploy infrastructure" description="Declare the load this architecture must survive." loading={loading}>
      <form onSubmit={handleSubmit}>
        <p className="font-mono text-xs text-[#677185] mb-4">{resourceCount} resources · {connectionCount} connections</p>

        <div className="mb-4">
          <label className="block text-xs font-medium text-[#AAB4C5] mb-1.5">Target throughput</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={targetThroughput}
              onChange={(e) => setTargetThroughput(Number(e.target.value))}
              disabled={loading}
              className="flex-1 h-9 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] text-[#EDF1F7] px-3 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150"
            />
            <div className="flex rounded-lg border border-[#273042] overflow-hidden shrink-0">
              <button type="button" onClick={() => setThroughputUnit("per-hour")} className={`px-3 text-xs transition-colors duration-150 ${throughputUnit === "per-hour" ? "bg-[#5B8CFF] text-[#081018] font-medium" : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"}`}>/hr</button>
              <button type="button" onClick={() => setThroughputUnit("per-minute")} className={`px-3 text-xs transition-colors duration-150 ${throughputUnit === "per-minute" ? "bg-[#5B8CFF] text-[#081018] font-medium" : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"}`}>/min</button>
            </div>
          </div>
          <p className="text-[11px] text-[#677185] mt-1.5 font-mono">≈ {rpsPreview.toLocaleString()} requests/second at full load</p>
        </div>

        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="w-full flex items-center justify-between text-xs text-[#AAB4C5] hover:text-[#EDF1F7] py-2 border-t border-[#1F2633] transition-colors duration-150">
          <span>Advanced workload settings</span>
          <span>{showAdvanced ? "▴" : "▾"}</span>
        </button>

        {showAdvanced && (
          <div className="space-y-4 pt-3">
            <div>
              <label className="block text-xs font-medium text-[#AAB4C5] mb-1.5">Traffic shape</label>
              <div className="flex rounded-lg border border-[#273042] overflow-hidden">
                <button type="button" onClick={() => setTrafficShape("steady")} className={`flex-1 py-1.5 text-xs transition-colors duration-150 ${trafficShape === "steady" ? "bg-[#5B8CFF] text-[#081018] font-medium" : "bg-[#0B0E14] text-[#AAB4C5]"}`}>Steady</button>
                <button type="button" onClick={() => setTrafficShape("peak")} className={`flex-1 py-1.5 text-xs transition-colors duration-150 ${trafficShape === "peak" ? "bg-[#5B8CFF] text-[#081018] font-medium" : "bg-[#0B0E14] text-[#AAB4C5]"}`}>Peak</button>
              </div>
            </div>

            {trafficShape === "peak" && (
              <div>
                <label className="block text-xs font-medium text-[#AAB4C5] mb-1.5">Peak multiplier</label>
                <input type="number" min={1} max={10} step={0.5} value={peakMultiplier} onChange={(e) => setPeakMultiplier(Number(e.target.value))} disabled={loading} className="w-full h-9 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] text-[#EDF1F7] px-3 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150" />
                <p className="text-[11px] text-[#677185] mt-1">Bursts up to {peakMultiplier}× the base load.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#AAB4C5] mb-1.5">Read / write mix</label>
              <input type="range" min={0} max={100} value={readWriteRatio * 100} onChange={(e) => setReadWriteRatio(Number(e.target.value) / 100)} className="w-full accent-[#5B8CFF]" />
              <div className="flex justify-between text-[11px] font-mono mt-1">
                <span className="text-[#AAB4C5]">{Math.round(readWriteRatio * 100)}% reads</span>
                <span className="text-[#677185]">{Math.round((1 - readWriteRatio) * 100)}% writes</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#AAB4C5] mb-1.5">Payload size</label>
              <div className="flex rounded-lg border border-[#273042] overflow-hidden">
                {(["light", "medium", "heavy"] as const).map(size => (
                  <button key={size} type="button" onClick={() => setPayloadSize(size)} className={`flex-1 py-1.5 text-xs capitalize transition-colors duration-150 ${payloadSize === size ? "bg-[#5B8CFF] text-[#081018] font-medium" : "bg-[#0B0E14] text-[#AAB4C5]"}`}>{size}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-end mt-6">
          <button type="button" onClick={() => onOpenChange(false)} disabled={loading} className="h-8 px-3 rounded-lg bg-[#1D2432] border border-[#273042] text-[13px] font-medium text-[#AAB4C5] hover:bg-[#232B3B] hover:border-[#35415A] hover:text-[#EDF1F7] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed">Cancel</button>
          <button type="submit" disabled={loading || !targetThroughput || targetThroughput <= 0} className="h-8 px-3 rounded-lg bg-[#5B8CFF] text-[13px] font-medium text-[#081018] hover:bg-[#7AA2FF] active:bg-[#4C7DF0] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
            {loading && <span className="w-3.5 h-3.5 border-2 border-[#081018]/30 border-t-[#081018] rounded-full animate-spin" />}
            Deploy
          </button>
        </div>
      </form>
    </Modal>
  );
}