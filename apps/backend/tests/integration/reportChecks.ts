import { expect } from "bun:test";
import type { RunHistory, RunReport } from "@infraforge/contracts/reports";
import type { LocalHarness } from "./localHarness";

/* recordedRun: the main run, replayed from its browser submission with a load change and a crash. */
export async function checkRecordedReports(harness: LocalHarness, recordedRun: string, failedRun: string) {
  const session = await harness.request("/auth/get-session");
  const rows = (await harness.sql.query(`SELECT id, status FROM "Deployment"
    WHERE "ownerId" = $1 ORDER BY "createdAt" DESC, id DESC`, [session.user.id])).rows;
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: RunHistory = await harness.request(`/deployments/history?limit=2${cursor ? `&before=${cursor}` : ""}`);
    expect(page.runs.length).toBeLessThanOrEqual(2);
    ids.push(...page.runs.map((run) => run.id));
    cursor = page.nextCursor;
    // Pagination must advance even when many rows have equal creation timestamps.
    expect(ids.length).toBeLessThanOrEqual(rows.length);
  } while (cursor);
  expect(ids).toEqual(rows.map((row) => row.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const query of ["limit=0", "limit=101", "limit=abc", "before=bad", "userId=someone-else"]) {
    await harness.request(`/deployments/history?${query}`, undefined, "GET", 400);
  }
  const recorded: RunReport = (await harness.request(`/deployments/${recordedRun}/report`)).report;
  expect(recorded.run.status).toBe("torn-down");
  expect(recorded.terminal?.simulatedSeconds).toBe(40);
  expect(recorded.actions.some((action) => action.kind === "chaos" && action.appliedAt)).toBe(true);
  expect(recorded.actions.some((action) => action.kind === "load" && action.appliedAt)).toBe(true);
  // The saved design was edited after the run started; the run keeps the design it captured.
  expect(recorded.topology.original?.resources.some((r) => r.id === "saved-only")).toBe(false);
  expect(recorded.provenance.simulationModelVersion).toBe("2");
  expect((await harness.request(`/deployments/${recordedRun}/report`)).report).toEqual(recorded);
  const failure: RunReport = (await harness.request(`/deployments/${failedRun}/report`)).report;
  expect(failure.run.status).toBe("failed");
  expect(failure.stages).toEqual([]);
  expect(failure.checkpoint).toBeNull();
  expect(failure.observed.some((fact) => fact.id === "failure")).toBe(true);
  const tornDown = rows.find((row) => row.status === "torn-down");
  expect(tornDown).toBeDefined();
  const retired: RunReport = (await harness.request(`/deployments/${tornDown!.id}/report`)).report;
  expect(retired.run.status).toBe("torn-down");
  expect(retired.checkpoint).toBeNull();
  expect(retired.stages.map((stage) => stage.name)).toEqual(["Validate", "SecurityScan", "CostEstimate"]);
  return { ownerScopedPages: true, runCount: ids.length, replayedActions: true,
    capturedTopologyPreserved: true, failureAndTeardown: true, deterministic: true };
}
