import type { PostFaultObservation } from "@infraforge/contracts/reports";
import { HealthMark } from "@/ui/HealthMark";
import { healthySampleText } from "../observationText";

export function PostFaultFacts({ observation: o, target }: { observation?: PostFaultObservation; target: string }) {
  if (!o || o.status === "not-applicable") return null;
  return <section aria-label="Post-fault observation" className="mt-4 rounded-md border border-line bg-surface p-4">
    <h4 className="text-[15px] font-semibold text-ink">After the fault</h4>
    <p className="mt-1 text-sm text-ink-2">{o.faultEndSecond === null ? `Scheduled fault end: second ${o.scheduledFaultEndSecond}. Its actual end is unverified.` : `Fault ended at second ${o.faultEndSecond}. That tick still measured its effect; later ticks observe without the injected fault.`}</p>
    <p className="mt-1 text-xs text-ink-3">{o.sampleCount} retained post-fault samples · evaluation second {o.evaluationSecond}. These facts describe the InfraForge model.</p>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      <div className="min-w-0 border-l-2 border-line-strong pl-3 text-sm">
        <h5 className="font-semibold text-ink">Target health · {target}</h5>
        <p className="mt-1 text-ink-2">{o.target.firstSample ? `First retained target state: ${o.target.firstSample.health} at second ${o.target.firstSample.second}.` : "No post-fault target measurement retained after a verified fault end."}</p>
        <p className="mt-1 text-ink-2">{healthySampleText(o.target.firstHealthy)}</p>
        {o.target.status === "unhealthy-through-window" && <p className="mt-1 text-ink-2">Every post-fault target sample through evaluation was retained; none recorded Healthy.</p>}
        <p className="mt-2 text-ink-2">At evaluation: <HealthMark size="sm" value={o.target.healthAtEvaluation} /></p>
      </div>
      <div className="min-w-0 border-l-2 border-line-strong pl-3 text-sm">
        <h5 className="font-semibold text-ink">Overall system health</h5>
        <p className="mt-1 text-ink-2">{healthySampleText(o.system.firstHealthy)}</p>
        {o.system.status === "unhealthy-through-window" && <p className="mt-1 text-ink-2">Every post-fault system sample through evaluation was retained; none recorded Healthy.</p>}
        <p className="mt-2 text-ink-2">At evaluation: <HealthMark size="sm" value={o.system.healthAtEvaluation} /></p>
      </div>
    </div>
    {o.pendingPoolsAtEvaluation.map((p) => <p key={p.id} className="mt-2 text-sm text-ink-2">{p.id}: still {p.pending?.action === "up" ? "provisioning" : "draining"} at evaluation, {p.pending?.secondsRemaining} simulated seconds remaining.</p>)}
    <p className="mt-3 text-xs text-ink-3">A Healthy sample does not establish continuous health afterwards, production recovery, availability, request success, latency or data recovery.</p>
  </section>;
}
