import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "what-is-a-request", contentVersion: 1, trackId: "foundations", moduleId: "requests-and-routing",
  title: "What is a request?", summary: "A request asks another program to do one piece of work.",
  kind: "reading", level: "beginner", availability: "available", prerequisites: [], experiment: null, check: null,
  problem: ["You tap a button to open a saved note. The note is stored elsewhere. How does the program on your phone ask for it?"],
  explanation: [
    "The program sends a request: a message asking a receiving program to do some work. It might ask for a note, submit a form or save an edit. The message carries enough information to identify the operation and its inputs.",
    "A response carries the receiving program's answer, such as the note's contents or an error. Sending a request does not guarantee a successful response. The request might be refused, or the sender might stop waiting before an answer arrives.",
  ],
  limitations: ["This is a conceptual introduction. It does not send network traffic, measure timing or demonstrate a particular protocol."],
};
