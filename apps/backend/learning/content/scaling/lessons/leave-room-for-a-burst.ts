import type { LearningLesson } from "@infraforge/contracts/learning";

export const leaveRoomForABurst: LearningLesson = {
  id: "leave-room-for-a-burst", contentVersion: 1, trackId: "scaling", moduleId: "serving-under-load",
  title: "Buy headroom for a burst", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Run a fourfold burst and compare two valid capacity choices using recorded CPU and educational cost estimates.",
  prerequisites: [],
  problem: ["A small app handles the baseline 100 reads/second. Traffic rises to 400/second from second 120 until 140; the challenge stops at 125."],
  explanation: ["Predict overall health during the burst, run the starter, and compare completed throughput with failed and unfinished requests.",
    "Select app and change Instance size from Generic to c5.large. Run again. Keep topology, workload and queue settings fixed.",
    "Repeat with c5.xlarge. Both are valid capacity choices for this workload. Compare CPU at second 125 and the CostEstimate stage's educational monthly estimate; discuss the extra headroom you are paying for.",
    "As a near miss, restore Generic and increase only Queued requests under VM execution. A queue holds work; CPU must still execute it."],
  experiment: {challengeId: "leave-room-for-a-burst", prediction: "Will the starter still have enough capacity when the burst is scored at second 125?",
    evidenceToInspect: ["Completed-request p95 in second 125, during the burst", "app CPU and completed requests/second at second 125",
      "Failed requests/second and whole-run in-flight callers", "CostEstimate educational monthly estimate for each design"]},
  limitations: ["Scoring uses completions in second 125, not the whole burst. Whole-run percentile ranges summarize another window.",
    "The CPU profile and burst timing are educational assumptions. No automatic scaling or availability guarantee is tested.",
    "Catalog monthly values are educational estimates, not current provider prices. Generic sizes share a flat estimate; use catalog sizes for this comparison."],
  check: null,
  followUp: "Compare c5.large with c5.xlarge. Which leaves less CPU headroom, what does each estimate cost, and what demand is still untested?",
};
