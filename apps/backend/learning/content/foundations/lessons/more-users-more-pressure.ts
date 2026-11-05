import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "more-users-more-pressure", contentVersion: 1, trackId: "foundations", moduleId: "load-and-limits",
  title: "Why more users can add pressure", summary: "Active users create work; arrival rate and work per request determine the demand.",
  kind: "reading", level: "beginner", availability: "available", prerequisites: ["response-time-and-throughput"], experiment: null, check: null,
  problem: ["A notes service is comfortable during quiet hours. At a busy moment, many people open and save notes together. What changes for the system?"],
  explanation: [
    "More active users can produce more requests in the same interval. Each request consumes some combination of processor time, memory, network capacity and dependency work. Registered users alone do not determine demand: how often people act and what their requests do both matter.",
    "When requests arrive faster than a component can finish its work, pending work can build up. Requests may wait longer, reach a timeout or be refused. This depends on queue limits and service behavior; more arrivals do not guarantee more completed work.",
    "Increasing application capacity can move pressure to a shared dependency. Several application servers may all call the same database. Reason about the full request path before assuming that adding one kind of machine will address every limit.",
  ],
  limitations: ["This is qualitative reasoning. No traffic is generated and no user count, queue length or capacity threshold is predicted."],
};
