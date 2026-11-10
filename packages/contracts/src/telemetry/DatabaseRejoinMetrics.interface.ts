// Saved point evidence for one replacement incarnation; null always means Unknown.
export interface DatabaseRejoinMetrics {
  version: 1;
  memberId: string | null;
  sourceMember: "replica" | null;
  epoch: number | null;
  state: "waiting-for-return" | "catching-up" | "replica" | null;
  targetAvailable: boolean | null;
  writerAvailable: boolean | null;
  snapshotRows: number | null;
  snapshotApplied: boolean | null;
  pendingBatches: number | null;
  committedOperations: number | null;
  replayedOperations: number | null;
  pendingOperations: number | null;
  eligible: boolean | null;
  joinedAtUs: number | null;
}
