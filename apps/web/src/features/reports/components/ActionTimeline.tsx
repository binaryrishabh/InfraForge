import type { RunAction } from "@infraforge/contracts/actions";
import { ReportSection } from "./ReportSection";

function parameters(action: RunAction) {
  const p = action.parameters;
  if ("targetLoadFraction" in p) return `Load target requested: ${Math.round(p.targetLoadFraction * 100)}% of declared workload`;
  if ("speed" in p) return `Speed requested: ${p.speed}×`;
  if ("type" in p) return `${p.type} on ${p.resourceId}`;
  if ("skuId" in p) return `${p.resourceId} → SKU ${p.skuId}`;
  if ("delta" in p) return `Pool ${p.lbId}: requested delta ${p.delta > 0 ? "+" : ""}${p.delta}`;
  if ("resources" in p) return `Topology accepted revision ${p.acceptedRevision}: ${p.resources.length} resources, ${p.connectionLines.length} connections`;
  return "Stop requested; exact final state requires simulator confirmation.";
}

export function ActionTimeline({ actions }: { actions: RunAction[] }) {
  if (!actions.length) return null;
  return <ReportSection title={`Action / experiment timeline (${actions.length} shown)`} open={actions.length <= 5}>
    <p className="text-[#8B909C] mb-4">Requests and effects are distinct. Sequence gives accepted request order; simulator application follows it. Simulated time advances only while the run is unpaused.</p>
    <ol className="space-y-5">{actions.map((action) => {
      const outcome = action.outcome;
      return <li key={action.id} className="border-l-2 border-[#2A2E37] pl-4 space-y-1">
        <p className="font-medium">{action.sequence}. {action.kind} · {action.status}</p>
        <p>{parameters(action)}</p>
        <p className="text-xs text-[#8B909C]">Requested <time dateTime={action.requestedAt}>{new Date(action.requestedAt).toLocaleString()}</time></p>
        {action.appliedAt ? <p className="text-xs text-[#C3C7D0]">Applied / started <time dateTime={action.appliedAt}>{new Date(action.appliedAt).toLocaleString()}</time> · simulated second {action.appliedSimulatedSeconds}</p>
          : <p className="text-sm text-[#8B909C]">No simulator application is recorded.</p>}
        {action.completedAt && <p className="text-xs text-[#C3C7D0]">{action.status} <time dateTime={action.completedAt}>{new Date(action.completedAt).toLocaleString()}</time>
          {action.completedSimulatedSeconds !== null && ` · simulated second ${action.completedSimulatedSeconds}`}</p>}
        {outcome?.appliedTarget !== undefined && <p>Target changed from {Math.round(outcome.previousTarget! * 100)}% to {Math.round(outcome.appliedTarget * 100)}%. This records the target, not completion of the load ramp.</p>}
        {outcome?.appliedSpeed !== undefined && <p>Speed changed from {outcome.previousSpeed}× to {outcome.appliedSpeed}×.</p>}
        {outcome?.durationSimulatedSeconds !== undefined && <p>Injected duration: {outcome.durationSimulatedSeconds} simulated seconds.</p>}
        {outcome?.faultEnded && <p>Injected fault ended. Overall health recorded at its end: {outcome.observedOverallHealth}. This does not establish full system recovery.</p>}
        {outcome?.installedSkuId && <p>Target observed online on {outcome.installedSkuId}.</p>}
        {outcome?.previousReplicaCount !== undefined && <p>Pool replicas at application: {outcome.previousReplicaCount}.</p>}
        {outcome?.finalReplicaCount !== undefined && <p>Pool replicas observed when provisioning/draining completed: {outcome.finalReplicaCount}.</p>}
        {outcome?.appliedRevision !== undefined && <p>Simulator-applied topology revision: {outcome.appliedRevision}.</p>}
        {outcome?.capturedAt && <p>Exact terminal snapshot captured at <time dateTime={outcome.capturedAt}>{new Date(outcome.capturedAt).toLocaleString()}</time>.</p>}
        {action.failureReason && <p className="text-[#E5BE78]">{action.failureReason}</p>}
        <p className="text-xs text-[#8B909C] break-all">Action {action.id}</p>
      </li>;
    })}</ol>
  </ReportSection>;
}
