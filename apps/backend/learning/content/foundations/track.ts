import type { LearningTrack } from "@infraforge/contracts/learning";

export const track: LearningTrack = {
  id: "foundations", title: "Track 1: Foundations", availability: "available",
  summary: "Start from zero: follow a request, name the machines it needs, and reason about pressure.",
  modules: [
    { id: "requests-and-routing", title: "Requests and routing", availability: "available",
      summary: "Meet the client, server, name lookup and load balancer.",
      lessonIds: ["what-is-a-request", "client-and-server", "dns-resolution", "request-routing"] },
    { id: "compute-and-data", title: "Compute and data", availability: "available",
      summary: "Understand where application code runs and how it uses stored data.",
      lessonIds: ["virtual-machines", "database-read-and-write", "request-journey"] },
    { id: "load-and-limits", title: "Load and limits", availability: "available",
      summary: "Separate waiting time from work rate, then look for the first constraint.",
      lessonIds: ["response-time-and-throughput", "more-users-more-pressure", "first-bottleneck"] },
  ],
};
