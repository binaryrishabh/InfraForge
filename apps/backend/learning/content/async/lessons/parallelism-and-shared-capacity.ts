import type { LearningLesson } from "@infraforge/contracts/learning";

export const parallelismAndSharedCapacity: LearningLesson = {
  id: "parallelism-and-shared-capacity", contentVersion: 1, trackId: "async", moduleId: "async-reasoning",
  title: "Parallel jobs still share a capacity budget", kind: "reading", level: "advanced", availability: "available",
  summary: "Separate execution slots, leased jobs and downstream capacity before adding parallelism.",
  prerequisites: ["parallel-jobs-for-a-burst", "keep-up-with-the-queue"], experiment: null,
  problem: ["A worker can lease more jobs than it can execute. If ready age improves, which constraint actually changed?"],
  explanation: [
    "Revisit Use the worker's spare core (parallel-jobs-for-a-burst). Compare CPU, Acknowledged messages, Ready messages and Queue: in flight across its parallel-jobs and prefetch changes. Prefetch moves ownership into leases; Jobs in parallel allows processing to overlap. An empty ready population alone cannot distinguish them.",
    "In Follow the work after publishing (keep-up-with-the-queue), compare Queue: acknowledged and Queue: ready while producer completions stay separate. Execution slots permit jobs to compete for CPU and their result destination. Extra slots help only while the resource doing the work has room. Once another shared resource becomes limiting, more overlap can add waiting instead of useful completion.",
    "For a thought experiment, suppose each completed job must write a result and the result destination is already at capacity. Increasing processing overlap cannot raise that destination's service capacity. Compare acknowledgements and all outstanding work, then seek destination measurements before choosing another change.",
    "The burst lab supports reasoning about spare worker CPU and leased versus ready work. It does not demonstrate a newly saturated destination. Keep the proposed next bottleneck a hypothesis; keep producer completions separate from background completion."
  ],
  check: {question: "In the thought experiment, what follows from more execution slots when result storage is already at capacity?",
    choices: [{id: "capacity", text: "Storage service capacity rises automatically."}, {id: "waiting", text: "More jobs can wait for the same storage capacity."}, {id: "ready", text: "An empty ready queue proves every result is written."}],
    correctChoiceId: "waiting", explanation: "Slots allow overlap; they do not enlarge a shared destination. Leased work can wait outside the ready population."},
  limitations: ["Conceptual extension: downstream saturation is not demonstrated by this lab. No worker-count control, automatic worker scaling or arbitrary slow-message class is exercised.",
    "Saved ready age is one terminal sample and excludes leased jobs. CPU and acknowledgement counts do not prove whole-run wait, exact drain time or physical durability."],
  followUp: "Reopen parallel-jobs-for-a-burst and explain both changes using all outstanding work. Then open duplicate-effects-and-ownership to separate completion from acknowledgement.",
};
