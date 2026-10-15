import type { EventKernel } from "../time";
import type { TraceEvent, Trace } from "./contracts";

export function networkTrace(kernel: EventKernel, limit: number) {
  const events: TraceEvent[] = [], totals: Record<string, number> = {}; let omitted = 0;
  const emit: Trace = (kind, id, detail, root, attempt) => {
    totals[kind] = (totals[kind] ?? 0) + 1;
    if (events.length < limit) events.push({ at: kernel.now, kind, id, detail, ...(root === undefined ? {} : { root }), ...(attempt === undefined ? {} : { attempt }) }); else omitted++;
  };
  return { emit, measure: () => ({ events: events.map((e) => ({ ...e })), totals: { ...totals }, retained: events.length, omitted }) };
}
