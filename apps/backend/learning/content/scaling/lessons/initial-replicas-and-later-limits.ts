import type { LearningLesson } from "@infraforge/contracts/learning";

export const initialReplicasAndLaterLimits: LearningLesson = {
  id: "initial-replicas-and-later-limits", contentVersion: 1, trackId: "scaling", moduleId: "scaling-reasoning",
  title: "Separate initial replicas from later limits", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Choose a defensible next experiment when fewer app pools help a short run but later scaling remains untested.",
  prerequisites: ["budget-app-database-sessions", "retrying-a-full-pool", "percentiles-and-populations"], experiment: null,
  problem: ["A short session lab passes after lowering Minimum while Maximum stays unchanged. A teammate concludes that later scale-out is safe and retries will add capacity. Which parts of that claim have actually been tested?"],
  explanation: [
    "Reopen Count pools before adding app instances (budget-app-database-sessions). Compare the captured Minimum and Maximum, current replicas, Connections and Refused session opens. This run stops before the first controller evaluation. Minimum changes initial instances here; the passing report cannot establish a later replica ceiling or a dynamic scale-out result.",
    "Compare p95, Whole run: Completed, Whole run: Failed and Whole run: p95 bucket in both reports. A final Healthy sample and spare sessions do not erase earlier failures. A whole-run tail can move differently from the terminal-second percentile. Decide which population and window the proposed scaling requirement must cover before calling one setting better.",
    "Then revisit Count useful work before adding retries (retrying-a-full-pool). Compare Admitted by backend (attempts), Refused by VM (attempts), Queued at VM (attempts), CPU and caller completions. Queued admissions overlap accepted admissions. Reducing repeated admission work does not add execution capacity; meeting that budget alone cannot certify a healthier pool.",
    "For a later-scaling hypothesis, keep workload, database and retry policy fixed, vary only a supported replica limit, and capture a window containing controller decisions and arriving replicas. Compare actual pool growth, sessions, refusals and caller outcomes. The short session lab cannot run this proposed comparison to completion; treat later session pressure as unproven until suitable evidence exists."
  ],
  check: {question: "What does the short passing session report justify when only Minimum changed and Maximum stayed unchanged?",
    choices: [{id: "ceiling", text: "It establishes the same session headroom after every later scale-out."},
      {id: "initial", text: "It tests the initial-count change in its captured window; later scaling needs a separate controlled comparison."},
      {id: "retries", text: "It establishes that adding retries will raise useful service capacity."}],
    correctChoiceId: "initial", explanation: "The run ends before controller evaluation, so it tests initial pools. An unchanged Maximum is no new ceiling, and neither session headroom nor fewer repeated attempts establishes added service capacity."},
  limitations: ["Conceptual only for the proposed later-scaling comparison: no combined scaling-and-retry experiment or later session result is supplied.",
    "Database pool size is fixed in these labs; Minimum, Maximum and Instance size are designer controls. Lazy session occupancy is measured, not inferred by multiplying pool maxima.",
    "Terminal health and completed-request p95 are point observations. Whole-run latency buckets exclude unsuccessful and unfinished callers; none of these proves continuous health, recovery time or production availability."],
  followUp: "Reopen budget-app-database-sessions and retrying-a-full-pool. State which requirement each passing report settles, which caller population it leaves out, and the evidence needed for a later scale-out claim.",
};
