import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { DeploymentChaosNames } from "@infraforge/domain/resource";
import type { RunAction } from "@infraforge/contracts/actions";
import { ChallengeRow } from "../src/features/challenges/pages/ChallengesPage";
import { ChallengeBriefView } from "../src/features/challenges/pages/ChallengeDetailPage";
import { ChallengeBriefPanel } from "../src/features/challenges/components/ChallengeBriefPanel";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { ExperimentTimeline } from "../src/features/challenges/components/ExperimentTimeline";
import { experimentPhase, planOf } from "../src/features/challenges/experiment";
import { predictionPhases } from "../src/features/challenges/predictionChoices";
import { ActionTimeline } from "../src/features/reports/components/ActionTimeline";
import { brief, evaluation, experimentResult, resilienceBrief, summary } from "./fixtures";

const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const plan = planOf(resilienceBrief.experiment!);

test("the live phase is stated in words: baseline, the active fault with its remaining time, then 'fault ended', never 'recovered'", () => {
  expect(experimentPhase(plan, 37, undefined)).toEqual({ kind: "baseline", remaining: 23, message: "Baseline · Crash on app-2 scheduled at second 60, in 23 simulated seconds" });
  const active = { chaosType: DeploymentChaosNames.Crash, resourceId: "app-2", durationTicks: 30, remainingTicks: 14 };
  expect(experimentPhase(plan, 76, active).message).toBe("Crash on app-2 active · 14 simulated seconds remaining");
  expect(experimentPhase(plan, 89, { ...active, remainingTicks: 1 }).message).toBe("Crash on app-2 active · 1 simulated second remaining");
  expect(experimentPhase(plan, 60, undefined).kind).toBe("waiting");
  const ended = experimentPhase(plan, 90, undefined);
  expect(ended).toMatchObject({ kind: "ended", message: "Fault ended at second 90 (Crash on app-2)" });
  expect(JSON.stringify([ended, experimentPhase(plan, 76, active)])).not.toMatch(/recover/i);
});

test("the experiment timeline is an ordered list for every reader, with the current step and a once-per-phase announcement", () => {
  const still = render(<ExperimentTimeline plan={plan} evaluationSeconds={90} />);
  expect(still).toContain("<ol");
  for (const text of ["Baseline", "0–60 s", "Crash on app-2", "60–90 s", "Judged at <span class=\"if-num\">90 s</span>", ", the fault&#x27;s last second"]) expect(still).toContain(text);
  expect(still).not.toContain("sr-only grid");
  expect(still).not.toContain("aria-live");
  const live = render(<ExperimentTimeline plan={plan} evaluationSeconds={90} seconds={76}
    phase={experimentPhase(plan, 76, { chaosType: DeploymentChaosNames.Crash, resourceId: "app-2", durationTicks: 30, remainingTicks: 14 })} />);
  expect(live).toContain('aria-current="step"');
  // While live on a phone the legend is visually hidden but stays in the accessibility tree.
  expect(live).toContain("max-sm:sr-only");
  expect(live).toContain("Now 76 s · ");
  expect(live).toContain('aria-live="polite" class="sr-only">Crash on app-2 is now active.</p>');
  expect(live.match(/aria-live/g)).toHaveLength(1);
});

test("a resilience brief states the hypothesis, the schedule and the required target before anything runs", () => {
  const html = render(<ChallengeBriefView brief={resilienceBrief} />);
  expect(html).toContain("Resilience · ");
  expect(html.indexOf("The experiment")).toBeLessThan(html.indexOf("Fixed conditions"));
  expect(html).toContain(resilienceBrief.experiment!.hypothesis);
  expect(html).toContain("Keep app-2 in your design and connected; if it is missing the experiment cannot run, and nothing else is chosen in its place.");
  expect(html).toContain("Before the fault"); expect(html).toContain("While it is active");
  expect(predictionPhases(resilienceBrief.predictions)).toEqual({ before: resilienceBrief.predictions.slice(0, 1), during: resilienceBrief.predictions.slice(1) } as never);
  expect(predictionPhases(brief.predictions)).toBeNull();
  const panel = render(<ChallengeBriefPanel brief={resilienceBrief} preflightError={false} preflight={{ valid: false, errors: ["missing"], warnings: [], monthlyEstimateUsd: 93,
    resourceTypes: [], checks: [], experiment: { ready: false, detail: "The experiment targets app-2 (Virtual Machine), which is no longer in this design." } }} />);
  expect(panel).toContain("Resilience challenge");
  expect(panel).toContain("which is no longer in this design");
});

