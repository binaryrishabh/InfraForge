import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChartGantt, PanelRight } from "lucide-react";
import { DeploymentStatus } from "@infraforge/contracts/deployment";
import { useDeploymentSocket } from "@/features/deployment/hooks/useDeploymentSocket";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { CanvasDnd } from "@/features/canvas/components/CanvasDnd";
import { CanvasBoard } from "@/features/canvas/components/CanvasBoard";
import { fitCanvasView } from "@/features/canvas/hooks/useCanvasViewport";
import { ZoomControls } from "@/features/canvas/components/ZoomControls";
import { useChallengeBrief } from "@/features/challenges/useChallengeBrief";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Button, ButtonLink } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { HealthMark } from "@/ui/HealthMark";
import { RunBar } from "./RunBar";
import { LivePanel, type LiveTab } from "./LivePanel";
import { GateList } from "./GatesPanel";
import { useStopRun } from "./useStopRun";
import { runPhase } from "./runState";
import { leaveRun } from "./leaveRun";
import { ExperimentStrip } from "./ExperimentStrip";
import { LiveTimetable } from "./LiveTimetable";
import { useExperimentPlan } from "@/features/challenges/experimentPlanStore";
import { recordedPlan } from "@/features/challenges/experiment";
import { plural } from "@/lib/format";
import { ScenarioSchedule } from "./ScenarioSchedule";

