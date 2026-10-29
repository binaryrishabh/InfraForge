import { causeFields } from "../workload/cause";
import { utf8Bytes } from "../time";
import type { EventKernel } from "../time";
import type { TraceEvent, Trace } from "./contracts";
import type { CausalObserver } from "../workload/causal";

export function networkTrace(kernel: EventKernel, limit: number, causal?: CausalObserver, byteLimit = Infinity) {
  const events: TraceEvent[] = [], totals: Record<string, number> = {}; let omitted = 0, retainedBytes = 0;
  const emit: Trace = (kind, id, detail, root, attempt, poolEvidence, cause) => {
    if (causal && ((poolEvidence && ["breaker-transition", "breaker-rejected", "breaker-probe-start", "breaker-probe-result", "retry-scheduled", "retry-suppressed", "connection-acquired", "connection-closed", "connection-released", "db-session-open", "db-session-refused", "db-session-closed"].includes(kind)) || ["lb-selected", "lb-failure", "health-observation", "health-probe", "attempt-terminal", "request-delivered", "transport-terminal", "remote-after-transport-stop", "network-intervention", "backend-draining"].includes(kind))) causal({ atUs: kernel.now, kind, resource: "network", detail: { id, detail, ...causeFields(cause), ...(root === undefined ? {} : { root }), ...(attempt === undefined ? {} : { attempt }) } });
    totals[kind] = (totals[kind] ?? 0) + 1;
    // Count every transition, but do not allocate rows that cannot be retained.
    if (events.length >= limit) { omitted++; return; }
    const event = { at: kernel.now, kind, id, detail, ...causeFields(cause), ...(root === undefined ? {} : { root }), ...(attempt === undefined ? {} : { attempt }) };
    const bytes = byteLimit === Infinity ? 0 : utf8Bytes(JSON.stringify(event));
    if (retainedBytes + bytes <= byteLimit) { events.push(event); retainedBytes += bytes;
      if (causal && ["connection-acquire-failed", "security-denied", "security-admitted", "security-policy-updated"].includes(kind)) causal({ atUs: kernel.now, kind, resource: "network", detail: { id, detail, ...(root === undefined ? {} : { root }), ...(attempt === undefined ? {} : { attempt }) } });
    } else omitted++;
  };
  return { emit, measure: () => ({ events: events.map((e) => ({ ...e })), totals: { ...totals }, retained: events.length, omitted }) };
}
