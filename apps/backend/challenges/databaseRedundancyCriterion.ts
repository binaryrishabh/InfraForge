import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import type { Topology } from "./criteria";
import { DatabaseReplicationMetricsSchema } from "../reports/databaseSchema";

type Criterion = Extract<ChallengeCriterion, {kind: "database-redundancy"}>;
const sources = ["runInputs.resources.databaseReplication", "terminalSnapshot.simulatedSeconds", "terminalSnapshot.metrics.databaseReplication"];
// A terminal readiness requirement, never a whole-run availability or loss guarantee.
export function evaluateDatabaseRedundancy(c: Criterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number) {
  const unknown = (detail: string) => ({met: undefined, detail, sources});
  if (!input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("Current database evidence at the exact evaluation second is required.");
  const captured = input.resources.filter(r => r.id === c.resourceId && r.type === "Database");
  if (captured.length !== 1 || !captured[0]!.databaseReplication?.enabled) return unknown("The named enabled database replica must exist in the captured design.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId), parsed = DatabaseReplicationMetricsSchema.safeParse(rows[0]?.databaseReplication);
  if (rows.length !== 1 || !parsed.success) return unknown("Complete, valid database replication evidence was not recorded.");
  const m = parsed.data;
  if ([m.currentWriter, m.primaryRole, m.replicaRole, m.primaryProcessState, m.replicaProcessState, m.replicaState,
    m.writerEpoch, m.primaryEpoch, m.replicaEpoch, m.promotionCount, m.promotionAtUs, m.lostOperations].some(v => v == null) ||
    m.writerEpoch! < 1 || m.primaryEpoch! < 1 || m.replicaEpoch! < 1 || m.promotionAtUs! > second * 1_000_000) return unknown("Writer roles, epochs, process states, promotion and recorded loss must be known at evaluation.");
  const writers = Number(m.primaryRole === "writer") + Number(m.replicaRole === "writer");
  const writer = m.currentWriter === "replica" && m.replicaRole === "writer" && m.replicaProcessState === "writer" &&
    m.replicaState === "promoted" && m.promotionCount === 1 && m.writerEpoch === m.replicaEpoch && writers === 1;
  const prefix = `At second ${second}: current writer ${m.currentWriter}; original-primary role ${m.primaryRole}; ${writers} writer roles; recorded promotion loss ${m.lostOperations}.`;
  if (!captured[0]!.databaseReplication!.rejoin) {
    // Omission is known saved intent, not a fabricated zero catch-up counter.
    if (m.rejoin !== undefined || m.primaryRole !== "fenced" || m.primaryProcessState !== "fenced" || !writer) return unknown("Unmarked recovery evidence does not establish the expected fenced return and promoted writer.");
    return {met: false, detail: `${prefix} No catch-up policy was saved. Returned member remains fenced; catch-up backlog and eligibility are Unknown. Redundancy is not restored.`, sources};
  }
  const r = m.rejoin;
  if (!r || [r.memberId, r.sourceMember, r.epoch, r.state, r.targetAvailable, r.writerAvailable, r.snapshotRows, r.snapshotApplied,
    r.pendingBatches, r.committedOperations, r.replayedOperations, r.pendingOperations, r.eligible].some(v => v == null)) return unknown("Catch-up measurements are missing; Unknown is never zero or false.");
  if (r.state === "replica" && r.joinedAtUs === null) return unknown("A joined replica needs its recorded first rejoin time.");
  if (r.memberId !== JSON.stringify([c.resourceId, "original-primary", m.writerEpoch]) || r.epoch !== m.writerEpoch ||
    !Number.isSafeInteger(r.replayedOperations! + r.pendingOperations!) || r.committedOperations !== r.replayedOperations! + r.pendingOperations! ||
    r.committedOperations !== m.replicaCommittedWrites || r.pendingBatches !== r.pendingOperations! + Number(!r.snapshotApplied) ||
    r.joinedAtUs !== null && (r.joinedAtUs < m.promotionAtUs! || r.joinedAtUs > second * 1_000_000) ||
    r.eligible !== (r.targetAvailable && r.writerAvailable && r.snapshotApplied && r.pendingBatches === 0)) return unknown("Catch-up identity, accounting, eligibility or time evidence is inconsistent.");
  const met = writer && m.primaryRole === "replica" && m.primaryProcessState === "replica" && m.primaryEpoch === m.writerEpoch &&
    r.state === "replica" && r.eligible === true && r.snapshotApplied === true && r.pendingOperations === 0 && r.pendingBatches === 0 && r.joinedAtUs !== null;
  return {met, detail: `${prefix} Returned member ${r.state}; snapshot applied ${r.snapshotApplied}; pending catch-up ${r.pendingOperations} operations / ${r.pendingBatches} batches; eligible ${r.eligible}. ${met ? "Redundancy restored at this sample." : "Redundancy requirement not met at this sample."} Caught up now does not mean nothing was lost earlier.`, sources};
}
