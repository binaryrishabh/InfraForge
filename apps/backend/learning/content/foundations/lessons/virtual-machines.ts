import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "virtual-machines", contentVersion: 1, trackId: "foundations", moduleId: "compute-and-data",
  title: "Where code runs: virtual machines", summary: "A virtual machine provides a place for an operating system and programs to run.",
  kind: "reading", level: "beginner", availability: "available", prerequisites: ["client-and-server"], experiment: null, check: null,
  problem: ["You have application code that can answer a request. It still needs a running program and computing resources before anyone can use it."],
  explanation: [
    "A virtual machine, or VM, is a virtual computer backed by physical hardware. It has assigned resources such as processor capacity and memory, and usually runs its own operating system. An application process can run inside it and handle incoming requests.",
    "A VM and an application server are different ideas: one is a computing environment and the other is a program's role. Giving a VM more resources can help some workloads. Running more copies can help others, but only if requests can be distributed and shared dependencies can keep up.",
  ],
  limitations: ["This reading does not start a VM or compare instance sizes. It omits virtualization overhead, host contention and deployment setup."],
};
