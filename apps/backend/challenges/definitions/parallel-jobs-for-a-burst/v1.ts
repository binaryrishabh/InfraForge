import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const parallelJobsForABurstV1: ChallengeDefinition = {
  engine: "2", id: "parallel-jobs-for-a-burst", version: 1, title: "Parallel jobs for a burst", difficulty: "advanced",
  summary: "Use the worker's spare core during a burst, then check ready age alongside acknowledged and leased work.",
  concepts: ["Job parallelism", "Ready age", "Leased work", "Burst capacity"],
  story: ["Two uploads arrive each second, rising to six from seconds 120 to 140. Each accepted upload becomes a queue message. A two-core worker spends 250 CPU milliseconds per job but runs only one job at a time.",
    "The worker can lease eight messages, including jobs waiting locally. Ready age covers messages still ready at the broker; it excludes leased jobs. Long retention and visibility already cover this run. There are no poison jobs or injected outages."],
  objective: "At second 140, acknowledge at least 340 messages with at most 12 outstanding and no redeliveries. Any ready message must be at most two seconds old; an observed empty ready population also meets that age requirement.",
  workload: {targetThroughput: 120, throughputUnit: "per-minute", trafficShape: "peak", peakMultiplier: 3, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Two uploads/s, six/s at 120-140. The worker already has two modeled cores and eight prefetch credits; job CPU work is an educational input.",
  evaluationSeconds: 140, evaluationNote: "Counters cover start through second 140. Ready depth and age are one sample at the end of the burst; no whole-run wait or drain-time guarantee follows.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "work", kind: "queue-work", label: "Acknowledge 340; at most 12 outstanding and no redeliveries", resourceId: "queue", minAcknowledged: 340, maxOutstanding: 12, maxRedeliveries: 0},
    {id: "age", kind: "queue-ready-age", label: "At second 140, ready age at most 2 seconds or no ready messages", resourceId: "queue", maxAgeSeconds: 2}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will be recorded at second 140? Does a Healthy worker alone prove short queue waits?"}],
  hints: ["Compare worker CPU with ready depth, ready age and in-flight work. One active job can leave one of the existing two cores unused while the broker backlog grows.",
    "More prefetch credit can move waiting work into leases, making ready depth and age look better without executing more jobs. Check acknowledgements and total outstanding work too.",
    "Select worker. Under Background worker, change only Jobs in parallel from 1 to 2. Keep its size, CPU milliseconds per job, prefetch credit and queue settings fixed."],
  debrief: ["One parallel job limits this two-core worker to roughly one core of CPU execution. Two parallel jobs use the existing spare core during the burst. More acknowledgements and less outstanding work accompany the lower ready depth in the saved comparison.",
    "As a near miss, restore one parallel job and raise only Prefetch credit (leased jobs) from 8 to 64. Ready depth and age can disappear as messages become leased, while acknowledgements remain too low and outstanding work stays high. A ready-age requirement alone cannot establish useful throughput.",
    "An empty ready population has Unknown oldest ready age, not zero. The requirement accepts measured emptiness explicitly; missing observations never pass. Neither ready age nor producer response latency measures leased jobs' total wait. This fixed-second comparison proves no continuous wait target or exact drain time.",
    "This changes parallel jobs within one VM, not worker count or autoscaling. It models no physical persistence, exactly-once business effects, arbitrary slow-message classes or provider performance.", MODEL_NOTE],
  starter: starter([["app", "Virtual Machine", 0, 0],
    ["queue", "Message Queue", 1, 0, {asyncQueue: {enabled: true, visibilityTimeoutSeconds: 60, maxReceives: 3, retentionSeconds: 300, capacityMessages: 1000}}],
    ["worker", "Virtual Machine", 2, 0, {size: "medium", asyncWorker: {enabled: true, concurrency: 1, prefetch: 8, cpuMsPerJob: 250}}],
    ["store", "Object Storage", 1, 2]], [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]]),
};
