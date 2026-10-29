import type { ApplicationFlowEvidence } from "@infraforge/contracts/telemetry";

export function ApplicationFlowLog({ evidence }: { evidence: ApplicationFlowEvidence }) {
  return <details className="border-b border-line py-2">
    <summary>Application Flow · {evidence.retained} retained · {evidence.omitted} omitted</summary>
    {evidence.omitted > 0 && <p>Flow evidence is truncated. Totals include omitted rows.</p>}
    <p>{Object.entries(evidence.totals).map(([kind, count]) => `${kind}: ${count}`).join(" · ")}</p>
    {evidence.events.map((event, index) => <p key={index} className="break-words py-1">
      {event.atUs} µs · {event.resource} · {event.kind} · {event.work?.rootId} · {Object.entries(event.detail).map(([key, value]) => `${key}: ${value}`).join(" · ")}
    </p>)}
  </details>;
}
