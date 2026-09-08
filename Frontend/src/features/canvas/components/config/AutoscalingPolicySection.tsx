import { useEffect, useState } from "react";
import type { Resource } from "@shared/interface/Resource.interface";
import type { AutoscalingPolicy } from "@shared/interface/AutoscalingPolicy.interface";

interface AutoscalingPolicySectionProps {
  resource: Resource;
  onCommit: (policy: AutoscalingPolicy) => void;
}

export function AutoscalingPolicySection({ resource, onCommit }: AutoscalingPolicySectionProps) {
  const [enabled, setEnabled] = useState(true);
  const [minReplicas, setMinReplicas] = useState(2);
  const [maxReplicas, setMaxReplicas] = useState(6);
  const [targetCpu, setTargetCpu] = useState(75);

  useEffect(() => {
    const policy = resource.autoscaling;
    setEnabled(policy?.enabled ?? true);
    setMinReplicas(policy?.minReplicas ?? 2);
    setMaxReplicas(policy?.maxReplicas ?? 6);
    setTargetCpu(policy?.targetCpu ?? 75);
  }, [resource.id]);

  const commit = (patch: Partial<AutoscalingPolicy>) => {
    const next: AutoscalingPolicy = {
      enabled: patch.enabled ?? enabled,
      minReplicas: patch.minReplicas ?? minReplicas,
      maxReplicas: patch.maxReplicas ?? maxReplicas,
      targetCpu: patch.targetCpu ?? targetCpu,
    };
    if (next.maxReplicas !== undefined && next.minReplicas !== undefined) {
      if (next.maxReplicas < next.minReplicas) {
        next.maxReplicas = next.minReplicas;
      }
    }
    onCommit(next);
  };

  const handleEnabledChange = (value: boolean) => {
    setEnabled(value);
    commit({ enabled: value });
  };

  const handleMinChange = (value: number) => {
    const clamped = Math.max(1, Math.min(8, value));
    const effectiveMax = Math.max(clamped, maxReplicas);
    setMinReplicas(clamped);
    setMaxReplicas(effectiveMax);
    commit({ minReplicas: clamped, maxReplicas: effectiveMax });
  };

  const handleMaxChange = (value: number) => {
    const clamped = Math.max(minReplicas, Math.min(8, value));
    setMaxReplicas(clamped);
    commit({ maxReplicas: clamped });
  };

  const handleTargetCpuChange = (value: number) => {
    setTargetCpu(value);
    commit({ targetCpu: value });
  };

  return (
    <section>
      <h4 className="text-[12px] uppercase tracking-wider text-[#677185] font-semibold mb-3">
        Autoscaling policy
      </h4>
      <div className="space-y-4">
        <div className="flex rounded-lg border border-[#273042] overflow-hidden">
          <button
            type="button"
            onClick={() => handleEnabledChange(true)}
            className={`flex-1 h-9 text-[12px] transition-colors duration-150 ${
              enabled
                ? "bg-[#5B8CFF] text-[#081018] font-medium"
                : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"
            }`}
          >
            Enabled
          </button>
          <button
            type="button"
            onClick={() => handleEnabledChange(false)}
            className={`flex-1 h-9 text-[12px] transition-colors duration-150 ${
              !enabled
                ? "bg-[#5B8CFF] text-[#081018] font-medium"
                : "bg-[#0B0E14] text-[#AAB4C5] hover:text-[#EDF1F7]"
            }`}
          >
            Disabled
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#677185] mb-1.5">
              Min replicas
            </label>
            <input
              type="number"
              min={1}
              max={8}
              value={minReplicas}
              onChange={(e) => handleMinChange(Number(e.target.value))}
              className="w-full h-9 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] font-mono text-[#EDF1F7] px-3 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-[#677185] mb-1.5">
              Max replicas
            </label>
            <input
              type="number"
              min={1}
              max={8}
              value={maxReplicas}
              onChange={(e) => handleMaxChange(Number(e.target.value))}
              className="w-full h-9 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] font-mono text-[#EDF1F7] px-3 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-[11px] uppercase tracking-wider text-[#677185]">
              Target CPU
            </label>
            <span className="text-[12px] font-mono text-[#AAB4C5]">{targetCpu}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={90}
            step={5}
            value={targetCpu}
            onChange={(e) => handleTargetCpuChange(Number(e.target.value))}
            className="w-full accent-[#5B8CFF]"
          />
          <div className="flex justify-between text-[10px] font-mono text-[#677185] mt-1">
            <span>50%</span>
            <span>90%</span>
          </div>
        </div>

        <p className="text-[11px] text-[#677185] leading-relaxed">
          Defaults when unset: min = current VM count, max = 3x (cap 8),
          target 75%. Changes apply to the pool behind this load balancer.
        </p>
      </div>
    </section>
  );
}