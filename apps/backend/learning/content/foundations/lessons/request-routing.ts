import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "request-routing", contentVersion: 1, trackId: "foundations", moduleId: "requests-and-routing",
  title: "Routing through a load balancer", summary: "A load balancer chooses among application destinations.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["dns-resolution"], experiment: null,
  problem: ["Two application servers can answer requests for the same service. A client connects to one public address. How can requests reach either server?"],
  explanation: [
    "A load balancer accepts incoming traffic and routes it to a configured destination. With several application servers behind it, a routing policy can distribute work among them. A health check can help it avoid destinations that fail that check.",
    "The load balancer does not create application capacity by itself. With only one usable server, that server still handles the forwarded work. Even with several servers, a shared database may limit how much work the whole service can complete.",
  ],
  check: { question: "A load balancer has only one usable application server. What can you conclude?",
    choices: [{ id: "one", text: "Forwarded application work still goes to that one server." }, { id: "double", text: "The load balancer automatically doubles application capacity." }],
    correctChoiceId: "one", explanation: "Routing selects existing destinations. Extra usable application capacity has to exist before work can be spread across it." },
  limitations: ["This routing exercise runs no load balancer. Policies, health checks and connection behavior vary; no capacity or failover result is measured here."],
};
