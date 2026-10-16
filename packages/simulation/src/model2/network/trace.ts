import type { EventKernel } from "../time";
import type { TraceEvent, Trace } from "./contracts";
import type { CausalObserver } from "../workload/causal";

export function networkTrace(kernel: EventKernel, limit: number, causal?: CausalObserver) {
  const events: TraceEvent[] = [], totals: Record<string, number> = {}; let omitted = 0;
  const emit: Trace = (kind, id, detail, root, attempt) => {
    if (causal && ["lb-selected", "lb-failure", "health-observation", "health-probe", "attempt-terminal", "request-delivered", "transport-terminal", "remote-after-transport-stop", "network-intervention", "backend-draining"].includes(kind)) causal({ atUs: kernel.now, kind, resource: "network", detail: { id, detail, ...(root === undefined ? {} : { root }), ...(attempt === undefined ? {} : { attempt }) } });
    totals[kind] = (totals[kind] ?? 0) + 1;
    if (events.length < limit) events.push({ at: kernel.now, kind, id, detail, ...(root === undefined ? {} : { root }), ...(attempt === undefined ? {} : { attempt }) }); else omitted++;
  };
  return { emit, measure: () => ({ events: events.map((e) => ({ ...e })), totals: { ...totals }, retained: events.length, omitted }) };
}
