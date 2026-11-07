/** Owned cumulative engine accounting, not a caller latency decomposition. */
export interface DurationEvidence {
  version: 1;
  fromUs: 0;
  throughUs: number;
  timestampComplete: boolean | null;
  resources: Array<{
    id: string;
    kind: "compute" | "async-worker" | "relational";
    busySlotUs: number | null;
    consumedCoreUs: number | null;
    cancelled: number | null;
    /** Only postgresql-keyed-io/1 records these durations. queued is outside slot hold. */
    phasesUs: { queued: number; lock: number; cpu: number; io: number; wait: number; commit: number } | null;
  }>;
  resourcesOmitted: number;
  paths: Array<{
    id: string; source: string; target: string;
    /** Each phase contributes only when its end is reached, even if a later phase fails. */
    reachedPhaseUs: { connectionWaitUs: number; requestTransportUs: number; remoteServiceUs: number; responseTransportUs: number };
    offered: number; completed: number; failed: number; cancelled: number; live: number;
    pendingAcquisitions: number;
    /** The engine does not measure these durations. Never estimate from counts. */
    unfinishedAcquisitionUs: null;
  }>;
  pathsOmitted: number;
}
