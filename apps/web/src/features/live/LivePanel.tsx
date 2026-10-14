import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import type { ChallengeBrief } from "@infraforge/contracts/challenges";
import type { Deployment, DeploymentTimeline } from "@infraforge/contracts/deployment";
import type { Resource } from "@infraforge/domain/resource";
import { describeWorkload } from "@/lib/format";
import { faultLabel } from "@/features/challenges/experiment";
import { Tabs, TabPanel } from "@/ui/Tabs";
import { RequirementList } from "@/features/challenges/components/RequirementList";
import { LoadControl } from "./controls/LoadControl";
import { PoolControl } from "./controls/PoolControl";
import { ResizeControl } from "./controls/ResizeControl";
import { FaultControl } from "./controls/FaultControl";
import { NodeLive } from "./NodeLive";
import { GatesPanel } from "./GatesPanel";
import { EventsLog } from "./EventsLog";
import { LockedPrediction } from "./LockedPrediction";

export type LiveTab = "controls" | "resource" | "gates" | "events";

function ChallengeConditions({ run, brief }: { run: Deployment; brief: ChallengeBrief | null }) {
  return (
    <div>
      <section className="border-b border-line px-4 py-4">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Lock size={13} aria-hidden="true" /> Fixed conditions</h3>
        <p className="mt-1.5 text-sm text-ink-2">This attempt runs exactly as briefed. Load, faults, scaling and design edits are unavailable because they would change what is judged. You can change the speed or stop.</p>
        {run.challengeExperiment && <p className="mt-1.5 text-sm text-ink-2">The one exception is the challenge's own experiment: InfraForge applies a {faultLabel(run.challengeExperiment.fault).toLowerCase()} to {run.challengeExperiment.targetResourceId} at second {run.challengeExperiment.atSimulatedSecond}, active for {run.challengeExperiment.durationSimulatedSeconds} seconds.</p>}
        {brief && <p className="mt-2 text-xs text-ink-3">{describeWorkload(brief.workload)}. Stops by itself at second {brief.evaluationSeconds}.</p>}
      </section>
      {brief && run.challengePrediction && <LockedPrediction brief={brief} prediction={run.challengePrediction} />}
      {brief && (
        <section className="px-4 py-4">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Judged at second {brief.evaluationSeconds}</h3>
          <RequirementList criteria={brief.criteria} compact />
        </section>
      )}
    </div>
  );
}

/* Run column: controls (or the challenge's fixed conditions), the selected
resource, gate evidence and simulator events. */
export function LivePanel({ tab, onTab, deploymentId, run, status, completed, timeline, resources, selected, brief, isLive }: {
  tab: LiveTab; onTab: (tab: LiveTab) => void; deploymentId: string; run: Deployment | null; status: string; completed: string[];
  timeline: DeploymentTimeline[]; resources: Resource[]; selected: Resource | undefined; brief: ChallengeBrief | null; isLive: boolean;
}) {
  const challenge = !!run?.challengeId;
  const items = [
    { id: "controls" as const, label: challenge ? "Attempt" : "Controls" },
    { id: "resource" as const, label: "Resource" },
    { id: "gates" as const, label: "Gates" },
    { id: "events" as const, label: "Events" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs idBase="live" label="Run details" items={items} value={tab} onChange={onTab} className="shrink-0 px-2" />
      <div className={tab === "events" ? "min-h-0 flex-1" : "if-scroll min-h-0 flex-1 overflow-y-auto"}>
        <TabPanel idBase="live" id={tab} className={tab === "events" ? "h-full" : undefined}>
          {tab === "controls" && (run && challenge ? <ChallengeConditions run={run} brief={brief} /> : !isLive ? (
            <p className="px-4 py-6 text-sm text-ink-3">Controls are available while the run is live.</p>
          ) : (
            <>
              {run?.sourceRunId && <p className="border-b border-line px-4 py-3 text-sm text-ink-2">
                {run.rerunMode === "exact" ? "Exact rerun" : "Rerun with the current design"} of <Link className="font-medium text-accent hover:underline" to={`/runs/${run.sourceRunId}`}>its source run</Link>. Source actions are not replayed.</p>}
              <LoadControl deploymentId={deploymentId} />
              <PoolControl deploymentId={deploymentId} />
              <ResizeControl deploymentId={deploymentId} resources={resources} />
              <FaultControl deploymentId={deploymentId} resources={resources} />
            </>
          ))}
          {tab === "resource" && <NodeLive deploymentId={deploymentId} resource={selected} resources={resources} controls={isLive && !challenge} ended={["completed", "torn-down", "failed"].includes(status)} />}
          {tab === "gates" && <GatesPanel run={run} status={status} completed={completed} timeline={timeline} />}
          {tab === "events" && <EventsLog />}
        </TabPanel>
      </div>
    </div>
  );
}
