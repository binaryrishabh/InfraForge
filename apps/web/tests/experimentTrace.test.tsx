import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ExperimentTrace } from "@infraforge/contracts/reports";
import type { LearningAttempt } from "@infraforge/contracts/challenges";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import { ExperimentTraceView } from "../src/features/challenges/components/ExperimentTraceView";
import { pressureSegments } from "../src/features/challenges/traceGeometry";
import { LearningAttemptList } from "../src/features/challenges/components/LearningHistory";
import { ExperimentCompare } from "../src/features/reports/components/ExperimentCompare";
import { experimentResult } from "./fixtures";

const trace: ExperimentTrace = {
  status: "complete", reason: "Every expected tick is retained.", expectedStart: 30, expectedEnd: 90, actualFirst: 30, actualLast: 90,
  sampleCount: 61, missingRanges: [], moments: { beforeFault: 59, atFault: 60, firstAfterFault: 61, firstOverallHealthChange: 61, evaluation: 90 },
  resourceFacts: [{ id: "app-2", highestCpu: { second: 60, value: 45 }, highestMemory: { second: 60, value: 48 }, firstHealthChange: 61, firstHealthyAfterFault: null }], resourceFactsOmitted: 0,
  points: Array.from({ length: 61 }, (_, i) => ({ version: 1, simulatedSeconds: i + 30, sampledAt: "2026-10-14T00:00:00.000Z", topologyRevision: 0,
    overallHealth: i + 30 <= 60 ? "healthy" : "critical", loadFraction: 1, targetLoadFraction: 1,
    resources: [{ id: "app-2", health: i + 30 <= 60 ? "healthy" : "failed", cpu: i + 30 <= 60 ? 45 : 0, memory: i + 30 <= 60 ? 48 : 0 }], pools: [] })),
};
const render = (value: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{value}</MemoryRouter>);

test("real trace visuals have fault/evaluation markers, target selection and equivalent native key-moment facts", () => {
  const html = render(<ExperimentTraceView trace={trace} experiment={experimentResult} />);
  expect(html).toContain("System health over time"); expect(html).toContain("Resource pressure");
  expect(html).toContain("Applied 60s"); expect(html).toContain("Evaluation 90s");
  expect(html).toContain("<caption"); expect(html).toContain('scope="row"');
  expect(html).toContain("experiment target"); expect(html).toContain("Inspect retained sample at second 61");
  expect(html).toContain("Highest recorded CPU in the retained experiment window");
  expect(html).toContain("Recovery remains unknown");
  expect(html).not.toContain("<animate"); expect(html).not.toContain("maximum CPU for the entire run");
});

test("gaps split paths; missing resource values split paths too; incomplete and legacy views stay explicit", () => {
  const points = trace.points.filter((p) => ![73, 74].includes(p.simulatedSeconds));
  const segments = pressureSegments(points, "app-2", "cpu");
  expect(segments).toHaveLength(2); expect(segments[0]!.at(-1)!.second).toBe(72); expect(segments[1]![0]!.second).toBe(75);
  const resourceGap = points.map((p) => p.simulatedSeconds === 80 ? { ...p, resources: [] } : p);
  expect(pressureSegments(resourceGap, "app-2", "memory")).toHaveLength(3);
  const html = render(<ExperimentTraceView trace={{ ...trace, status: "incomplete", missingRanges: [{ start: 73, end: 74 }], points, sampleCount: points.length }} experiment={experimentResult} />);
  expect(html).toContain("Incomplete"); expect(html).toContain("73–74s"); expect(html).toContain("Nothing is interpolated");
  expect(html).toContain("viewBox="); expect(html).toContain("w-full");
  expect(render(<ExperimentTraceView experiment={experimentResult} />)).toContain("no retained per-second measurements");
});

test("learning history keeps version, category, raw requirement/prediction facts and unknowns, without scores", () => {
  const attempt: LearningAttempt = { runId: "run-a", challengeId: "lose-an-app-server", title: "Lose an app server", category: "resilience", fault: DeploymentChaosNames.Crash,
    version: 1, createdAt: "2026-10-14T00:00:00.000Z", status: "not-evaluated", metCount: 2, total: 3,
    predictionMatched: 1, predictionKnown: 2, predictionTotal: 3, latestVersion: 2, canRetry: true };
  const html = render(<LearningAttemptList attempts={[attempt]} />);
  expect(html).toContain("version 1"); expect(html).toContain("Resilience"); expect(html).toContain("Crash");
  expect(html).toContain("2 of 3 requirements met"); expect(html).toContain("1 of 3 predictions matched; 1 unknown");
  expect(html).toContain('href="/runs/run-a"'); expect(html).toContain("v2");
  expect(html).not.toMatch(/score|rank|XP|streak|\d+%/);
});

test("compare renders complete/incomplete retained-window facts and a missing trace without a second classifier", () => {
  const html = render(<ExperimentCompare evidence={{ comparable: false, reason: "Descriptive retained-window facts only.", traces: [
    { status: "complete", start: 30, end: 90, count: 61, target: "app-2", highestCpu: { second: 60, value: 45 } },
    { status: "unavailable", start: 30, end: 90, count: 0, target: "app-2", highestCpu: null },
  ] }} />);
  expect(html).toContain("complete · 61"); expect(html).toContain("unavailable · 0");
  expect(html).toContain("45% at second 60"); expect(html).toContain("Target CPU peak unavailable");
  expect(html).not.toContain("winner");
});
