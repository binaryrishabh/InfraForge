import { utf8Bytes } from "../time";

export interface ResetIds { ids: string[]; omitted: number }
export interface PoolResetResult {
  closedConnections: number; failedStreams: number;
  connections: ResetIds; activeOwners: ResetIds; reservedOwners: ResetIds; waitingOwners: ResetIds;
  freshOpens: { started: number; pending: number; opened: number; failed: number; results: Array<{connectionId: string; result: string}>; omitted: number };
}
// Each list has both a row and a byte limit. Long IDs are omitted, never truncated into misleading identities.
export function resetIds(ids: Iterable<string>): ResetIds {
  const result: ResetIds = {ids: [], omitted: 0}; let bytes = 0;
  for (const id of ids) {
    const size = utf8Bytes(JSON.stringify(id));
    if (result.ids.length < 4 && bytes + size <= 256) { result.ids.push(id); bytes += size; } else result.omitted++;
  }
  return result;
}
export function freshOpen(result: PoolResetResult, connectionId: string, outcome: string) {
  result.freshOpens.pending--;
  if (outcome === "opened") result.freshOpens.opened++; else result.freshOpens.failed++;
  const row = {connectionId, result: outcome};
  if (result.freshOpens.results.length < 4 && utf8Bytes(JSON.stringify([...result.freshOpens.results, row])) <= 512) result.freshOpens.results.push(row);
  else result.freshOpens.omitted++;
}
export interface ResetEvidenceRow extends PoolResetResult { actionId: string; pathId: string; atUs: number }
export interface ResetEvidence { rows: ResetEvidenceRow[]; omitted: number; closedConnections: number; failedStreams: number }
export const RESET_EVIDENCE_BYTES = 24 * 1024;
export function resetEvidence() {
  const evidence: ResetEvidence = {rows: [], omitted: 0, closedConnections: 0, failedStreams: 0};
  return {
    add(row: ResetEvidenceRow) {
      evidence.closedConnections += row.closedConnections; evidence.failedStreams += row.failedStreams;
      if (evidence.rows.length < 16) evidence.rows.push(row); else evidence.omitted++;
    },
    measure(): ResetEvidence {
      const rows = [...evidence.rows]; let omitted = evidence.omitted;
      while (utf8Bytes(JSON.stringify({...evidence, rows, omitted})) > RESET_EVIDENCE_BYTES && rows.length) { rows.pop(); omitted++; }
      return {...evidence, rows, omitted};
    },
  };
}
