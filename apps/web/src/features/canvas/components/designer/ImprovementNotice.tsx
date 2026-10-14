import { Link, useLocation, useNavigate } from "react-router-dom";
import { GitCompareArrows } from "lucide-react";
import { useCanvasStore } from "../../store/canvasStore";
import { readImprovementContext } from "../../improvement";

/* While improving a recorded run, the next run reuses that run's workload and
seed so the two can be compared. The context can be dropped at any time. */
export function ImprovementNotice() {
  const location = useLocation(), navigate = useNavigate();
  const id = useCanvasStore((s) => s.currentLayoutId);
  const context = readImprovementContext(location.state, id);
  if (!context) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent/30 bg-accent-soft px-4 py-2 text-[13px] text-ink">
      <GitCompareArrows size={15} aria-hidden="true" className="text-accent" />
      <span>Improving a recorded run. <strong className="font-semibold">Run</strong> will reuse its workload and seed and preview the differences first.</span>
      <Link to={`/runs/${context.sourceRunId}`} className="font-medium text-accent underline-offset-2 hover:underline">Source run</Link>
      <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => navigate("/design", { replace: true, state: null })}>Run normally instead</button>
    </div>
  );
}
