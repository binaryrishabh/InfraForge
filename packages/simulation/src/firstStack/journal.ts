import { utf8Bytes } from "../model2/time";
import type { CausalEvent } from "../model2/workload/causal";
import { boundedJson, FIRST_STACK_ENVELOPE } from "./bounds";
import type { FirstStackEvidenceEvent } from "@infraforge/contracts/reports";

export function diagnosticJournal(limit: number = FIRST_STACK_ENVELOPE.journalBytes) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > FIRST_STACK_ENVELOPE.journalBytes) throw Error("Invalid diagnostic journal budget");
  const rows: string[] = []; let bytes = 0, observed = 0, omitted = 0;
  const selected: FirstStackEvidenceEvent[] = [], roots = new Set<string>(); let selectionOmitted = 0;
  return {
    record(event: CausalEvent) {
      observed++;
      try {
        const row = boundedJson(event, Math.min(FIRST_STACK_ENVELOPE.frameBytes, limit - bytes));
        const size = utf8Bytes(row) + 1;
        if (bytes + size > limit) { omitted++; return; }
        rows.push(row); bytes += size;
        const root = event.work?.rootId ?? (typeof event.detail.root === "string" ? event.detail.root : undefined);
        if (root && !roots.has(root) && roots.size < 3 && root.startsWith('["root",')) roots.add(root);
        if (selected.length < 128 && (!root || roots.has(root))) selected.push({ ...JSON.parse(row), id: `journal:${rows.length - 1}` });
        else selectionOmitted++;
      } catch { omitted++; }
    },
    measure: () => ({ observed, retained: rows.length, omitted, bytes, complete: omitted === 0 }),
    selection: () => ({ events: selected.map(e => ({ ...e, ...(e.work ? { work: { ...e.work } } : {}), detail: { ...e.detail } })),
      roots: [...roots], omitted: selectionOmitted, journalOmitted: omitted }),
    // One bounded journal per execution; cuts refer to this journal rather than
    // copying its entire prefix into every retained frame.
    content: () => rows.join("\n") + (rows.length ? "\n" : ""),
  };
}
