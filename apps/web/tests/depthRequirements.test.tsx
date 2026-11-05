import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import { RequirementList } from "../src/features/challenges/components/RequirementList";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { evaluation } from "./fixtures";

test("resource work requirements use the existing generic brief and saved-result rows", () => {
  const criteria: ChallengeCriterion[] = [
    {id: "route", kind: "gateway-route-work", label: "Read upstream work", resourceId: "gateway", routeId: "read", minCompleted: 2, maxUpstreamFailed: 0},
    {id: "jobs", kind: "scheduler-work", label: "Scheduled work", resourceId: "timer", minCompleted: 20, maxMissed: 0, maxOutstanding: 0},
    {id: "fn", kind: "function-work", label: "Function work", resourceId: "fn", minCompleted: 800, maxThrottled: 8500, maxDownstreamFailed: 0},
  ];
  const brief = renderToStaticMarkup(<RequirementList criteria={criteria} checks={criteria.map(c => ({id: c.id, label: c.label, status: "during-run", detail: "Measured during the run"}))} />);
  for (const c of criteria) expect(brief).toContain(c.label);
  const details = ["Recorded route completions", "Recorded missed jobs", "Function counters are Unknown"];
  const saved = renderToStaticMarkup(<MemoryRouter><ChallengeDebrief brief={null} evaluation={{...evaluation("not-evaluated", []), predictions: [], criteria: criteria.map((c, i) => ({id: c.id, label: c.label, detail: details[i]!, status: i === 0 ? "met" : i === 1 ? "not-met" : "not-evaluated", sources: ["terminalSnapshot.metrics"]}))}} /></MemoryRouter>);
  for (const c of criteria) expect(saved).toContain(c.label);
  for (const detail of details) expect(saved).toContain(detail);
  expect(saved).toContain("Not evaluated");
});
