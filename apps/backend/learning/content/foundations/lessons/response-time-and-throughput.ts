import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "response-time-and-throughput", contentVersion: 1, trackId: "foundations", moduleId: "load-and-limits",
  title: "Response time and throughput", summary: "How long one request takes differs from how many requests finish per second.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["request-journey"], experiment: null,
  problem: ["Two services can finish the same number of requests in a second while individual callers experience different waits. What are the two measurements describing?"],
  explanation: [
    "Response time describes elapsed time for a request between stated start and end points. From a client's view, it can include network travel, queues and processing. A number without those measurement boundaries is hard to interpret.",
    "Throughput describes a rate of completed work, such as responses completed per second. It is different from the rate of incoming requests. A service can receive work faster than it completes it, leaving requests waiting or failing.",
    "An average response time hides variation among requests. A percentile describes a point in a measured distribution: p95 is a value at or below which about 95% of the sampled response times fall. Always ask which requests and time window were included.",
  ],
  check: { question: "Which measurement describes throughput?",
    choices: [{ id: "rate", text: "The number of responses completed per second." }, { id: "time", text: "The elapsed time for one request and its response." }],
    correctChoiceId: "rate", explanation: "Throughput is completed work per unit of time. The other choice describes a request's response time." },
  limitations: ["These definitions do not measure a service. A percentile from one sample or terminal second cannot establish performance over a whole run."],
};
