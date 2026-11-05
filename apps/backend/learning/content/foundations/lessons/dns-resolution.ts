import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "dns-resolution", contentVersion: 1, trackId: "foundations", moduleId: "requests-and-routing",
  title: "DNS: finding an address", summary: "Name resolution helps a client find where to connect.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["client-and-server"], experiment: null,
  problem: ["You know the name notes.example, but a network connection needs an address. What bridges the name and the destination?"],
  explanation: [
    "DNS is a naming system. A client can ask a resolver to look up records for a name. Address records can supply an IP address that the client uses to connect to the service. A resolver may already have a cached answer, or may need to query other DNS servers.",
    "Looking up an address is separate from asking the application for a note. DNS does not usually carry that application request to the server. The client uses the lookup result to make its own connection; that destination might be a load balancer rather than an application server.",
  ],
  check: { question: "After a client learns an address through DNS, who normally sends the application request to the destination?",
    choices: [{ id: "client", text: "The client, using a connection to the destination." }, { id: "dns", text: "DNS forwards every application request and response." }],
    correctChoiceId: "client", explanation: "Name lookup provides information for a connection. It is not the application's forwarding path." },
  limitations: ["This is a conceptual lookup. It does not exercise DNS caching, record expiry, encrypted connections or failures in the network."],
};
