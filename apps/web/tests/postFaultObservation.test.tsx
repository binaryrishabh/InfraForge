import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ExperimentTrace, PostFaultObservation } from "@infraforge/contracts/reports";
import { PostFaultFacts } from "../src/features/challenges/components/PostFaultFacts";
import { ExperimentTimeline } from "../src/features/challenges/components/ExperimentTimeline";
import { ExperimentDebrief } from "../src/features/challenges/components/ExperimentDebrief";
import { ExperimentCompare } from "../src/features/reports/components/ExperimentCompare";
import { experimentPhase } from "../src/features/challenges/experiment";
import { experimentResult } from "./fixtures";

const plan = { fault: "crash", at: 60, duration: 30, target: "cache", targetType: "Cache" };
const observation: PostFaultObservation = { status: "samples-retained", scheduledFaultEndSecond: 90, faultEndSecond: 90, evaluationSecond: 135,
  sampleCount: 45, target: { status: "healthy-observed", firstSample: { second: 91, health: "healthy", completeSinceFaultEnd: true },
    firstHealthy: { second: 91, health: "healthy", completeSinceFaultEnd: true }, healthAtEvaluation: "healthy" },
  system: { status: "healthy-observed", firstHealthy: { second: 92, health: "healthy", completeSinceFaultEnd: true }, healthAtEvaluation: "saturated" },
  pendingPoolsAtEvaluation: [] };
const trace: ExperimentTrace = { status: "complete", reason: "All samples retained.", expectedStart: 30, expectedEnd: 135, actualFirst: 30, actualLast: 135,
  sampleCount: 106, missingRanges: [], observation, resourceFactsOmitted: 0,
  resourceFacts: [{ id: "cache", highestCpu: { second: 91, value: 5 }, highestMemory: { second: 91, value: 60 }, firstHealthChange: 61, firstHealthyAfterFault: 91, firstHealthyAfterFaultComplete: true }],
  moments: { beforeFault: 59, atFault: 60, firstAfterFault: 61, firstOverallHealthChange: 61, lastActiveFault: 90, firstPostFault: 91,
    firstTargetHealthy: 91, firstOverallHealthy: 92, evaluation: 135 },
  points: Array.from({ length: 106 }, (_, i) => ({ version: 1, simulatedSeconds: i + 30, sampledAt: "2026-10-15T00:00:00.000Z", topologyRevision: 0,
    overallHealth: i + 30 === 91 || i + 30 >= 127 ? "saturated" : i + 30 > 60 && i + 30 <= 90 ? "critical" : "healthy", loadFraction: 1, targetLoadFraction: 1,
    resources: [{ id: "cache", health: i + 30 > 60 && i + 30 <= 90 ? "failed" : "healthy", cpu: 5, memory: 60 }], pools: [] })),
};
const experiment = { ...experimentResult, targetResourceId: "cache", endedSimulatedSeconds: 90 };
const render = (value: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{value}</MemoryRouter>);

test("exact expiry enters observation; evaluation stays later; legacy expiry stays readable", () => {
  expect(experimentPhase(plan, 89, undefined, 135).kind).toBe("waiting");
  for (const second of [90, 91, 134]) expect(experimentPhase(plan, second, undefined, 135).kind).toBe("observing");
  expect(experimentPhase(plan, 135, undefined, 135).kind).toBe("evaluation");
  expect(experimentPhase(plan, 90, undefined).kind).toBe("ended");
  const html = render(<ExperimentTimeline plan={plan} evaluationSeconds={135} seconds={91} phase={experimentPhase(plan, 91, undefined, 135)} />);
  for (const label of ["Baseline", "Fault active", "Observe after fault end", "Judged at", "Fault ended at second 90", "post-fault observation", 'aria-current="step"', 'aria-live="polite"']) expect(html).toContain(label);
  expect(html).not.toMatch(/recovered|recovery badge|<animate/i);
});

test("target and whole-system observations are distinct, including Healthy early but Saturated at evaluation", () => {
  const html = render(<PostFaultFacts observation={observation} target="cache" />);
  for (const text of ["Target health", "Overall system health", "Fault ended at second 90", "second 91", "second 92", "Healthy", "Saturated", "evaluation second 135", "does not establish continuous health"]) expect(html).toContain(text);
  expect(html).not.toMatch(/recovered at|healthy since|recovered by|MTTR:|success animation/i);
});

test("missing evidence qualifies Healthy samples; no samples and a complete unhealthy window remain different", () => {
  const gap = structuredClone(observation); gap.target.firstHealthy!.completeSinceFaultEnd = false;
  expect(render(<PostFaultFacts observation={gap} target="cache" />)).toContain("after missing evidence: second 91");
  const empty = structuredClone(observation); empty.status = "no-samples"; empty.sampleCount = 0;
  empty.target = { status: "unknown", firstSample: null, firstHealthy: null, healthAtEvaluation: null };
  expect(render(<PostFaultFacts observation={empty} target="cache" />)).toContain("No post-fault target measurement retained");
  empty.target.status = "unhealthy-through-window";
  expect(render(<PostFaultFacts observation={empty} target="cache" />)).toContain("none recorded Healthy");
  expect(render(<PostFaultFacts target="cache" />)).toBe("");
});

test("report has later evaluation, factual phase boundaries, present key moments and native inspection controls", () => {
  const html = render(<ExperimentDebrief experiment={experiment} evaluationSeconds={135} trace={trace} />);
  for (const text of ["After the fault", "Ended 90s", "Evaluation 135s", "Post-fault observation (blue)", "First retained sample after fault end", "First retained Healthy target sample", "First retained Healthy overall-system sample", "Inspect a resource", "Inspect any retained second", "<select", "<caption", 'scope="row"']) expect(html).toContain(text);
  expect(html).not.toContain("<animate");
  const early = { ...trace, status: "incomplete" as const, moments: { ...trace.moments!, evaluation: null }, points: trace.points.filter((p) => p.simulatedSeconds <= 95) };
  expect(render(<ExperimentDebrief experiment={experiment} evaluationSeconds={135} trace={early} />)).not.toContain('aria-label="Inspect retained sample at second 135"');
});

test("Compare shows factual samples and evaluation health, without a winner or recovery-speed delta", () => {
  const a = { status: "complete" as const, start: 30, end: 135, count: 106, target: "cache", highestCpu: null, observation };
  const b = { ...a, observation: { ...observation, system: { ...observation.system, healthAtEvaluation: "healthy" } } };
  const html = render(<ExperimentCompare evidence={{ comparable: true, reason: "Same experiment conditions, including observation horizon.", traces: [a, b] }} />);
  for (const text of ["observation horizon", "evaluation: 135", "45 post-fault samples", "target: healthy; overall: saturated", "target: healthy; overall: healthy"]) expect(html).toContain(text);
  expect(html).not.toMatch(/winner|faster|recovered|\d+ seconds better/i);
});
