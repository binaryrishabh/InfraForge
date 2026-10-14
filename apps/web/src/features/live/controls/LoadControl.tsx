import { useRef, useState } from "react";
import { toast } from "sonner";
import { setDeploymentLoad } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { ControlBlock } from "./ControlBlock";

/* Sets the target share of the declared workload. The engine ramps toward it;
the applied value follows in the next snapshots. */
export function LoadControl({ deploymentId }: { deploymentId: string }) {
  const applied = useSimulationStore((s) => s.loadFraction);
  const [target, setTarget] = useState(100);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (value: number) => {
    setTarget(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDeploymentLoad(deploymentId, value / 100).catch((error) => toast.error(errorMessage(error, "The load target could not be changed.")));
    }, 400);
  };
  return (
    <ControlBlock title="Load" aside={<span className="if-num">applied {Math.round(applied * 100)}%</span>}>
      <div className="flex justify-between text-[13px] text-ink-2">
        <label htmlFor="load-target">Target share of the workload</label><span aria-hidden="true" className="if-num text-ink">{target}%</span>
      </div>
      <input id="load-target" type="range" min={0} max={200} step={5} value={target} onChange={(e) => change(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--if-accent)]" aria-valuetext={`${target} percent`} />
      <div className="if-num mt-1 flex justify-between text-[11px] text-ink-3"><span>0%</span><span>100%</span><span>200%</span></div>
    </ControlBlock>
  );
}
