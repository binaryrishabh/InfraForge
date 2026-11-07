import type { LearningLesson } from "@infraforge/contracts/learning";

export const locateTheMissingWaitV2: LearningLesson = {
  id: "locate-the-missing-wait", contentVersion: 2, trackId: "diagnosis", moduleId: "async-and-dependencies",
  title: "Locate the missing wait", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Separate slow dependency calls, held app slots and occupied connections before choosing a capacity change.",
  prerequisites: ["queue-ownership-and-acknowledgement", "waiting-with-spare-cpu", "trace-a-saturation-cascade"],
  problem: ["Consider an app with spare CPU and waiting callers. A downstream service also has spare CPU, but calls to it are slow. A teammate proposes more app CPU; another proposes a larger connection pool. Which missing observation would distinguish held app slots from waiting for a pooled connection?"],
  explanation: ["An app worker can remain occupied across a synchronous dependency call while doing no CPU work. A slow reply can therefore hold admission slots even when both processors are quiet. Adding CPU does not establish that the unchanged slot bound or dependency latency improved.",
    "Connection acquisition and holding an acquired connection are different phases. A connection count does not measure how long connections were busy or which calls held them. The saved Duration: Acquired pool wait now names each transport path and its source and target. It sums waits only for acquisitions that succeeded, including connection establishment; it cannot account for failed, cancelled or still-pending acquisitions.",
    "Ask for app slot occupancy and waiting phases over the incident window, plus per-path pool occupancy, acquisition wait and dependency-call duration. These are the distinguishing observations, not an excuse to infer a zero from an absent field. Duration: Slot hold now records cumulative occupied slot time for each engine owner, and Duration: CPU consumption records consumed core time separately. Ordinary app and worker phase durations remain Unknown. These path-specific totals do not assign slot hold to a dependency or reconstruct the incident window, so this diagnosis remains conceptual.",
    "Write a falsifiable hypothesis before a capacity change. A useful controlled comparison preserves offered work and the dependency behavior while changing the suspected bound. State which population should improve and what extra downstream pressure could result. A larger app queue can merely postpone refusal; a larger pool can merely move waiting to the dependency."],
  limitations: ["This exercise has no executable experiment and asserts no simulated outcome. Spare CPU and a slow reply alone cannot prove slot exhaustion, a full transport pool, a particular downstream cause or an effective fix.",
    "Finite-IO database phase durations exist only in an internal profile, not in this canvas exercise. Existing worker-slot and database-pressure labs test their stated mechanisms. Reusing their results would not prove path-specific dependency holding here. A process outage and a slow dependency are distinct hypotheses; neither establishes message age or recovery time."],
  experiment: null,
  check: {question: "What is needed before attributing low-CPU waiting specifically to held app slots?",
    choices: [{id: "phases", text: "Slot occupancy and waiting phases, correlated with dependency and per-path pool measurements"},
      {id: "cpu", text: "A lower app CPU percentage alone"}, {id: "connections", text: "An open-connection count alone"}],
    correctChoiceId: "phases", explanation: "CPU and open connections describe different populations. Holding a worker slot across a dependency wait needs phase and occupancy observations; absent attribution remains Unknown."},
  followUp: "Write separate slot-holding and connection-acquisition hypotheses. Name an observation that could refute each, a plausible wrong fix and the saved-report gap that prevents claiming either cause.",
};
