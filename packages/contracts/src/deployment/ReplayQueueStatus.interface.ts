import type { Deployment } from "./Deployment.interface";

/** Aggregate server replay snapshot; never contains another owner's run identifiers. */
export type ReplayQueueStatus = {
  /** Human-readable formula, ordering, limitations, and reason when the estimate is Unknown. */
  basis: string;
} & ({
  state: "queued";
  /** One-based position among pending replay submissions, excluding active runs. */
  position: number;
  /** Active server runs plus pending replay submissions ordered before this run. */
  runsAhead: number;
  /** Rough seconds through completion: full work ahead / active slots + own cost. Null means Unknown. */
  estimatedWaitSeconds: number | null;
} | {
  state: "replaying";
  position: null;
  runsAhead: 0;
  /** Full own replay cost; active progress is not deducted. Null means Unknown. */
  estimatedWaitSeconds: number | null;
} | {
  /** Target missing from the bounded snapshot, or snapshot cannot establish its order. */
  state: "unknown";
  position: null;
  runsAhead: null;
  estimatedWaitSeconds: null;
});

/** GET /deployments/:deploymentId only. Other deployment responses do not add replay. */
export interface DeploymentReadResponse {
  success: true;
  deployment: Deployment;
  /** Present only for pending/running runs with a stored browser submission. */
  replay?: ReplayQueueStatus;
}
