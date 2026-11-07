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

test("capacity budget: real saved reports render retained resource prices and signed remaining budget; missing or invalid evidence stays Unknown", async () => {
  const process = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/capacityBudgetReport.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const output = await new Response(process.stdout).text(), diagnostics = await new Response(process.stderr).text();
  expect(await process.exited, diagnostics).toBe(0);
  const {reports, storedItems, missingCost, legacy, invalidItems, failedCost, duplicateCost, wrongIdentity, noBudget} = JSON.parse(output) as {
    reports: RunReport[]; storedItems: unknown; missingCost: RunReport; legacy: RunReport; invalidItems: RunReport[];
    failedCost: RunReport; duplicateCost: RunReport; wrongIdentity: RunReport; noBudget: RunReport;
  };
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
    for (const text of ["Monthly resource price line items", "Remaining monthly budget", "Monthly budget limit", "s-", "db-s-", "not current catalog prices", "negative amount is over budget"]) expect(html).toContain(text);
    expect(html).toContain(i === 0 ? "$72.00" : "-$36.00");
    expect(report.monthlyBudgets![0]).toMatchObject({limitUsd: 180, remainingUsd: i === 0 ? 72 : -36});
  }
  expect(reports[0]!.stages.find(s => s.name === "CostEstimate")!.lineItems).toEqual(storedItems);
  for (const report of [legacy, ...invalidItems]) {
    expect(report.challenge).toEqual(reports[0]!.challenge);
    expect(report.stages.find(s => s.name === "CostEstimate")!.lineItems).toBeUndefined();
    expect(render(report)).toContain("Unknown: no usable resource price line items were retained.");
    expect(render(report)).toContain("$72.00"); // Missing breakdown does not erase a valid total.
  }
  for (const report of [missingCost, failedCost, duplicateCost]) {
    expect(report.monthlyBudgets![0].remainingUsd).toBeUndefined();
    expect(render(report)).toMatch(/Remaining monthly budget<\/dt><dd[^>]*>Unknown/);
  }
  for (const report of [missingCost, failedCost]) expect(report.challenge!.criteria.find(c => c.id === "budget")!.status).toBe("not-evaluated");
  // Historical judging remains unchanged; the additive arithmetic refuses ambiguous stage identity.
  expect(duplicateCost.challenge!.criteria.find(c => c.id === "budget")!.status).toBe("met");
  expect(render(missingCost)).not.toContain("Monthly estimate (CostEstimate gate)");
  expect(render(missingCost)).toContain("The cost estimate has not completed.");
  expect(render(missingCost)).not.toContain("Estimated $0.00");
  for (const report of [wrongIdentity, noBudget]) {
    expect(report.monthlyBudgets).toBeUndefined();
    expect(renderToStaticMarkup(<ReportMeasurements report={report} number={3} />)).not.toContain("Remaining monthly budget");
  }
}, 60000);
