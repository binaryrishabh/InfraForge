import { expect } from "bun:test";
import type { RunHistory, RunReport } from "@infraforge/contracts/reports";
import type { LocalHarness } from "./localHarness";

export async function checkRecordedReports(harness: LocalHarness, checkpointRun: string, failedRun: string) {
  const session = await harness.request("/auth/get-session");
  const rows = (await harness.sql.query(`SELECT d.id, d.status FROM "Deployment" d JOIN "Infrastructure" i ON i.id = d."infrastructureId"
    WHERE i."ownerId" = $1 ORDER BY d."createdAt" DESC, d.id DESC`, [session.user.id])).rows;
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
  const checkpoint: RunReport = (await harness.request(`/deployments/${checkpointRun}/report`)).report;
  expect(checkpoint.run.status).toBe("failed");
  expect(checkpoint.checkpoint?.simulatedSeconds).toBeGreaterThan(0);
  expect(checkpoint.chaosEvents.length).toBeGreaterThan(0);
  expect(checkpoint.topology.original?.resources.some((r) => r.id === "saved-only")).toBe(false);
  expect(checkpoint.topology.changes?.added).toContain("live-storage");
  expect(checkpoint.observed.some((fact) => fact.id === "failure")).toBe(true);
  expect(checkpoint.unknown.join(" ")).toContain("not its measurement time");
  expect((await harness.request(`/deployments/${checkpointRun}/report`)).report).toEqual(checkpoint);
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
  return { ownerScopedPages: true, runCount: ids.length, checkpointAndChaos: true,
    capturedTopologyPreserved: true, failureAndTeardown: true, deterministic: true };
}
