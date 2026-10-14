import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ChallengeRow } from "../src/features/challenges/pages/ChallengesPage";
import { ChallengeBriefView } from "../src/features/challenges/pages/ChallengeDetailPage";
import { ChallengeBriefPanel } from "../src/features/challenges/components/ChallengeBriefPanel";
import { PredictionQuestionField } from "../src/features/challenges/components/AttemptDialog";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";
import { predictionChoices } from "../src/features/challenges/predictionChoices";
import { evaluationContext } from "../src/features/challenges/challengeLabels";
import { brief, evaluation, summary } from "./fixtures";

const render = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

test("the challenge list reads as assignments: brief, conditions and factual status, no scores", () => {
  const html = render(<ol><ChallengeRow challenge={summary} index={0} /></ol>);
  expect(html).toContain('href="/challenges/cache-matters"');
  expect(html).toContain("3 requirements · judged at second 150");
  expect(html).toContain("Not started");
  for (const word of ["XP", "streak", "badge", "leaderboard", "points", "rank"]) expect(html.toLowerCase()).not.toContain(word.toLowerCase());
  const attempted = render(<ol><ChallengeRow challenge={{ ...summary, attempts: 2, latest: { runId: "r", version: 1, createdAt: "", status: "not-met", metCount: 1, total: 3 } }} index={1} /></ol>);
  expect(attempted).toContain("Not met yet"); expect(attempted).toContain("2 attempts"); expect(attempted).toContain("Continue");
});

test("the brief locks the workload and evaluation time and never shows a passing design", () => {
  const html = render(<ChallengeBriefView brief={brief} />);
  expect(html).toContain("1,800,000 requests per hour · steady · 95% reads · medium payloads");
  expect(html).toContain("The same for every attempt; you cannot change it.");
  expect(html).toContain("Simulated second 150");
  expect(html).toContain("An existing design: 1 × DNS, 2 × Virtual Machine, 1 × Database");
  expect(html).not.toContain("public");
  expect(html).not.toContain("Cache ×");
  expect(html).toContain("Which resource type will have the highest CPU at second 150?");
  expect(html).toContain("Predictions are locked when the attempt starts");
  expect(html).toContain("Unlocks after your first attempt");
  expect(html).toContain("Show a hint (1 of 3)");
  expect(html).not.toContain(brief.hints[2]!);
  expect(html).toContain("Start designing");
});

test("the evaluation note is shown for what it adds, without repeating the second", () => {
  expect(evaluationContext("Checked at simulated second 90.", 90)).toBe("");
  expect(evaluationContext("Checked at simulated second 120, after the 60-second ramp to full traffic.", 120)).toBe("After the 60-second ramp to full traffic.");
  expect(evaluationContext("Checked after the ramp.", 150)).toBe("Checked after the ramp.");
});

test("in the designer, requirements carry readiness and runtime checks are deferred to the run", () => {
  const html = render(<ChallengeBriefPanel brief={brief} preflightError={false} preflight={{ valid: true, errors: [], warnings: [], monthlyEstimateUsd: 108, resourceTypes: ["DNS"], experiment: null,
    checks: [{ id: "checks", label: "", status: "ok", detail: "The design passes validation." }, { id: "database", label: "", status: "during-run", detail: "Measured at simulated second 150." },
      { id: "budget", label: "", status: "problem", detail: "Currently $512.00 a month." }] }} />);
  expect(html).toContain("Fixed conditions");
  expect(html).toContain("Ready"); expect(html).toContain("Checked during the run"); expect(html).toContain("Needs work");
  expect(html).toContain("You will commit to 2 predictions first");
});

test("prediction is a compact commitment: native radios, a legend, and only types present in the design", () => {
  const busiest = brief.predictions[1]!;
  expect(predictionChoices(busiest, ["DNS", "Database"]).map((c) => c.value)).toEqual(["DNS", "Database"]);
  expect(predictionChoices(brief.predictions[0]!, []).map((c) => c.value)).toEqual(["healthy", "degraded", "saturated", "failed"]);
  const html = renderToStaticMarkup(<PredictionQuestionField question={busiest} index={1} value="Database" onChange={() => {}} designTypes={["DNS", "Database"]} />);
  expect(html).toContain("<fieldset"); expect(html).toContain("<legend");
  expect(html.match(/type="radio"/g)).toHaveLength(2);
  expect(html).toContain('checked=""');
});

test("a failed challenge with a correct prediction keeps two separate verdicts", () => {
  const html = render(<ChallengeDebrief evaluation={evaluation("not-met", ["matched", "matched"])} brief={brief} />);
  expect(html).toContain("Challenge result"); expect(html).toContain("Not met yet"); expect(html).toContain("1 of 3 met.");
  expect(html).toContain("Your prediction"); expect(html).toContain("2 of 2 matched");
  expect(html).toContain("It does not change the challenge result.");
  expect(html).toContain("Every read reaches the database.");
  expect(html).toContain("Evidence: ");
  expect(html).toContain('<span title="terminalSnapshot.metrics">final resource measurements</span>');
  expect(html).not.toContain("score");
});

test("a passed challenge with a wrong prediction shows what differed", () => {
  const html = render(<ChallengeDebrief evaluation={evaluation("met", ["different", "unknown"])} brief={brief} />);
  expect(html).toContain("All requirements met"); expect(html).toContain("0 of 2 matched");
  expect(html).toContain("Different"); expect(html).toContain("Not recorded");
  expect(html).toContain("Saturated"); expect(html).toContain("Healthy");
  expect(html).toContain("<th scope=\"col\"");
  // Phones get the same facts as a short list per prediction; the table is for wider screens.
  expect(html).toContain("sm:hidden");
  expect(html).toContain("<dt class=\"text-xs text-ink-3\">You predicted</dt>");
  expect(html).toContain("Judged against");
  expect(html).toContain("Improve the design");
});
