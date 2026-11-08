import type { LearningLesson } from "@infraforge/contracts/learning";

export const whatIsMonitoring: LearningLesson = {
  id: "what-is-monitoring", contentVersion: 1, trackId: "observability", moduleId: "monitoring-ownership",
  title: "What is monitoring?", kind: "reading", level: "beginner", availability: "available",
  summary: "Separate a system from its measurements, and a missing reading from a measured zero.",
  prerequisites: [], experiment: null, check: null,
  problem: ["A thermometer can stop sending readings while the room stays warm. When a system's monitoring goes quiet, what do you know about the system itself?"],
  explanation: [
    "Monitoring means taking measurements to learn how a system is behaving from outside it. A measurement is a recorded observation of a named thing at a time. It is not the thing itself: an old temperature reading does not tell you the room's temperature now. You need no earlier lesson to begin here.",
    "In this model, a monitoring agent is a collector: it asks a target, the resource being observed, for measurements. A sample holds a collected measurement. The collector can hold samples in a buffer before sending them to a backend, the receiving program. Collecting a sample and delivering it are separate steps; either can have trouble while the observed resource keeps working.",
    "In a saved report with monitoring, Monitoring: Generated samples counts successful collections. Monitoring: Buffered samples describes samples held at that snapshot. Monitoring backend: Received samples counts accepted arrivals, including repeat arrivals of the same sample. Counters accumulate from run start through the snapshot; buffer counts describe current occupancy. Keep the resource, target and snapshot together when reading them.",
    "Monitoring: Collection age describes time since the latest successful collection. Monitoring backend: Measurement age describes time since the newest measurement that arrived there. Ages use simulated microseconds. Unknown means the saved reading is missing; zero means a recorded value of zero. Neither a recent reading nor a fresh collection proves application health or a complete history."
  ],
  limitations: ["This reading explains report meanings; it runs no experiment and claims no measured learner result.",
    "The model collects resource metrics through an agent. It does not represent every kind of monitoring, target instrumentation CPU or physical telemetry persistence.",
    "A saved snapshot cannot reconstruct every earlier measurement or prove continuous health. Missing saved readings remain Unknown; backend age has no authored health threshold."],
  followUp: "Next, try Read a missing measurement (missing-readings-are-unknown). Explain why a silent thermometer cannot establish the room's temperature.",
};
