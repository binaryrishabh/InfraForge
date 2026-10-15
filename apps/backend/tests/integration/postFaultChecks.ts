import { expect } from "bun:test";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import type { SessionFixtures } from "./sessionFixtures";
import { traceProbe } from "./traceProbe";
import { REFERENCE } from "../challengeHarness";

export async function checkPostFaultObservation(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const id = "after-the-cache-returns", base = `/challenges/${id}`;
  const prediction = { answers: { target: "healthy", health: "saturated", scale: "yes" }, reasoning: "Observe the whole window." };
  const workspace = (await harness.request(`${base}/workspace`, { fresh: true }, "POST", 201)).designId;
  designs.push(workspace);
  const row = async (run: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [run])).rows[0];
  const report = async (run: string): Promise<RunReport> => (await harness.request(`/deployments/${run}/report`)).report;
  const samples = async (run: string) => (await harness.sql.query('SELECT * FROM "RunEvidenceSample" WHERE "deploymentId"=$1 ORDER BY "simulatedSeconds"', [run])).rows;
  const start = async () => {
    const run = (await harness.request(`${base}/attempts`, { infrastructureId: workspace, prediction }, "POST", 201)).createdDeployment.id;
    runs.push(run); await until(async () => (await row(run)).status === "live" || undefined, "post-fault live", 30000, 500); return run as string;
  };
  await harness.request(`${base}/attempts`, { infrastructureId: workspace, prediction, postFaultObservationSeconds: 1 }, "POST", 400);
  const source = await start();
  await harness.request(`/deployments/${source}/speed`, { speed: 60 }, "POST", 202);
  await until(async () => (await row(source)).status === "torn-down" || undefined, "later evaluation", 30000, 500);
  const first = await report(source);
  expect(first.challenge?.status).toBe("not-met");
  expect(first.experimentTrace).toMatchObject({ status: "complete", sampleCount: 106, expectedEnd: 135,
    observation: { faultEndSecond: 90, sampleCount: 45, target: { firstHealthy: { second: 91 } }, system: { firstHealthy: { second: 92 }, healthAtEvaluation: "saturated" } } });
  expect((await row(source)).terminalSnapshot.simulatedSeconds).toBe(135);
  const aliceCookie = harness.cookie, bob = await sessions.createCredential();
  try { harness.cookie = bob.cookie;
    await harness.request(`/deployments/${source}/report`, undefined, "GET", 404);
    await harness.request(`${base}/improvement-workspace`, { sourceRunId: source }, "POST", 404);
  } finally { harness.cookie = aliceCookie; }
  const copy = (await harness.request(`${base}/improvement-workspace`, { sourceRunId: source }, "POST", 201)).infrastructure;
  designs.push(copy.id);
  const layout = { ...REFERENCE[id]!, layoutVersion: 3 };
  const review = (await harness.request(`${base}/improvement-preview`, { infrastructureId: copy.id, sourceRunId: source, layout }, "POST")).review;
  expect(review).toMatchObject({ count: 1, classification: "one-change" });
  await harness.request(`/infrastructure/${copy.id}`, { layout }, "PUT");
  const improved = (await harness.request(`${base}/attempts`, { infrastructureId: copy.id,
    prediction: { answers: { target: "healthy", health: "healthy", scale: "yes" }, reasoning: "A fresh prediction." },
    improvement: { sourceRunId: source, hypothesis: "I expect a single database change to affect later connection pressure.", intent: "improvement", inputHash: review.inputHash, acknowledgeMultiple: false } }, "POST", 201)).createdDeployment;
  runs.push(improved.id);
  await until(async () => (await row(improved.id)).status === "live" || undefined, "post-fault improvement live", 30000, 500);
  await harness.request(`/deployments/${improved.id}/speed`, { speed: 60 }, "POST", 202);
  await until(async () => (await row(improved.id)).status === "torn-down" || undefined, "post-fault improvement evaluated", 30000, 500);
  const passed = await report(improved.id);
  expect(passed.challenge?.status).toBe("met"); expect(passed.challenge?.predictions.every((p) => p.outcome === "matched")).toBe(true);
  expect(improved.evaluationStopAtSimulatedSeconds).toBe(135);
  const compare = (await harness.request(`/deployments/compare?a=${source}&b=${improved.id}`)).comparison;
  expect(compare).toMatchObject({ challengeConditions: "same", lineage: "source-and-improvement", experimentEvidence: { comparable: true } });
  expect(compare.experimentEvidence.traces.map((t: { observation: { system: { healthAtEvaluation: string } } }) => t.observation.system.healthAtEvaluation)).toEqual(["saturated", "healthy"]);
  await harness.sql.query('DELETE FROM "RunEvidenceSample" WHERE "deploymentId"=$1 AND "simulatedSeconds"=91', [source]);
  expect((await report(source)).experimentTrace?.observation?.target.firstHealthy).toMatchObject({ second: 92, completeSinceFaultEnd: false });

  const early = await start();
  await harness.request(`/deployments/${early}/speed`, { speed: 10 }, "POST", 202);
  await until(async () => (await samples(early)).some((p) => p.simulatedSeconds >= 100) || undefined, "post-fault partial samples", 30000, 250);
  await harness.request(`/deployments/${early}/speed`, { speed: 0 }, "POST", 202);
  await harness.request(`/deployments/${early}/teardown`, {}, "POST", 202);
  await until(async () => (await row(early)).status === "torn-down" || undefined, "post-fault early stop", 30000, 500);
  const partial = await report(early);
  expect(partial.terminal!.simulatedSeconds!).toBeLessThan(135); expect(partial.challenge?.status).toBe("not-evaluated");
  expect(partial.experimentTrace?.observation?.sampleCount).toBeGreaterThan(0);
  expect(partial.experimentTrace?.observation?.system.healthAtEvaluation).toBeNull();

  const interrupted = await start(), probe = await traceProbe(harness, interrupted, 101, false);
  try {
    await harness.request(`/deployments/${interrupted}/speed`, { speed: 10 }, "POST", 202);
    await until(async () => await probe.attempts("sample") >= 2 || undefined, "frozen post-fault batch", 40000, 250);
    const prefix = await samples(interrupted); expect(prefix.at(-1)?.simulatedSeconds).toBe(100);
    await harness.stop("worker"); await probe.close(); await harness.startWorker();
    await until(async () => (await row(interrupted)).status === "failed" || undefined, "post-fault worker interruption", 30000, 500);
    expect(await samples(interrupted)).toEqual(prefix);
    const failed = await report(interrupted);
    expect(failed.challenge?.status).toBe("not-evaluated");
    expect(failed.experimentTrace).toMatchObject({ status: "incomplete", actualLast: 100, missingRanges: [{ start: 101, end: 135 }],
      observation: { sampleCount: 10, system: { healthAtEvaluation: null } } });
  } catch (error) { await probe.close().catch(() => {}); throw error; }
  return { source, improved: improved.id, early, interrupted, exactLaterEvaluation: true, gapsQualified: true, noResume: true };
}
