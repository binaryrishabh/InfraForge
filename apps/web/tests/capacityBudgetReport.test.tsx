import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportMeasurements } from "../src/features/reports/components/ReportMeasurements";
import { ChallengeDebrief } from "../src/features/challenges/components/ChallengeDebrief";

const render = (report: RunReport) => renderToStaticMarkup(<MemoryRouter>
  <ReportMeasurements report={report} number={3} />
  <ChallengeDebrief evaluation={report.challenge!} brief={null} />
</MemoryRouter>);

test("capacity budget: real saved reports render the total, limit, source and exclusively budget-failing verdict", async () => {
  const process = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/capacityBudgetReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const output = await new Response(process.stdout).text(), diagnostics = await new Response(process.stderr).text();
  expect(await process.exited, diagnostics).toBe(0);
  const reports = JSON.parse(output) as RunReport[];
  expect(reports).toHaveLength(2);
  for (const [i, report] of reports.entries()) {
    const total = report.stages.find(s => s.name === "CostEstimate")!.monthlyEstimateUsd!;
    expect(report.challenge!.challengeId).toBe("split-the-capacity-budget");
    expect(total).toBe(i === 0 ? 108 : 216);
    const html = render(report);
    for (const text of ["Monthly estimate (CostEstimate gate)", `Estimated $${total.toFixed(2)} a month; the limit is $180.00.`,
      "Catalog snapshot monthly estimate is at most $180", "Recorded cost estimates", "Evidence:",
      'title="stages.CostEstimate.monthlyEstimate">monthly cost estimate</span>', "Neither is a cloud bill"]) expect(html).toContain(text);
    expect(report.challenge!.criteria.filter(c => c.status !== "met").map(c => c.id)).toEqual(i === 0 ? [] : ["budget"]);
    expect(html).toContain(i === 0 ? "Every requirement was met." : "Not every requirement was met.");
    // Projection and UI deliberately make no per-resource price or remaining-budget claim.
    expect(html).not.toContain("Monthly SKU line items");
    const missing = structuredClone(report);
    missing.stages = missing.stages.filter(s => s.name !== "CostEstimate");
    missing.challenge!.criteria.find(c => c.id === "budget")!.detail = "The cost estimate has not completed.";
    missing.challenge!.criteria.find(c => c.id === "budget")!.status = "not-evaluated";
    const unknown = render(missing);
    expect(unknown).not.toContain("Monthly estimate (CostEstimate gate)");
    expect(unknown).toContain("The cost estimate has not completed.");
    expect(unknown).not.toContain("Estimated $0.00");
  }
}, 60000);
