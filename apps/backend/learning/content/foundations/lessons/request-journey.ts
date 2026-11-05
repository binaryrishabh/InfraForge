import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "request-journey", contentVersion: 1, trackId: "foundations", moduleId: "compute-and-data",
  title: "Follow a request end to end", summary: "Connect name lookup, routing, application work and data access.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["request-routing", "database-read-and-write"], experiment: null,
  problem: ["A browser opens a saved note through a service with DNS, a load balancer, application servers and one database. Trace a simple successful request."],
  explanation: [
    "The browser first obtains a destination address, possibly from a cached DNS answer. It connects to the service's load balancer and sends its request. The load balancer selects an application server, whose code decides how to handle the requested operation.",
    "For this example, the application needs stored text, so it sends a separate read to the database and waits for the answer. It builds a response from that data and returns it through the load balancer to the browser. The database is answering the application, not the browser directly.",
    "Each step has a different job. A name lookup cannot replace an application, and a load balancer cannot supply missing stored text. Tracing these responsibilities gives you a starting point when a request fails or takes too long.",
  ],
  check: { question: "In this example, which component decides to fetch the note's text from the database?",
    choices: [{ id: "app", text: "The application server handling the note request." }, { id: "dns", text: "The DNS resolver looking up the public address." }],
    correctChoiceId: "app", explanation: "Application code decides what data the operation needs. DNS resolves the name before that application exchange." },
  limitations: ["This is a simplified conceptual path, not a recorded trace. It omits authentication, caches, retries and many possible network intermediaries."],
};
