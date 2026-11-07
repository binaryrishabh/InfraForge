import type { LearningLesson } from "@infraforge/contracts/learning";

export const readBeforeChanging: LearningLesson = {
  id: "read-before-changing", contentVersion: 1, trackId: "diagnosis", moduleId: "report-first",
  title: "Read the report before changing anything", kind: "reading", level: "beginner", availability: "available",
  summary: "Separate caller symptoms, resource clues and missing observations before choosing a fix.",
  prerequisites: ["request-journey", "response-time-and-throughput"], experiment: null,
  problem: ["Callers wait, but the report says a resource is Healthy. Before changing a size, find what was measured, which callers it describes and what you still cannot explain."],
  explanation: [
    "Run unchanged and save the report. Read the workload, requirements and simulated stop time. Offered requests/s and Completed requests/s separate demand from finished work. Whole run: Completed, Whole run: Failed and Whole run: In-flight separate finished, failed and unfinished callers. Deadline exceeded and Abandoned are additional unsuccessful outcomes. p95 covers completed callers in the evaluation second; it excludes failed and unfinished callers.",
    "In Find the first busy resource (where-does-the-time-go) and Read latency alongside CPU (waiting-with-spare-cpu), compare p95 with app and database CPU. Read Application queue wait, Downstream / dependency time and Connection acquisition wait in the completed-request latency breakdown. These are different parts of elapsed time. Dependency time cannot identify an internal cause; spare CPU cannot prove that a worker slot is available.",
    "Later, in Diagnose query admission (diagnose-query-admission), compare Serving queries, Queued queries, Queries waiting for locks, Connections and Refused session opens with database CPU and Health. A queued count is not a waiting duration; open connections are not executing queries. In Fit a request in memory (fit-a-request-in-memory), inspect VM memory: Resident, VM memory: Limit, VM memory: Headroom and VM memory: Refused allocations. A Healthy label alone cannot explain callers' experience.",
    "In Diagnose consumer credit (diagnose-consumer-credit), distinguish producer Whole run: Completed from Queue: acknowledged, Queue: ready and Queue: in flight. Finishing an upload is separate from finishing its background job. These diagnosis labs are later investigations. First write: suspected bound, supporting observation and an observation that would refute it. Keep the workload fixed and test one control. Missing observations stay Unknown; a plausible story is not a diagnosis."
  ],
  check: {question: "Callers wait while database CPU is spare. The report has no query-queue or connection-wait measurements. Which conclusion is supported?",
    choices: [{id: "unknown", text: "The location of the wait is still Unknown; obtain the missing observations before attributing a cause."},
      {id: "cpu", text: "The database needs more CPU because waiting always means CPU saturation."},
      {id: "zero", text: "Connection wait was zero because it was not displayed."}],
    correctChoiceId: "unknown", explanation: "Spare CPU does not distinguish an admission bound, a connection wait or another dependency delay. Missing fields are missing evidence, not zero. A controlled test needs a hypothesis grounded in observations."},
  limitations: ["This reading has no executable experiment and claims no simulated result. It explains how to inspect linked labs, not an automatic diagnosis or a server grade for written reasoning.",
    "Latency breakdowns include completed callers only; failed and unfinished callers are separate. Terminal samples do not reconstruct all earlier waiting or establish a whole-run SLO, continuous health or recovery time.",
    "The model does not measure real process memory, direct worker-slot holding times or per-path pool wait attribution here. Counts alone cannot identify those phases. Missing measurements stay Unknown; educational settings are not provider tuning recommendations."],
  followUp: "Open Find the first busy resource (where-does-the-time-go), then Read latency alongside CPU (waiting-with-spare-cpu). Write a report-based hypothesis before editing either starter. Later, use Diagnose query admission (diagnose-query-admission) to separate queued database work from CPU saturation.",
};