test("versions: a past attempt's brief says so, and a newer version never silently reuses an earlier workspace", () => {
  const historical = render(<ChallengeBriefView brief={{ ...resilienceBrief, version: 1, latestVersion: 2 }} />);
  expect(historical).toContain("You are reading version 1");
  expect(historical).toContain('href="/challenges/lose-an-app-server"');
  expect(historical).not.toContain("Start designing");
  const upgraded = render(<ChallengeBriefView brief={{ ...resilienceBrief, version: 2, latestVersion: 2, earlierWorkspace: { designId: "old", version: 1 } }} />);
  expect(upgraded).toContain("Start version 2");
  expect(upgraded).toContain("Copy my version 1 design into it");
  expect(upgraded).toContain("Your version 1 design stays in Designs");
  const panel = render(<ChallengeBriefPanel brief={{ ...resilienceBrief, latestVersion: 2 }} preflight={null} preflightError={false} workspaceVersion={1} designId="old" />);
  expect(panel).toContain("This design is a version 1 workspace");
  expect(panel).toContain("Copy this design into it");
  const row = render(<ol><ChallengeRow challenge={{ ...summary, category: "resilience" }} index={6} /></ol>);
  expect(row).toContain("one scheduled fault · judged at second 150");
});

test("the debrief separates the experiment from both verdicts and states what it cannot show", () => {
  const evaluated = { ...evaluation("not-met", ["matched", "different"]), challengeId: resilienceBrief.id, evaluationSeconds: 90, experiment: experimentResult,
    predictions: resilienceBrief.predictions.map((q, i) => ({ id: q.id, prompt: q.prompt, predicted: i ? "degraded" : "healthy", actual: i ? "saturated" : "healthy",
      outcome: (i ? "different" : "matched") as "matched" | "different", detail: "recorded", sources: ["RunAction.outcome.baselineOverallHealth"] })) };
  const attempted = { ...resilienceBrief, attempts: [{ runId: "now", version: 1, createdAt: "", status: "not-met" as const, metCount: 1, total: 2 },
    { runId: "before", version: 1, createdAt: "", status: "not-met" as const, metCount: 1, total: 2 }] };
  const html = render(<ChallengeDebrief evaluation={evaluated} brief={attempted} runId="now" />);
  expect(html.indexOf("Your prediction")).toBeLessThan(html.indexOf("The experiment"));
  for (const text of ["Crash on app-2", "Applied; fault window ended", "second 60", "second 90", "(the model&#x27;s duration)", "Overall health when applied",
    "What this experiment cannot show", "not that anything recovered", "Before the fault", "While it was active",
    "Every new attempt runs the same experiment", 'href="/runs/compare?a=before&amp;b=now"', "app-2 at second 90"]) expect(html).toContain(text);
  expect(html).not.toMatch(/(?<!not that anything )recovered\b/);
});

test("the report marks the scheduled fault as the challenge's experiment; a person's fault stays a fault", () => {
  const base = { deploymentId: "r", status: "completed" as const, requestedAt: "2026-10-15T10:00:00.000Z", appliedAt: "2026-10-15T10:00:01.000Z",
    completedAt: "2026-10-15T10:00:31.000Z", appliedSimulatedSeconds: 60, completedSimulatedSeconds: 90, failureReason: null };
  const actions: RunAction[] = [
    { ...base, id: "x", sequence: 1, kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "app-2", trigger: "challenge-experiment" },
      outcome: { durationSimulatedSeconds: 30, faultEnded: true, observedOverallHealth: "critical", baselineOverallHealth: "healthy" } },
    { ...base, id: "y", sequence: 2, kind: "chaos", parameters: { type: DeploymentChaosNames.CpuSpike, resourceId: "db" }, outcome: { durationSimulatedSeconds: 20, faultEnded: true, observedOverallHealth: "healthy" } },
  ];
  const html = render(<ActionTimeline actions={actions} />);
  expect(html).toContain("Challenge experiment");
  expect(html).toContain("Scheduled by the challenge definition and applied by InfraForge, not requested from the controls.");
  expect(html).toContain("Overall health when the fault was applied: healthy.");
  expect(html.match(/>Fault</g)).toHaveLength(1);
});

test("motion is supplemental: faults and traffic lines stop animating under reduced motion", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(reduced).toContain(".if-flow { animation: none; }");
  expect(reduced).toContain(".if-fault { animation: none; }");
});
