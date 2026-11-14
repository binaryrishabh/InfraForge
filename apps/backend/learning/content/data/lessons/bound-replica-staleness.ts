import type { LearningLesson } from "@infraforge/contracts/learning";

export const boundReplicaStaleness: LearningLesson = {
  id: "bound-replica-staleness", contentVersion: 1, trackId: "data", moduleId: "replica-freshness",
  title: "Bound replica staleness", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Separate fast reads from fresh reads: a replica that applies commits late serves reads that miss them.",
  prerequisites: ["replica-reads-and-writer-work", "move-reads-off-the-writer"],
  problem: ["Reads already use the replica and the writer is relieved, so latency is fine. The replica applies each commit 1000 ms after the writer, and many reads miss recent commits."],
  explanation: [
    "Predict database health, run unchanged and read two measurements together: the requirement's completed-request p95 and the stale reads recorded by read routing. A fast, healthy-looking database can still serve reads that missed recent commits.",
    "Record a diagnosis: stale reads grow with the modeled delay between a writer commit and its application. Select db, open Database HA and change only Modeled replication delay from 1000 to 10. Keep read routing, the replica and app counts fixed. The design review must count one change.",
    "Run again. The replica still carries the reads, so p95 stays low, while stale reads and the oldest missed commit age fall well under the requirement.",
    "As a near miss, restore the starter and route reads to the primary only. Stale reads reach zero, yet the writer carries everything again and p95 fails: capacity and freshness are separate requirements."],
  experiment: {challengeId: "bound-replica-staleness", prediction: "What database health will the starter record at second 6? Only the health choice is scored; explain whether health shows how many reads were stale.",
    evidenceToInspect: ["Stale reads; p95", "CPU; Whole run: Completed; Whole run: Failed; Whole run: In-flight"]},
  limitations: [
    "Results are educational model outputs, not cloud benchmarks. The replication delay is an authored fixed number; a real replica's lag varies with load and is not a dial you simply set.",
    "Stale-read counters are cumulative, include health probes and describe modeled row versions. They establish no application consistency, read-your-writes or availability guarantee. A real application may route a user's reads to the writer after a write or wait for its replica to apply that write to support read-your-writes; neither strategy is modeled here.",
    "A final-second p95 and a fixed-second sample prove no whole-run latency target or continuous behaviour."],
  check: null,
  followUp: "Cite the starter, the improved run and the near miss that reads from the writer. Explain why the near miss fixed freshness but not capacity. Then compare move-reads-off-the-writer, where moving reads was the whole fix.",
};
