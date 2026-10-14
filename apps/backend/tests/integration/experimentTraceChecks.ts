import { expect } from "bun:test";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import type { SessionFixtures } from "./sessionFixtures";
import { traceProbe } from "./traceProbe";
import { latestChallenge } from "../../challenges/registry";
import { REFERENCE } from "../challengeHarness";

export async function checkExperimentTraces(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const d = latestChallenge("lose-an-app-server")!.definition;
  const prediction = { answers: { baseline: "healthy", survivors: "saturated", scale: "no" }, reasoning: null };
  const workspace = (await harness.request(`/challenges/${d.id}/workspace`, { fresh: true }, "POST", 201)).designId;
  designs.push(workspace);
  const start = async () => {
    const run = (await harness.request(`/challenges/${d.id}/attempts`, { infrastructureId: workspace, prediction }, "POST", 201)).createdDeployment;
    runs.push(run.id); await until(async () => (await row(run.id)).status === "live" || undefined, "trace run live", 30000, 500); return run.id as string;
  };
  const row = async (id: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  const report = async (id: string): Promise<RunReport> => (await harness.request(`/deployments/${id}/report`)).report;
  const samples = async (id: string) => (await harness.sql.query('SELECT * FROM "RunEvidenceSample" WHERE "deploymentId"=$1 ORDER BY "simulatedSeconds"', [id])).rows;
  const blocked = await start(), probe = await traceProbe(harness, blocked, 60, true);
  try {
    await harness.request(`/deployments/${blocked}/speed`, { speed: 60 }, "POST", 202);
    await until(async () => (await probe.attempts("sample")) >= 2 || undefined, "two blocked trace batches", 30000);
    const sampleBlockedAt = new Date();
    expect(await samples(blocked)).toHaveLength(0);
    expect((await harness.sql.query('SELECT count(*)::int AS count FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'chaos\'', [blocked])).rows[0].count).toBe(0);
    expect((await row(blocked)).terminalSnapshot).toBeNull();
    await probe.releaseSamples();
    await until(async () => (await probe.attempts("terminal")) >= 2 || undefined, "two blocked terminal captures", 30000);
    const terminalBlockedAt = new Date(), retained = await samples(blocked);
    expect(retained.map((p) => p.simulatedSeconds)).toEqual(Array.from({ length: 61 }, (_, i) => 30 + i));
    expect(retained.find((p) => p.simulatedSeconds === 60)!.sampledAt.getTime()).toBeLessThan(sampleBlockedAt.getTime());
    expect((await row(blocked)).terminalSnapshot).toBeNull();
    expect((await harness.sql.query('SELECT status,"completedSimulatedSeconds" FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'chaos\'', [blocked])).rows[0]).toEqual({ status: "completed", completedSimulatedSeconds: 90 });
    await probe.releaseTerminal();
    const done = await until(async () => { const r = await row(blocked); return r.status === "torn-down" ? r : undefined; }, "trace terminal retry", 30000);
    expect(Date.parse(done.terminalSnapshot.capturedAt)).toBeLessThan(terminalBlockedAt.getTime());
    expect(await samples(blocked)).toEqual(retained);
    const result = await report(blocked);
    expect(result.experimentTrace).toMatchObject({ status: "complete", expectedStart: 30, expectedEnd: 90, sampleCount: 61 });
    const point = (second: number) => result.experimentTrace!.points.find((p) => p.simulatedSeconds === second)!;
    expect(point(60).resources.find((r) => r.id === "app-2")?.health).toBe("healthy");
    expect(point(61).resources.find((r) => r.id === "app-2")?.health).toBe("failed");
    expect(Object.fromEntries(point(90).resources.map(({ id, ...metrics }) => [id, metrics]))).toEqual(done.terminalSnapshot.metrics);
    const cookie = harness.cookie, bob = await sessions.create();
    try { harness.cookie = bob.cookie; await harness.request(`/deployments/${blocked}/report`, undefined, "GET", 404); await harness.request(`/deployments/compare?a=${blocked}&b=${runs[0]}`, undefined, "GET", 404); }
    finally { harness.cookie = cookie; }
    // Deliberate fixture gap: report it rather than fabricating the deleted value.
    await harness.sql.query('DELETE FROM "RunEvidenceSample" WHERE "deploymentId"=$1 AND "simulatedSeconds"=42', [blocked]);
    expect((await report(blocked)).experimentTrace).toMatchObject({ status: "incomplete", sampleCount: 60, missingRanges: [{ start: 42, end: 42 }] });
  } finally { await probe.close(); }

  const early = await start();
  await harness.request(`/deployments/${early}/speed`, { speed: 10 }, "POST", 202);
  await until(async () => (await samples(early)).some((p) => p.simulatedSeconds >= 70) || undefined, "early retained fault samples", 30000);
  await harness.request(`/deployments/${early}/speed`, { speed: 0 }, "POST", 202);
  await until(async () => (await harness.sql.query('SELECT 1 FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'speed\' AND parameters->>\'speed\'=\'0\' AND status=\'completed\'', [early])).rowCount! > 0 || undefined, "early pause acknowledged");
  await harness.request(`/deployments/${early}/teardown`, {}, "POST", 202);
  await until(async () => (await row(early)).status === "torn-down" || undefined, "early trace stop");
  const earlyReport = await report(early);
  expect(earlyReport.terminal!.simulatedSeconds!).toBeLessThan(90); expect(earlyReport.experimentTrace?.status).toBe("incomplete");
  expect(earlyReport.challenge?.status).toBe("not-evaluated");

  const interrupted = await start(), crashProbe = await traceProbe(harness, interrupted, 61, false);
  try {
    await harness.request(`/deployments/${interrupted}/speed`, { speed: 60 }, "POST", 202);
    await until(async () => (await crashProbe.attempts("sample")) >= 2 || undefined, "trace frozen after durable prefix", 30000);
    const prefix = await samples(interrupted); expect(prefix).toHaveLength(31);
    await harness.stop("worker"); await crashProbe.close();
    await harness.startWorker();
    await until(async () => (await row(interrupted)).status === "failed" || undefined, "restart records interruption");
    expect(await samples(interrupted)).toEqual(prefix);
    expect((await report(interrupted)).experimentTrace).toMatchObject({ status: "incomplete", actualLast: 60, missingRanges: [{ start: 61, end: 90 }] });
  } catch (error) { await crashProbe.close().catch(() => {}); throw error; }
  await harness.request(`/infrastructure/${workspace}`, undefined, "DELETE");
  expect((await report(interrupted)).run.infrastructureId).toBeNull(); expect((await report(interrupted)).experimentTrace?.sampleCount).toBe(31);

  const cpu = latestChallenge("headroom-under-cpu-pressure")!.definition;
  const cpuWorkspace = (await harness.request(`/challenges/${cpu.id}/workspace`, {}, "POST", 201)).designId; designs.push(cpuWorkspace);
  const cpuRuns: string[] = [];
  for (const reference of [false, true]) {
    if (reference) await harness.request(`/infrastructure/${cpuWorkspace}`, { layout: { ...REFERENCE[cpu.id]!, layoutVersion: 3 } }, "PUT");
    const answers = { baseline: "healthy", target: reference ? "healthy" : "saturated", health: reference ? "healthy" : "saturated", scale: "no" };
    const id = (await harness.request(`/challenges/${cpu.id}/attempts`, { infrastructureId: cpuWorkspace, prediction: { answers, reasoning: null } }, "POST", 201)).createdDeployment.id;
    runs.push(id); cpuRuns.push(id);
    await until(async () => (await row(id)).status === "live" || undefined, "CPU attempt live", 30000, 500);
    await harness.request(`/deployments/${id}/speed`, { speed: 60 }, "POST", 202);
    await until(async () => (await row(id)).status === "torn-down" || undefined, "CPU evaluation", 30000, 500);
    const result = await report(id);
    expect(result.experimentTrace).toMatchObject({ status: "complete", sampleCount: 51, expectedEnd: 80 });
    expect(result.challenge?.status).toBe(reference ? "met" : "not-met");
    expect(result.challenge?.predictions.map((p) => p.outcome)).toEqual(["matched", "matched", "matched", "matched"]);
  }
  const comparison = (await harness.request(`/deployments/compare?a=${cpuRuns[0]}&b=${cpuRuns[1]}`)).comparison;
  expect(comparison.experimentEvidence.comparable).toBe(true); expect(comparison.experimentEvidence.traces.map((t: { count: number }) => t.count)).toEqual([51, 51]);
  return { blocked, early, interrupted, cpuRuns, durableBeforeFaultAndTerminal: true, originalBatchRetried: true, partialTraceSurvivesRestart: true, crossOwnerRefused: true };
}
