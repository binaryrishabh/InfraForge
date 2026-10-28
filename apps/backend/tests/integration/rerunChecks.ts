import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import type { RunComparison, RerunOptions } from "@infraforge/contracts/reports";
import { captureRunInputs } from "../../deployments/runInputs";
import { captureSnapshot } from "../../simulator/snapshot";
import { createModel2Engine } from "../../simulator/model2Engine";
import { buildModel2Contract } from "../../simulator/contractBuilder";
import type { SimulationInstance } from "../../simulator/instance";
import { submitBrowserRun } from "./browserRunChecks";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { layout, workload } from "./scenario";
import { checkCanvasPreview } from "./improveChecks";

export async function checkHonestReruns(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[], eventsFor: (id: string) => Record<string, any>[]) {
  const cookie = harness.cookie;
  const design = (await harness.request("/infrastructure", { name: "Rerun source", layout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const input = { ...captureRunInputs(layout, workload), seed: "exact-stop-integration" };
  const source = randomUUID(); runs.push(source);
  // The source ran 120 simulated seconds with no actions, exactly as the server replays a run.
  const model2 = createModel2Engine(input, 120, buildModel2Contract);
  let cost = 0;
  for (let i = 0; i < 120; i++) { model2.advance(); cost += model2.burnRatePerHourUsd() / 3600; }
  const instance: SimulationInstance = { model2, tickCount: 120, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: cost, topology: layout, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: new Date().toISOString(), metricsTopologyRevision: 0 };
  const final = captureSnapshot(source, instance, "terminal");
  // Explicit engine-generated inactive fixture; no hosted data or pretend OAuth.
  await harness.sql.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","terminalSnapshot","updatedAt")
    VALUES ($1,$2,'torn-down',$3,$4,$5,$6,now())`, [source, design.id, input, input.seed, input.workloadProfile, final]);
  const read = async (id: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  const options = async (): Promise<RerunOptions> => (await harness.request(`/deployments/${source}/rerun-options`)).options;
  expect((await options()).matchedStop).toMatchObject({ target: 120, defaultEnabled: true });
  const bob = await sessions.create();
  const counts = async () => (await harness.sql.query('SELECT (SELECT count(*) FROM "Deployment") AS runs, (SELECT count(*) FROM "Outbox") AS events, (SELECT count(*) FROM "RunAction") AS actions')).rows[0];
  const before = await counts();
  try {
    harness.cookie = bob.cookie;
    for (const path of ["rerun-options", "family"]) await harness.request(`/deployments/${source}/${path}`, undefined, "GET", 404);
    await harness.request(`/deployments/${source}/reruns`, { mode: "exact", matchedStop: true }, "POST", 404);
    await harness.request(`/deployments/${source}/rerun-preview`, { layout }, "POST", 404);
  } finally { harness.cookie = cookie; }
  expect(await counts()).toEqual(before);
  for (const variant of [{ ...input, version: 1 }, { ...input, simulationModelVersion: "other" }, { ...input, catalogSnapshot: "other" }]) {
    const id = randomUUID(); runs.push(id);
    await harness.sql.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","updatedAt")
      VALUES ($1,$2,'failed',$3,$4,$5,now())`, [id, design.id, variant, input.seed, input.workloadProfile]);
    expect((await harness.request(`/deployments/${id}/rerun-options`)).options.exact.available).toBe(false);
    await harness.request(`/deployments/${id}/reruns`, { mode: "exact", matchedStop: false }, "POST", 409);
  }
  const create = async (mode: "exact" | "current-design", matchedStop: boolean, hash?: string) => {
    const run = (await harness.request(`/deployments/${source}/reruns`, { mode, matchedStop, ...(hash ? { expectedInputHash: hash } : {}) }, "POST", 201)).createdDeployment;
    runs.push(run.id);
    expect(run.sourceRunId).toBe(source);
    expect(run.seed).toBe(input.seed);
    expect(run.workloadProfile).toEqual(input.workloadProfile);
    // An auto-stop is configuration, never an immediately consumable teardown request.
    expect((await harness.sql.query('SELECT count(*) FROM "RunAction" WHERE "deploymentId"=$1', [run.id])).rows[0].count).toBe("0");
    return run;
  };
  const waiting = async (id: string) => until(async () => (await read(id)).status === "browser" || undefined, "rerun in the browser", 30000, 500);
  const stopped = async (id: string) => until(async () => {
    const row = await read(id); return row.status === "torn-down" ? row : undefined;
  }, "rerun exact terminal capture", 60000, 500);
  // The browser ran the rerun to its matched stop.
  const finish = (id: string) => submitBrowserRun(harness, id, 120);
  const exact = await create("exact", true);
  expect(exact.runInputs).toEqual(input);
  await waiting(exact.id);
  const queue = new Queue("deployments", { connection: { host: "127.0.0.1", port: harness.settings.redisPort } });
  try {
    // Fresh duplicate job IDs reach the real worker, without altering captured inputs or creating a second simulator.
    for (let i = 0; i < 2; i++) await queue.add("deploy", { deploymentId: exact.id, seed: "stale", layout: {} }, { jobId: randomUUID() });
    const done = await finish(exact.id);
    expect(done.terminalSnapshot.simulatedSeconds).toBe(120);
    expect(done.runInputs).toEqual(input);
    const actions = (await harness.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [exact.id])).rows;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ parameters: { trigger: "matched-stop" }, status: "completed", appliedSimulatedSeconds: 120, completedSimulatedSeconds: 120 });
    const comparison: RunComparison = (await harness.request(`/deployments/compare?a=${source}&b=${exact.id}`)).comparison;
    expect(comparison.lineage).toBe("source-and-rerun");
    expect(comparison.headline).toBe("determinism-match");
  } finally { await queue.close(); }

  const changed = structuredClone(layout); changed.resources[2]!.skuId = "m5.xlarge";
  const stale = (await options()).currentDesign.inputHash!;
  await harness.request(`/infrastructure/${design.id}`, { name: "Improved saved design", layout: changed }, "PUT");
  await harness.request(`/deployments/${source}/reruns`, { mode: "current-design", matchedStop: false, expectedInputHash: stale }, "POST", 409);
  const preview = await options();
  expect(preview.currentDesign.preview?.grade).toBe("one-change-design");
  const current = await create("current-design", true, preview.currentDesign.inputHash!);
  expect(current.runInputs.resources[2].skuId).toBe("m5.xlarge");
  expect(current.runName).toBe("Improved saved design");
  await finish(current.id);
  expect((await read(source)).runInputs).toEqual(input);

  // A failed action insertion and then a failed terminal transaction freeze the same target and capture.
  const delayed = await create("exact", true);
  await harness.sql.query("CREATE SEQUENCE rerun_probe_seq");
  await harness.sql.query(`CREATE FUNCTION rerun_probe() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."deploymentId" = '${delayed.id}' AND NEW.kind='teardown' AND NEW.parameters->>'trigger'='matched-stop' THEN
      PERFORM nextval('rerun_probe_seq'); RAISE EXCEPTION 'owned matched stop action failure'; END IF; RETURN NEW; END $$`);
  await harness.sql.query('CREATE TRIGGER rerun_probe BEFORE INSERT ON "RunAction" FOR EACH ROW EXECUTE FUNCTION rerun_probe()');
  let capturedBeforeRetry: Date;
  try {
    await waiting(delayed.id);
    await harness.request(`/deployments/${delayed.id}/submit`, { stopAtSecond: 120, actions: [] }, "POST", 202);
    await until(async () => Number((await harness.sql.query('SELECT last_value FROM rerun_probe_seq')).rows[0].last_value) >= 2 || undefined, "matched-stop insertion retries", 60000, 500);
    expect((await read(delayed.id)).terminalSnapshot).toBeNull();
    capturedBeforeRetry = (await harness.sql.query('SELECT now() AS at')).rows[0].at;
    // The learner cannot stop a run the server is replaying; it finishes by itself.
    await harness.request(`/deployments/${delayed.id}/teardown`, {}, "POST", 409);
    await harness.sql.query(`CREATE FUNCTION rerun_terminal_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${delayed.id}' AND NEW."terminalSnapshot" IS NOT NULL THEN
        PERFORM nextval('rerun_probe_seq'); RAISE EXCEPTION 'owned terminal write failure'; END IF; RETURN NEW; END $$`);
    await harness.sql.query('CREATE TRIGGER rerun_terminal_probe BEFORE UPDATE ON "Deployment" FOR EACH ROW EXECUTE FUNCTION rerun_terminal_probe()');
    await harness.sql.query('DROP TRIGGER rerun_probe ON "RunAction"');
    const attempts = Number((await harness.sql.query('SELECT last_value FROM rerun_probe_seq')).rows[0].last_value);
    await until(async () => Number((await harness.sql.query('SELECT last_value FROM rerun_probe_seq')).rows[0].last_value) >= attempts + 2 || undefined, "terminal write retries", 10000, 500);
    expect((await read(delayed.id)).terminalSnapshot).toBeNull();
  } finally {
    await harness.sql.query('DROP TRIGGER IF EXISTS rerun_probe ON "RunAction"');
    await harness.sql.query('DROP TRIGGER IF EXISTS rerun_terminal_probe ON "Deployment"');
    await harness.sql.query('DROP FUNCTION IF EXISTS rerun_probe()');
    await harness.sql.query('DROP FUNCTION IF EXISTS rerun_terminal_probe()');
    await harness.sql.query('DROP SEQUENCE rerun_probe_seq');
  }
  const recovered = await stopped(delayed.id);
  await until(async () => eventsFor(delayed.id).some((event) => event.publishType === "deployment-torn-down") || undefined, "terminal retry notification", 10000, 100);
  expect(eventsFor(delayed.id).find((event) => event.kind === "terminal")?.simulatedSeconds).toBe(120);
  expect(eventsFor(delayed.id).find((event) => event.kind === "terminal")?.capturedAt).toBe(recovered.terminalSnapshot.capturedAt);
  expect(recovered.terminalSnapshot.simulatedSeconds).toBe(120);
  expect(new Date(recovered.terminalSnapshot.capturedAt).getTime()).toBeLessThan(capturedBeforeRetry!.getTime());
  const stopActions = (await harness.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [delayed.id])).rows;
  expect(stopActions).toHaveLength(1);
  expect(stopActions[0]).toMatchObject({ status: "completed", parameters: { trigger: "matched-stop" } });
  expect(stopActions[0].requestedAt.toISOString()).toBe(recovered.terminalSnapshot.capturedAt);

  // The learner stopped this rerun at second 50, before its matched stop: a plain stop, not a matched one.
  const manual = await create("exact", true);
  const early = await submitBrowserRun(harness, manual.id, 50);
  expect(early.terminalSnapshot.simulatedSeconds).toBe(50);
  expect((await harness.sql.query('SELECT parameters FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [manual.id])).rows[0].parameters).toEqual({});
  const earlyComparison: RunComparison = (await harness.request(`/deployments/compare?a=${source}&b=${manual.id}`)).comparison;
  expect(earlyComparison.costs[1]!.delta).toBeNull();
  expect(earlyComparison.observed.some((fact) => fact.message.includes("matched stop was not reached"))).toBe(true);

  const improved = await checkCanvasPreview(harness, source, design.id, runs);
  await finish(improved);

  await harness.request(`/infrastructure/${design.id}`, undefined, "DELETE");
  const detached = await create("exact", true);
  expect(detached.infrastructureId).toBeNull();
  expect(detached.runName).toBe("Rerun source");
  await finish(detached.id);
  await harness.request(`/deployments/${source}/reruns`, { mode: "current-design", matchedStop: false, expectedInputHash: stale }, "POST", 409);
  const family = (await harness.request(`/deployments/${source}/family`)).family;
  expect(family.reruns.map((item: any) => item.run.id)).toContain(detached.id);
  expect(family.reruns.find((item: any) => item.run.id === current.id).starting.grade).toBe("one-change-design");
  return { source, exact: exact.id, current: current.id, delayed: delayed.id, manual: manual.id, detached: detached.id, improved,
    target: 120, exactStops: 5, canvasPreviewPreserved: true, insertionAndTerminalRetries: true, originalCapturePreserved: true, crossOwnerNoMutation: true };
}
