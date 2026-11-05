import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "client-and-server", contentVersion: 1, trackId: "foundations", moduleId: "requests-and-routing",
  title: "Client and server", summary: "These names describe roles in a conversation between programs.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["what-is-a-request"], experiment: null,
  problem: ["A browser asks a notes service for a note. The service then asks a database for the stored text. Which program is the client?"],
  explanation: [
    "For one exchange, the client initiates a request and the server handles it. In the browser-to-service exchange, the browser is the client and the notes service is the server. These are roles, rather than names for particular kinds of hardware.",
    "The notes service becomes a client when it sends its own request to the database. A program can serve one caller while calling another program. Following these separate exchanges helps explain where work and waiting occur.",
  ],
  check: { question: "When the notes service asks the database for text, what role does the notes service have in that exchange?",
    choices: [{ id: "client", text: "Client: it initiates the database request." }, { id: "server", text: "Server: it must have the same role in every exchange." }],
    correctChoiceId: "client", explanation: "The service handles the browser's request, but initiates the separate database request as a client." },
  limitations: ["This exercise reasons about program roles. It does not run a browser, application service or database."],
};
