import { useState } from "react";
import { LB_RATE_BURST_MAX, LB_RATE_MIN_RPS, LB_RATE_MAX_RPS, type Resource } from "@infraforge/domain/resource";
import { Field, Input } from "@/ui/Field";
import { updateResource } from "../../actions";
import { InspectorSection } from "./InspectorSection";
import { parseBurst, parseSustainedRate, type LimitInput } from "./lbRateLimitInput";

// Keeps what the learner is typing until it is a valid saved value; undo/redo still replaces it from the saved policy.
function useDraft(saved: number | undefined) {
  const [text, setText] = useState(saved === undefined ? "" : String(saved));
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    // The saved value changed (our own valid edit, or undo/redo): keep matching text, otherwise show the saved value.
    setSeen(saved);
    if (Number(text) !== saved || text.trim() === "") setText(saved === undefined ? "" : String(saved));
  }
  return [text, setText] as const;
}

export function LbRateLimitSection({ resource, disabled }: { resource: Resource; disabled: boolean }) {
  const p = resource.lbRateLimit;
  const [burstText, setBurstText] = useDraft(p?.burstRequests), [rateText, setRateText] = useDraft(p?.sustainedRequestsPerSecond);
  const edit = (field: "burstRequests" | "sustainedRequestsPerSecond", text: string, parse: (text: string) => LimitInput, setText: (text: string) => void) => {
    setText(text);
    const parsed = parse(text);
    if (p && parsed.ok) updateResource(resource.id, { lbRateLimit: { ...p, [field]: parsed.value } });
  };
  const burst = parseBurst(burstText), rate = parseSustainedRate(rateText);
  return <InspectorSection title="Load balancer rate limit" hint="Tokens start full, refill one request at a time, and are spent before backend work. Failure and cancellation never refund tokens. Use the checkbox to turn the limit off; refill timing rounds to whole microseconds.">
    <div className="flex flex-col gap-4">
      <label className="text-sm"><input type="checkbox" checked={!!p} disabled={disabled} onChange={e => updateResource(resource.id, { lbRateLimit: e.target.checked ? { version: 1, burstRequests: 100, sustainedRequestsPerSecond: 100 } : undefined })} /> Limit incoming requests</label>
      <Field label="Burst requests" error={p && !burst.ok ? burst.message : null}>{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={LB_RATE_BURST_MAX} step={1} disabled={disabled || !p}
        value={p ? burstText : ""} placeholder="No limit" onChange={e => edit("burstRequests", e.target.value, parseBurst, setBurstText)} />}</Field>
      <Field label="Sustained requests per second" error={p && !rate.ok ? rate.message : null}>{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={LB_RATE_MIN_RPS} max={LB_RATE_MAX_RPS} step="any" disabled={disabled || !p}
        value={p ? rateText : ""} placeholder="No limit" onChange={e => edit("sustainedRequestsPerSecond", e.target.value, parseSustainedRate, setRateText)} />}</Field>
    </div>
  </InspectorSection>;
}
