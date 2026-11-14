import type { LearningLesson } from "@infraforge/contracts/learning";

export const testACircuitAgainV2: LearningLesson = {
  id: "test-a-circuit-again", contentVersion: 2, trackId: "depth", moduleId: "retry-and-circuit-evidence",
  title: "Test a circuit again", kind: "executable-lab", level: "advanced", availability: "available",
  summary: "Change one cooldown and explain caller outcomes from saved path admission evidence.",
  prerequisites: ["circuit-breaker-boundaries"],
  problem: ["The app returns after its scripted crash, but the load balancer's circuit waits before admitting a test. Keep enough callers completing through second 12."],
  explanation: ["Predict overall health at second 12, then run the starter. Inspect Circuit state (current), Circuit epoch and Probes started (cumulative) for the lb-to-app path. A long cooldown can keep a healthy dependency unused.",
    "Change only Wait before testing again. Keep app capacity, health checks, failure threshold and workload fixed. Compare cumulative caller totals and successful probes; the requirements score caller outcomes rather than a final state alone.",
    "Try a plausible middle cooldown too. A path can finish closed after a successful probe while too many earlier callers remain unsuccessful."],
  experiment: {challengeId: "test-a-circuit-again", prediction: "Predict overall health at the fixed stop and explain whether this caller has tested its returning path.",
    evidenceToInspect: ["Whole run: Completed; Whole run: Failed; Whole run: In-flight", "Circuit state (current); Circuit generation; Circuit epoch", "Probes started (cumulative); Probes succeeded (cumulative); Probes failed (cumulative)", "Refused while open (cumulative calls); Circuit transitions (cumulative edges); Circuit sample time (us)"]},
  check: null,
  limitations: ["Results are educational model outputs, not cloud benchmarks or availability guarantees. A single returning app provides no redundant serving capacity.",
    "Circuit state is sampled at the stop. Transition and probe totals cover the segment, include health probes and do not establish an exact recovery time or continuous health.",
    "Missing or malformed evidence stays Unknown. Circuit diagnostics are not separately scored; the existing requirements score cumulative callers under this exact scenario.",
    "Disabling the circuit also meets the caller requirement in this fixed incident. This lesson keeps it enabled to inspect cooldown and half-open probes; the verdict does not require circuit protection."],
  followUp: "Explain why a closed final circuit can still fail the caller requirement, then compare a cooldown that probes while the app is unavailable.",
};
