import type { LearningLesson } from "@infraforge/contracts/learning";

export const chooseTheConstrainedTier: LearningLesson = {
  id: "choose-the-constrained-tier", contentVersion: 1, trackId: "scaling", moduleId: "first-scaling-choices",
  title: "Choose the constrained tier", kind: "conceptual-exercise", level: "beginner", availability: "available",
  summary: "Reason about shared turns and a shared database before adding app capacity.",
  prerequisites: ["up-or-out", "database-read-and-write"], experiment: null,
  problem: ["Imagine two equal app servers behind a round-robin balancer. Both have spare CPU, but their shared database is fully busy and requests wait there. Keep arrivals and database work per request fixed. Would adding another app server remove that database capacity limit?"],
  explanation: [
    "Round robin gives attached, eligible app servers turns. Adding an app server changes who handles those turns. Enlarging an existing app server is scaling up; adding another is scaling out. Neither choice directly enlarges the shared database.",
    "Under these assumptions, the database must still do the same work for the arriving requests. More app capacity cannot remove its execution limit. A relevant next experiment would change database capacity alone and check whether useful completions improve or a different tier becomes limiting.",
    "Now replace one app server with a much smaller one. Equal turns can exhaust that server while the larger one has spare capacity. Enlarging only the already larger app does not change the smaller app's share under round robin. Where work waits matters more than total machine count."
  ],
  check: {question: "For the original shared-database case, which next experiment addresses the named constraint?", choices: [
    {id: "apps", text: "Add an app server; shared turns automatically add database execution capacity."},
    {id: "database", text: "Keep arrivals and apps fixed; change database capacity and compare useful completions and waiting."},
    {id: "queue", text: "Give the app queue more room; waiting space makes the database execute faster."}
  ], correctChoiceId: "database", explanation: "The hypothetical constraint is database execution. Changing that tier tests the diagnosis; adding app machines or waiting room does not supply database capacity. A different bottleneck may remain afterward."},
  limitations: ["Conceptual only: the busy database and unequal servers are thought experiments, not recorded simulator outcomes.",
    "The exercise assumes independent app requests and unchanged database work. It proves no production scaling factor, automatic scaling behavior, state-sharing strategy or availability guarantee."],
  followUp: "Try The balancer shares turns (balancer-shares-turns), then Route work with unfinished requests in mind (route-around-a-slow-vm). Buy headroom for a burst (leave-room-for-a-burst) tests a separate capacity choice.",
};
