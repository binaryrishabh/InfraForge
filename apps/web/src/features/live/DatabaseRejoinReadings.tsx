import type { DatabaseReplicationMetrics } from "@infraforge/contracts/telemetry";

const fields = [
  ["memberId", "Replacement replica identity"], ["epoch", "Replacement replica epoch"],
  ["state", "Old primary catch-up state"], ["targetAvailable", "Returning process available"],
  ["writerAvailable", "Catch-up source available"], ["snapshotRows", "Promotion snapshot rows"],
  ["snapshotApplied", "Promotion snapshot applied"], ["pendingBatches", "Pending catch-up batches (including snapshot)"],
  ["committedOperations", "New writer operations queued for catch-up"], ["replayedOperations", "Replayed new writer operations"],
  ["pendingOperations", "Pending catch-up operations"], ["eligible", "Replica eligible at this sample"], ["joinedAtUs", "First rejoin time (simulated us)"],
] as const;
export function DatabaseRejoinReadings({ values }: { values: DatabaseReplicationMetrics["rejoin"] }) {
  if (values === undefined) return null;
  return <div>
    <p>Old-primary rejoin: snapshot and ordered replay on one replacement replica. Educational delay; no physical timing, database protocol or quorum guarantee. Recorded promotion loss remains separate.</p>
    <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{values?.[key] == null ? "Unknown" : String(values[key])}</dd></div>)}</dl>
  </div>;
}
