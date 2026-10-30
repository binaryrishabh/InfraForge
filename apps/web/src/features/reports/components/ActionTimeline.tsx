import type { RunAction } from "@infraforge/contracts/actions";
import { formatDate, plural } from "@/lib/format";
import { StatusMark } from "@/ui/StatusMark";
import type { StatusKind } from "@/ui/status";
import { INTERVENTIONS } from "@infraforge/domain/resource";
import { FAULTS } from "@/features/live/faults";
import { isChallengeExperiment } from "../labels";

function describe(action: RunAction) {
  const p = action.parameters;
  if ("interventionId" in p) {
    const d = INTERVENTIONS.find(d => d.id === p.interventionId && d.revision === p.revision);
    const target = "resourceId" in p.target ? p.target.resourceId : `${p.target.edgeId} (${p.target.direction})`;
    return `${d?.label ?? p.interventionId} v${p.revision} on ${target}: ${Object.entries(p.parameters).map(([name, value]) => `${name} ${value} ${d?.parameters.find(p => p.name === name)?.unit ?? ""}`).join(", ") || "one-shot"}`;
  }
  if ("targetLoadFraction" in p) return `Load target requested: ${Math.round(p.targetLoadFraction * 100)}% of the declared workload`;
  if ("speed" in p) return `Speed requested: ${p.speed}×`;
  if ("type" in p) return `${FAULTS.find((f) => f.id === p.type)?.label ?? p.type} on ${p.resourceId}`;
  if ("skuId" in p) return `${p.resourceId} → size ${p.skuId}`;
  if ("delta" in p) return `Pool ${p.lbId}: requested change ${p.delta > 0 ? "+" : ""}${p.delta}`;
  if ("resources" in p) return `Topology accepted as revision ${p.acceptedRevision}: ${plural(p.resources.length, "resource")}, ${plural(p.connectionLines.length, "connection")}`;
  if ("trigger" in p && p.trigger === "challenge-evaluation") return "Automatic stop at the challenge's evaluation second.";
  if ("trigger" in p && p.trigger === "matched-stop") return "Automatic stop at the source run's simulated duration (matched stop).";
  return "Stop requested; the exact final state requires simulator confirmation.";
}
const KIND: Record<RunAction["status"], StatusKind> = { requested: "pending", applying: "pending", running: "in-progress", completed: "finished", failed: "failed", cancelled: "unavailable" };
const STATUS_LABEL: Record<RunAction["status"], string> = { requested: "Requested", applying: "Applying", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
const ACTION_LABEL: Record<RunAction["kind"], string> = {
  intervention: "Intervention", load: "Load change", speed: "Speed change", chaos: "Fault", "vertical-scale": "Resize", "pool-scale": "Pool change", topology: "Live edit", teardown: "Stop",
};

/* Durable actions in accepted order. A request, its application and its
completion are separate facts. */
export function ActionTimeline({ actions }: { actions: RunAction[] }) {
  if (!actions.length) return null;
  return (
    <>
      <p className="mb-4 max-w-[72ch] text-ink-3">Requests and effects are distinct. Sequence is the accepted request order; the simulator applies them in that order. Simulated time advances only while the run is unpaused.</p>
      <ol className="flex flex-col gap-4">
        {actions.map((action) => {
          const o = action.outcome;
          return (
            <li key={action.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3">
              <span className="if-num pt-0.5 text-right text-xs text-ink-3">#{action.sequence}</span>
              <div className="min-w-0 border-l border-line pl-3">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold text-ink">{isChallengeExperiment(action) ? "Challenge experiment" : ACTION_LABEL[action.kind] ?? action.kind}</span><StatusMark size="sm" kind={KIND[action.status]} label={action.status === "completed" && o?.intervention?.interventionId === "pool-reset" ? "Applied" : STATUS_LABEL[action.status] ?? action.status} /></p>
                <p className="mt-0.5 text-ink">{describe(action)}</p>
                {isChallengeExperiment(action) && <p className="mt-0.5 text-xs text-ink-3">Scheduled by the challenge definition and applied by InfraForge, not requested from the controls.</p>}
                <p className="mt-0.5 text-xs text-ink-3">Requested <time dateTime={action.requestedAt}>{formatDate(action.requestedAt)}</time></p>
                {action.appliedAt ? <p className="text-xs text-ink-2">Applied / started <time dateTime={action.appliedAt}>{formatDate(action.appliedAt)}</time> · simulated second {action.appliedSimulatedSeconds}</p>
                  : <p className="text-xs text-ink-3">No simulator application is recorded.</p>}
                {action.completedAt && <p className="text-xs text-ink-2">{action.status} <time dateTime={action.completedAt}>{formatDate(action.completedAt)}</time>{action.completedSimulatedSeconds !== null && ` · simulated second ${action.completedSimulatedSeconds}`}</p>}
                {o?.appliedTarget !== undefined && <p className="mt-1">Target changed from {Math.round(o.previousTarget! * 100)}% to {Math.round(o.appliedTarget * 100)}%. This records the target, not completion of the load ramp.</p>}
                {o?.appliedSpeed !== undefined && <p className="mt-1">Speed changed from {o.previousSpeed}× to {o.appliedSpeed}×.</p>}
                {o?.durationSimulatedSeconds !== undefined && <p className="mt-1">Injected duration: {o.durationSimulatedSeconds} simulated seconds.</p>}
                {o?.baselineOverallHealth && <p className="mt-1">Overall health when the fault was applied: {o.baselineOverallHealth}.</p>}
                {o?.faultEnded && <p className="mt-1">Injected fault ended. Overall health recorded at its end: {o.observedOverallHealth}. This does not establish full system recovery.</p>}
                {o?.intervention && <p className="mt-1">Resolved targets: {o.intervention.resolvedTargets.join(", ")}. Applies at {o.intervention.atUs} us{ o.intervention.endUs === null ? "; one-shot" : `; baseline restore at ${o.intervention.endUs} us`}. {o.interventionEnded ? "Control completed; downstream effects may remain." : "Completion has not been recorded."}</p>}
                {o?.installedSkuId && <p className="mt-1">Observed online on {o.installedSkuId}.</p>}
                {o?.previousReplicaCount !== undefined && <p className="mt-1">Pool replicas at application: {o.previousReplicaCount}.</p>}
                {o?.finalReplicaCount !== undefined && <p className="mt-1">Pool replicas when provisioning or draining completed: {o.finalReplicaCount}.</p>}
                {o?.appliedRevision !== undefined && <p className="mt-1">Simulator-applied topology revision: {o.appliedRevision}.</p>}
                {o?.capturedAt && <p className="mt-1">Exact terminal snapshot captured <time dateTime={o.capturedAt}>{formatDate(o.capturedAt)}</time>.</p>}
                {action.failureReason && <p className="mt-1 text-warn">{action.failureReason}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
