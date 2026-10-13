import { useCallback } from "react";
import { Link } from "react-router-dom";
import { getSpecificDeployment } from "../../../api/deployment.api";
import { getRunReport } from "../../../api/reports.api";
import { useReportRequest } from "../useReportRequest";
import { useSimulationStore } from "../../monitoring/store/simulationStore";

export function LiveRerunContext({ id, finished }: { id: string; finished: boolean }) {
  const load = useCallback(async () => { const run = await getSpecificDeployment(id);
    const source = run.sourceRunId ? (await getRunReport(run.sourceRunId)).run : null;
    return { run, source }; }, [id]);
  const { data } = useReportRequest(load);
  const seconds = useSimulationStore((s) => s.simulatedSeconds);
  if (!data) return null;
  const { run, source } = data;
  if (!run.rerunMode && !finished) return null;
  return <div className="mt-2 pointer-events-auto rounded-lg border border-[#2A2E37] bg-[#1C1F26] p-2 text-xs text-[#C3C7D0] max-w-[calc(100vw-7rem)]">
    {run.rerunMode && <p>{run.rerunMode === "exact" ? "Exact rerun" : "Current-design rerun"} · source: {source?.infrastructureName ?? "source link unavailable"}</p>}
    {run.autoStopAtSimulatedSeconds != null && <p>Matched stop: {run.autoStopAtSimulatedSeconds} s · {Math.max(0, run.autoStopAtSimulatedSeconds - seconds)} simulated seconds remaining</p>}
    {finished && <p className="flex flex-wrap gap-3"><Link className="text-[#4FA89B] underline" to={`/reports/${id}`}>View report</Link>{run.sourceRunId && <Link className="text-[#4FA89B] underline" to={`/reports/compare?a=${run.sourceRunId}&b=${id}`}>Compare with source run</Link>}</p>}
  </div>;
}
