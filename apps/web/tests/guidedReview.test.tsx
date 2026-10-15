import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { RunReport } from "@infraforge/contracts/reports";
import type { DesignChangeReview } from "@infraforge/contracts/reports";
import { GuidedReview } from "../src/features/challenges/components/GuidedReview";
import { measurementId } from "../src/features/reports/resourceFocus";
import { ImprovementReview } from "../src/features/challenges/components/ImprovementReview";
import { readLearningContext, type ChallengeImprovementContext } from "../src/features/challenges/learningContext";
import { ReportView } from "../src/features/reports/components/ReportView";
import { evaluation } from "./fixtures";

const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const context: ChallengeImprovementContext = { ownerId: "alice", designId: "design", sourceRunId: "source", challengeId: "cache-matters", version: 1, hypothesis: "My own short hypothesis" };
const report: RunReport = { version: 1, run: { id: "run", infrastructureId: "design", infrastructureName: "Attempt", status: "torn-down", createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", resourceCount: 1,
  workload: null, workloadSource: "captured", chaosEventCount: 0, topologyRevision: 0, hasReportData: true }, originalSeed: "seed", legacySeed: null, stages: [], timeline: [], chaosEvents: [], topology: { original: null, accepted: null, changes: null }, checkpoint: null, terminal: null, actions: [],
  provenance: { inputVersion: 2, simulationModelVersion: "1", catalogSnapshot: "2026-08" }, observed: [], interpreted: [], unknown: ["Unknown"], inspectNext: [], challenge: evaluation("not-met", ["different", "unknown"]),
  guidedReview: { canImprove: true, unavailableReason: null, cues: [
    { id: "requirement", kind: "requirement", title: "Database must be healthy", statement: "Database was saturated at evaluation.", sources: ["terminalSnapshot.metrics"], limit: "One snapshot is not a cause." },
    { id: "trace", kind: "measurement", title: "First retained post-fault sample", statement: "app-2 CPU was 93.3% at second 61.", sources: ["RunEvidenceSample[61].resources[app-2]"], simulatedSecond: 61, resourceId: "app-2", limit: "Recovery is unknown." },
    { id: "unknown", kind: "unknown", title: "Limits", statement: "No post-fault recovery was measured.", sources: ["RunEvidenceSample"], limit: "One pair proves no general effect." },
  ] } };

test("guided review keeps expectation, failed requirement, trace source, unknown and learner-owned experiment together", () => {
  const html = render(<GuidedReview report={report} />);
  for (const text of ["What did you expect?", "You predicted", "saturated", "healthy", "Database must be healthy", "93.3%", "RunEvidenceSample[61]", "No post-fault recovery", "Plan one change", "not rule out interactions"]) expect(html).toContain(text);
  expect(html).toContain('aria-labelledby="guided-title"'); expect(html).toContain("Inspect app-2"); expect(html).toContain("<details");
  expect(html).not.toContain("db.m5.large"); expect(html).not.toContain("<svg");
  expect(measurementId("db", true)).not.toBe(measurementId("db"));
});

test("draft hypothesis context cannot cross accounts, designs or invalid payloads", () => {
  expect(readLearningContext({ challengeImprovement: context }, "alice", "design")).toEqual(context);
  expect(readLearningContext({ challengeImprovement: context }, "bob", "design")).toBeNull();
  expect(readLearningContext({ challengeImprovement: context }, "alice", "other")).toBeNull();
  expect(readLearningContext({ challengeImprovement: { ...context, hypothesis: "x".repeat(401) } }, "alice", "design")).toBeNull();
});

test("change review uses human labels, explicit repeat and an announced multi-change acknowledgement", () => {
  const review: DesignChangeReview = { classification: "one-change", count: 1, inputHash: "hash", starting: {} as DesignChangeReview["starting"], differences: {
    added: [], removed: [], reconfigured: [{ id: "app-2", fields: [{ field: "skuId", earlier: "c5.large", later: "c5.xlarge" }] }], addedConnections: [], removedConnections: [], resourceOrder: null, connectionOrder: null } };
  const view = (r: DesignChangeReview) => render(<ImprovementReview context={context} review={r} error={null} acceptedHash={null} onAccept={() => {}} />);
  expect(view(review)).toContain("One simulation-relevant change"); expect(view(review)).toContain("app-2 catalog size"); expect(view(review)).not.toContain("skuId");
  const many = view({ ...review, classification: "several-changes", count: 2 });
  expect(many).toContain('role="alert"'); expect(many).toContain("harder to interpret"); expect(many).toContain("Continue deliberately");
  const none = view({ ...review, classification: "no-change", count: 0, differences: { ...review.differences!, reconfigured: [] } });
  expect(none).toContain("Nothing that affects this simulation changed"); expect(none).toContain("Run an unchanged repeat"); expect(none).toContain("previous prediction is not copied");
});

test("completed learning attempts offer their explicit source comparison, never an array-position guess", () => {
  const html = render(<ReportView report={{ ...report, run: { ...report.run, learning: { sourceRunId: "source", intent: "improvement", hypothesis: context.hypothesis } } }} />);
  expect(html).toContain("Compare with the attempt you improved"); expect(html).toContain("/runs/compare?a=source&amp;b=run");
  expect(html).toContain(context.hypothesis);
});
