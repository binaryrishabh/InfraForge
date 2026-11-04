/** Cumulative counters since the run segment began; queues count admissions that waited. */
export interface LbAccountingMetrics {
  profile: "lb-accounting/1";
  rejectedAtLb: number;
  queuedAtLb: number;
  acceptedByBackend: number;
  queuedAtVm: number;
  rejectedByVm: number;
  timedOutDownstream: number;
}
