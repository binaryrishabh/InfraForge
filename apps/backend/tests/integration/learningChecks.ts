import { expect } from "bun:test";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { tier } from "../challengeHarness";
import type { DesignChangeReview } from "@infraforge/contracts/reports";

export async function checkLearningExperiments(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
    const aliceCookie = harness.cookie, bob = await sessions.createCredential();
    const challenge = "first-production-api", base = `/challenges/${challenge}`;
    const prediction = { answers: { health: "healthy", busiest: "Database" }, reasoning: "My initial expectation" };
    const workspace = (await harness.request(`${base}/workspace`, {}, "POST", 201)).designId;
    designs.push(workspace);
    await harness.request(`/infrastructure/${workspace}`, { layout: { ...tier(1), layoutVersion: 3 } }, "PUT");
    const source = (await harness.request(`${base}/attempts`, { infrastructureId: workspace, prediction }, "POST", 201)).createdDeployment;
    runs.push(source.id);
    const read = async (id: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
    const finish = async (id: string) => {
      await until(async () => (await read(id)).status === "live" || undefined, "learning attempt live", 30000, 100);
      await harness.request(`/deployments/${id}/speed`, { speed: 60 }, "POST", 202);
      return until(async () => { const row = await read(id); return row.status === "torn-down" ? row : undefined; }, "learning attempt evaluated", 30000, 100);
    };
    await finish(source.id);
    const report = (await harness.request(`/deployments/${source.id}/report`)).report;
    expect(report.challenge.status).toBe("not-met"); expect(report.guidedReview.canImprove).toBe(true);
    expect(report.guidedReview.cues[0].kind).toBe("requirement");
    // Delete the design: the improvement still starts from immutable inputs.
    await harness.request(`/infrastructure/${workspace}`, undefined, "DELETE");
    const copy = (await harness.request(`${base}/improvement-workspace`, { sourceRunId: source.id }, "POST", 201)).infrastructure;
    designs.push(copy.id);
    expect(copy.layout.resources).toEqual(source.runInputs.resources); expect(copy.challengeVersion).toBe(1);
    const preview = async (layout: object): Promise<DesignChangeReview> => (await harness.request(`${base}/improvement-preview`, { sourceRunId: source.id, infrastructureId: copy.id, layout }, "POST")).review;
    const unchanged = await preview(copy.layout); expect(unchanged.classification).toBe("no-change");
    const hypothesis = "I expect changing one app server size to change the recorded health.";
    const intent = { sourceRunId: source.id, hypothesis, intent: "improvement", inputHash: unchanged.inputHash, acknowledgeMultiple: false };
    const start = (improvement: object, status: number, newPrediction: object = prediction) => harness.request(`${base}/attempts`, { infrastructureId: copy.id, prediction: newPrediction, improvement }, "POST", status);
    const count = async () => (await harness.sql.query('SELECT (SELECT count(*) FROM "Deployment") AS runs, (SELECT count(*) FROM "Outbox") AS events')).rows[0];
    const before = await count();
    await start(intent, 409); // No-change cannot masquerade as improvement.
    await start({ ...intent, hypothesis: "x".repeat(401) }, 400);
    await harness.request("/challenges/cache-matters/improvement-workspace", { sourceRunId: source.id }, "POST", 409);
    harness.cookie = bob.cookie;
    await harness.request(`${base}/improvement-workspace`, { sourceRunId: source.id }, "POST", 404);
    await harness.request(`${base}/improvement-preview`, { sourceRunId: source.id, infrastructureId: copy.id, layout: copy.layout }, "POST", 404);
    await start(intent, 404); // No database or outbox mutation by the other owner.
    harness.cookie = aliceCookie; expect(await count()).toEqual(before);
    const changed = structuredClone(copy.layout); changed.resources.find((r: { id: string }) => r.id === "vm1").skuId = "c5.large";
    const one = await preview(changed); expect(one).toMatchObject({ classification: "one-change", count: 1 });
    await harness.request(`/infrastructure/${copy.id}`, { layout: changed }, "PUT");
    await start({ ...intent, inputHash: unchanged.inputHash }, 409); // Reviewed hash is stale.
    await start({ ...intent, inputHash: one.inputHash }, 400, { answers: {}, reasoning: null });
    const freshPrediction = { answers: { health: "degraded", busiest: "Virtual Machine" }, reasoning: "A new independent expectation" };
    const improved = (await start({ ...intent, inputHash: one.inputHash }, 201, freshPrediction)).createdDeployment;
    runs.push(improved.id);
    expect(improved.challengePrediction).toEqual(freshPrediction);
    for (const key of ["challengeId", "challengeVersion", "challengeSpecHash", "evaluationStopAtSimulatedSeconds", "challengeExperiment", "seed"]) expect(improved[key]).toEqual(source[key]);
    expect(improved.runInputs.workloadProfile).toEqual(source.runInputs.workloadProfile);
    expect(improved).toMatchObject({ improvementSourceId: source.id, learningHypothesis: hypothesis, learningIntent: "improvement", sourceRunId: null, rerunMode: null });
    await expect(harness.sql.query('UPDATE "Deployment" SET "learningHypothesis"=\'Changed after run\' WHERE id=$1', [improved.id])).rejects.toThrow("immutable");
    await expect(harness.sql.query('UPDATE "Deployment" SET "improvementSourceId"=$1 WHERE id=$2', [improved.id, source.id])).rejects.toThrow("immutable");
    await finish(improved.id);
    const comparison = (await harness.request(`/deployments/compare?a=${source.id}&b=${improved.id}`)).comparison;
    expect(comparison).toMatchObject({ challengeConditions: "same", lineage: "source-and-improvement", designChangeReview: { count: 1, classification: "one-change" } });
    expect((await harness.request(`/deployments/${improved.id}/report`)).report.run.learning.sourceRunId).toBe(source.id);
    const several = structuredClone(changed); several.resources.find((r: { id: string }) => r.id === "vm1").encryption = true;
    const multiple = await preview(several); expect(multiple.classification).toBe("several-changes");
    await harness.request(`/infrastructure/${copy.id}`, { layout: several }, "PUT");
    await start({ ...intent, inputHash: multiple.inputHash }, 409);
    const multi = (await start({ ...intent, inputHash: multiple.inputHash, acknowledgeMultiple: true }, 201)).createdDeployment;
    runs.push(multi.id);
    await finish(multi.id);
    // An unchanged repeat is explicit, still a challenge, with fresh prediction.
    await harness.request(`/infrastructure/${copy.id}`, { layout: copy.layout }, "PUT");
    const repeat = (await start({ ...intent, intent: "repeat", inputHash: unchanged.inputHash }, 201)).createdDeployment;
    runs.push(repeat.id);
    await finish(repeat.id);
    expect((await harness.request(`/deployments/${source.id}/family`)).family.reruns.map((r: { run: { id: string } }) => r.run.id)).toEqual(expect.arrayContaining([improved.id, multi.id, repeat.id]));
    // Source deletion safely nulls only its FK; hypotheses and the child survive.
    await harness.sql.query('DELETE FROM "Deployment" WHERE id=$1', [source.id]);
    const retained = (await harness.request(`/deployments/${improved.id}/report`)).report;
    expect(retained.run.learning).toEqual({ sourceRunId: null, intent: "improvement", hypothesis });
    return { source: source.id, improvement: improved.id, multiple: multi.id, repeat: repeat.id };
}
