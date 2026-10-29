import type { CausalEvent } from "../workload/causal";
import { utf8Bytes } from "../time";

// At most 1 MiB of flow JSON per live message or saved capture, independently
// of the executor trace. Ordinary short identities still fit the 1,000-row cap.
export const APPLICATION_FLOW_MAX_BYTES = 1024 * 1024;

/** Byte accounting includes the entire flow object, not just event payloads. */
export function applicationFlowEvidence(rowLimit: number, byteLimit = Infinity) {
  const events: CausalEvent[] = [], totals: Record<string, number> = {};
  let omitted = 0, retainedBytes = 0;
  const envelope = () => ({ profile: "application-flow/1" as const, events: [] as CausalEvent[], totals, retained: events.length, omitted });
  function trim() {
    if (byteLimit === Infinity) return;
    // Totals/counts can grow after the last retained row. Recheck their overhead
    // on omissions too, evicting the newest rows to keep the earliest evidence.
    while (events.length && retainedBytes + utf8Bytes(JSON.stringify(envelope())) > byteLimit) {
      const row = events.pop()!;
      retainedBytes -= utf8Bytes(JSON.stringify(row)) + (events.length ? 1 : 0);
      omitted++;
    }
  }
  return {
    observe(event: CausalEvent) {
      if (event.kind === "remote-after-transport-stop") {
        // Transport reports the actual remote terminal, including cooperative cancellation.
        // Flow call identities end in ["flow", owner, operation, step, branch].
        let id: unknown;
        try { id = JSON.parse(String(event.detail.id)); } catch { return; }
        if (!Array.isArray(id) || id.at(-5) !== "flow" || !id.slice(-4).every(value => typeof value === "string")) return;
        event = { ...event, kind: "flow-late-outcome", resource: id.at(-4), detail: {
          ...event.detail, step: id.at(-2), branch: id.at(-1), outcome: event.detail.detail ?? null, accounting: "remote-after-transport-stop",
        } };
      }
      if (!event.kind.startsWith("flow-")) return;
      totals[event.kind] = (totals[event.kind] ?? 0) + 1;
      if (events.length >= rowLimit) { omitted++; trim(); return; }
      const work = event.work;
      const row: CausalEvent = { atUs: event.atUs, kind: event.kind, resource: event.resource, detail: { ...event.detail }, ...(work ? { work: {
        rootId: work.rootId, callId: work.callId, ...(work.parentCallId === undefined ? {} : { parentCallId: work.parentCallId }),
        attempt: work.attempt, operation: work.operation, offeredAt: work.offeredAt,
      } } : {}) };
      const bytes = byteLimit === Infinity ? 0 : utf8Bytes(JSON.stringify(row));
      retainedBytes += bytes + (events.length ? 1 : 0); // JSON array commas.
      events.push(row);
      trim();
    },
    measure() { return { profile: "application-flow/1" as const, events: events.map(e => ({ ...e, ...(e.work ? { work: { ...e.work } } : {}), detail: { ...e.detail } })), totals: { ...totals }, retained: events.length, omitted }; },
  };
}
