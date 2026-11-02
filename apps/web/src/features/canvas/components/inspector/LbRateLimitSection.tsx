import { LB_RATE_BURST_MAX, LB_RATE_MIN_RPS, LB_RATE_MAX_RPS, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";

export function LbRateLimitSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const p = resource.lbRateLimit;
  const edit = (field: "burstRequests" | "sustainedRequestsPerSecond", value: string) => {
    if (!p) return;
    updateResource(resource.id, { lbRateLimit: value === "" ? undefined : { ...p, [field]: Number(value) } });
  };
  return <InspectorSection title="Load balancer rate limit" hint="Tokens start full, refill one request at a time, and are spent before backend work. Failure and cancellation never refund tokens. Clearing a value disables the limit; refill timing rounds to whole microseconds.">
    <div className="flex flex-col gap-4">
      <label className="text-sm"><input type="checkbox" checked={!!p} disabled={disabled} onChange={e => updateResource(resource.id, { lbRateLimit: e.target.checked ? { version: 1, burstRequests: 100, sustainedRequestsPerSecond: 100 } : undefined })} /> Limit incoming requests</label>
      <Field label="Burst requests">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={LB_RATE_BURST_MAX} step={1} disabled={disabled || !p}
        value={p?.burstRequests ?? ""} placeholder="No limit" onChange={e => edit("burstRequests", e.target.value)} />}</Field>
      <Field label="Sustained requests per second">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={LB_RATE_MIN_RPS} max={LB_RATE_MAX_RPS} step="any" disabled={disabled || !p}
        value={p?.sustainedRequestsPerSecond ?? ""} placeholder="No limit" onChange={e => edit("sustainedRequestsPerSecond", e.target.value)} />}</Field>
    </div>
  </InspectorSection>;
}
