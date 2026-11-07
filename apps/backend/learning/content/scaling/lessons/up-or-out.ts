import type { LearningLesson } from "@infraforge/contracts/learning";

export const upOrOut: LearningLesson = {
  id: "up-or-out", contentVersion: 1, trackId: "scaling", moduleId: "first-scaling-choices",
  title: "A bigger machine or more machines", kind: "reading", level: "beginner", availability: "available",
  summary: "Distinguish scaling up from scaling out, then follow the work to the tier that limits it.",
  prerequisites: ["virtual-machines", "request-routing"], experiment: null,
  problem: ["An app slows down as more people use it. Would a bigger app machine and another app machine change the same part of the system?"],
  explanation: [
    "Scaling up gives an existing machine more capacity, such as CPU or memory. Scaling out adds machines that can share work. More capacity helps only when the constrained work can use it; a larger waiting queue supplies waiting room instead.",
    "To share app work, requests must reach the added machines. A load balancer chooses an eligible app server for each request. Round robin shares turns between attached servers. Equal turns need not mean equal effort or equal waiting when servers or requests differ.",
    "Follow a request past the app. If every app still asks the same busy database to do the same work, adding app machines does not add database execution capacity. It may send more work toward that database. Find the limiting tier before choosing what to enlarge.",
    "In later labs, keep traffic fixed and change one capacity or routing choice at a time. Ask whether useful completions changed, where work still waits, and which interval each measurement describes. A machine count alone cannot answer those questions."
  ],
  check: null,
  limitations: ["Conceptual only: this reading runs no experiment and supplies no measured speedup, price or availability guarantee.",
    "Sharing app work assumes the servers can handle the requests independently. Application state, database sharding and automatic scaling are not taught or verified here."],
  followUp: "Next try Choose the constrained tier (choose-the-constrained-tier). Then open Compare two ways to add capacity (one-bigger-or-two-smaller) to compare existing capacity designs in a lab.",
};
