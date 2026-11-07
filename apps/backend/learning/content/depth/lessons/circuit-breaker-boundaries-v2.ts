import type { LearningLesson } from "@infraforge/contracts/learning";

export const circuitBreakerBoundariesV2: LearningLesson = {
  id: "circuit-breaker-boundaries", contentVersion: 2, trackId: "depth", moduleId: "failure-controls",
  title: "A circuit breaker stops selected attempts", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Separate a caller's circuit admission from the dependency's return.",
  prerequisites: ["mitigation-tradeoffs"], experiment: null,
  problem: ["A dependency returns while its caller's circuit remains open. Can a low dependency CPU reading tell you whether that caller is testing the path again?"],
  explanation: ["A closed circuit admits calls and counts selected consecutive failures. An open circuit refuses calls during cooldown. Half-open reserves one probe; a successful probe closes that path, while a counted failure opens it again.",
    "Saved reports now show each path's Circuit state (current), generation and epoch, cumulative transitions, refusals and probe outcomes. Match the source, target and path identity before comparing them. State is an instant sample; cumulative transitions do not supply a chronological history.",
    "In Test a circuit again, change the existing Wait before testing again control and inspect Probes succeeded (cumulative) alongside Whole run: Completed and Whole run: Failed. The requirements score callers; a closed final circuit alone does not prove that enough callers completed."],
  check: {question: "Which evidence separates a returning server from a caller that has resumed using it?", choices: [
    {id: "cpu", text: "Only the server's low CPU."}, {id: "path", text: "The caller's path state and probe outcomes, then its caller totals."}],
    correctChoiceId: "path", explanation: "A dependency can return while the caller still refuses that path. Probe admission and caller outcomes describe different populations."},
  limitations: ["This conceptual exercise asserts no simulated result. The linked executable lab supplies its own recorded evidence and requirements.",
    "Missing historical circuit measurements stay Unknown. Totals cover the current segment across generations; they do not establish exact recovery time, continuous health or provider availability.",
    "Health checks may be half-open probes. Circuit refusals include path calls and health checks, so they are not interchangeable with unsuccessful original callers."],
  followUp: "Open Test a circuit again and predict whether a shorter cooldown can test a path that is still failing.",
};