/* The live run: always in the ink theme so it reads as an instrument. The architecture
stays in the middle, the run so far grows along the timetable beneath it, and state and
controls live in one bar and one column. */
export function LiveWorkspace({ deploymentId }: { deploymentId: string }) {
  const { deployment, status, completedStages, timeline } = useDeploymentSocket(deploymentId);
  const { stop, stopping, stopped } = useStopRun(deploymentId);
  const resources = useCanvasStore((s) => s.resources);
  const selected = useCanvasStore((s) => s.resources.find((r) => r.id === s.selectedResourceForConfigId));
  const overall = useSimulationStore((s) => s.health);
  const seconds = useSimulationStore((s) => s.simulatedSeconds);
  const challenge = deployment?.challengeId ?? null;
  const brief = useChallengeBrief(challenge, deployment?.challengeVersion);
  const phase = runPhase(stopped ? "torn-down" : status, stopping);
  const isLive = status === DeploymentStatus.LIVE && !stopped;
  const wide = useMediaQuery("(min-width: 768px)");
  const [tab, setTab] = useState<LiveTab>("controls");
  const [panelOpen, setPanelOpen] = useState(false);
  const roomy = useMediaQuery("(min-height: 720px)");
  const [timetable, setTimetable] = useState<boolean | null>(null);
  const showTimetable = (timetable ?? (wide && roomy)) && !!deployment?.liveTopology;
  // Opening or closing the timetable changes the canvas height; keep the whole architecture in view.
  useEffect(() => { const frame = requestAnimationFrame(fitCanvasView); return () => cancelAnimationFrame(frame); }, [showTimetable]);

  // Portalled dialogs and toasts read the theme from the document root, so the whole page switches to ink.
  useEffect(() => {
    const root = document.documentElement, previous = root.dataset.theme;
    root.dataset.theme = "ink";
    return () => { if (previous) root.dataset.theme = previous; else delete root.dataset.theme; };
  }, []);
  // A resilience attempt's recorded fault, for the strip and the node cards.
  const recorded = deployment?.challengeExperiment ?? null;
  const plan = recorded ? recordedPlan(recorded) : null;
  const planKey = recorded ? JSON.stringify(recorded) : null;
  useEffect(() => {
    useExperimentPlan.getState().setPlan(planKey ? recordedPlan(JSON.parse(planKey)) : null);
    return () => useExperimentPlan.getState().setPlan(null);
  }, [planKey]);
  // Model 2 runs use a fixed design. The existing lock blocks pointer, keyboard and inspector edits.
  useEffect(() => {
    useCanvasStore.getState().setLiveLocked(true);
    return () => useCanvasStore.getState().setLiveLocked(false);
  }, []);
  useEffect(() => {
    const store = useCanvasStore.getState();
    store.setLiveMode(isLive);
    if (isLive || ["failed", "torn-down", "completed"].includes(status)) store.setIsDeploying(false);
    return () => store.setLiveMode(false);
  }, [isLive, status]);
  // Selecting a resource on the canvas brings its live view forward.
  const [seenSelection, setSeenSelection] = useState(selected?.id);
  if (seenSelection !== selected?.id) { setSeenSelection(selected?.id); if (selected) setTab("resource"); }

  const panel = <LivePanel tab={tab} onTab={setTab} deploymentId={deploymentId} run={deployment} status={status} completed={completedStages} timeline={timeline}
    resources={resources} selected={selected} brief={brief?.data ?? null} isLive={isLive} />;
  const finished = phase === "finished" || phase === "failed";
  return (
    <div data-theme="ink" className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
      <RunBar run={deployment} deploymentId={deploymentId} phase={phase} challengeTitle={brief?.data?.title ?? null} onStop={stop} stopping={stopping} />
      {plan && deployment?.evaluationStopAtSimulatedSeconds != null && <ExperimentStrip plan={plan} evaluationSeconds={deployment.evaluationStopAtSimulatedSeconds} compact={!!showTimetable} />}
      {brief?.data?.id === challenge && brief.data.version === deployment?.challengeVersion && brief.data.scenario?.visibility === "revealed" && <section className="shrink-0 border-b border-line bg-surface px-3 py-2 sm:px-4"><ScenarioSchedule deploymentId={deploymentId} scenario={brief.data.scenario} resources={deployment.runInputs?.resources ?? resources} /></section>}
      <CanvasDnd>
        <div className="relative flex min-h-0 flex-1">
          <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col outline-none" aria-label="Live architecture">
            <CanvasBoard label="Live architecture. Tab through resources; Enter shows live measurements." />
            <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
              <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface/95 px-3 py-1.5 shadow-e2">
                <span className="text-xs text-ink-3">Overall</span>{overall ? <HealthMark value={overall} /> : <span className="text-sm text-ink-3">no measurement yet</span>}
              </div>
            </div>
            {(phase === "starting" || phase === "connection" || (phase === "failed" && !deployment?.liveTopology)) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4">
                <section aria-labelledby="starting-title" className="w-full max-w-[380px] rounded-lg border border-line bg-surface p-5 shadow-e3" aria-live="polite">
                  <h2 id="starting-title" className="if-title text-[20px]">{phase === "connection" ? "Reconnecting to the run…" : phase === "failed" ? "The run did not start" : "Starting the run"}</h2>
                  <p className="mt-1 text-sm text-ink-2">{phase === "failed" ? "A gate stopped it. The recorded reason is below." : "Three gates record evidence before the simulation goes live."}</p>
                  <div className="mt-4"><GateList status={status} completed={completedStages} /></div>
                  {phase === "failed" && <p role="alert" className="mt-3 border-l-2 border-fail pl-2.5 text-sm">{timeline.at(-1)?.message ?? "No failure message was recorded."}</p>}
                  {phase === "failed" && <Button className="mt-4" variant="secondary" size="sm" onClick={leaveRun}>Back to the designer</Button>}
                </section>
              </div>
            )}
            {finished && deployment?.liveTopology && (
              <div role="status" className="absolute inset-x-3 bottom-14 z-20 mx-auto flex max-w-[640px] flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-e3">
                <p className="min-w-0 flex-1 text-sm text-ink">{phase === "failed" ? "This run failed." : `This run stopped at simulated second ${seconds}.`}
                  {challenge && phase !== "failed" && " The result compares your design and your prediction with what was recorded."}</p>
                <ButtonLink to={`/runs/${deploymentId}`} variant="primary" size="sm">{challenge ? "See the result" : "Open the report"}</ButtonLink>
                {deployment.sourceRunId && <Link className="text-sm font-medium text-accent hover:underline" to={`/runs/compare?a=${deployment.sourceRunId}&b=${deploymentId}`}>Compare with source</Link>}
                <Button variant="ghost" size="sm" onClick={leaveRun}>Back to the designer</Button>
              </div>
            )}
            {showTimetable && <LiveTimetable deploymentId={deploymentId} resources={resources} seconds={seconds} plan={plan} evaluation={deployment?.evaluationStopAtSimulatedSeconds ?? null} />}
            <div className="flex h-10 shrink-0 items-center justify-between border-t border-line bg-surface px-3 text-xs text-ink-3">
              <span className="min-w-0 truncate" title="Design edits are unavailable during a Model 2 run. Stop and return to the designer to make changes."><span className="if-num">{plural(resources.length, "resource")} · revision {deployment?.topologyRevision ?? 0}{challenge ? " · design locked for this attempt" : " · design locked for this run"}</span>
                {isLive && <span className="max-md:hidden"> · Lines are declared connections, not measured traffic.</span>}</span>
              <div className="flex items-center gap-1">
                {deployment?.liveTopology && <Button size="sm" variant="ghost" aria-pressed={!!showTimetable} icon={<ChartGantt size={14} aria-hidden="true" />} onClick={() => setTimetable(!showTimetable)}>Timetable</Button>}
                {!wide && <Button size="sm" variant="ghost" icon={<PanelRight size={14} aria-hidden="true" />} onClick={() => setPanelOpen(true)}>Details</Button>}
                <ZoomControls />
              </div>
            </div>
          </main>
          {wide && <aside className="w-[360px] shrink-0 border-l border-line bg-surface" aria-label="Run details">{panel}</aside>}
        </div>
        {!wide && <Dialog open={panelOpen} onOpenChange={setPanelOpen} title="Run details" size="md"><div className="-mx-5 -my-4 h-[70dvh]">{panel}</div></Dialog>}
      </CanvasDnd>
    </div>
  );
}
