import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import { computeHourlyBurnRateUsd } from "@infraforge/simulation/cost";
import type { RunComparison, RerunOptions } from "@infraforge/contracts/reports";
import { captureRunInputs, engineSeed } from "../../deployments/runInputs";
import { captureSnapshot } from "../../simulator/snapshot";
import type { SimulationInstance } from "../../simulator/instance";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { layout, workload } from "./scenario";

export async function checkHonestReruns(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const cookie = harness.cookie;
  const design = (await harness.request("/infrastructure", { name: "Rerun source", layout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const input = { ...captureRunInputs(layout, workload), seed: "exact-stop-integration" };
  const source = randomUUID(); runs.push(source);
  let state = createInitialState(source, input.resources, input.connectionLines, input.workloadProfile, engineSeed(input.seed));
  let cost = 0;
  for (let i = 0; i < 620; i++) { state = tick(state, {}).state; cost += computeHourlyBurnRateUsd(state) / 3600; }
  const instance: SimulationInstance = { state, tickCount: 620, pendingLogs: [], speed: 1, lastCheckpointAt: 0,
    accumulatedCostUsd: cost, topology: layout, topologyRevision: 0, actions: new Map(), acknowledge: null,
    metricsComputedAt: new Date().toISOString(), metricsTopologyRevision: 0 };
  const final = captureSnapshot(source, instance, "terminal");
  // Explicit engine-generated inactive fixture; no hosted data or pretend OAuth.
  await harness.sql.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","terminalSnapshot","updatedAt")
    VALUES ($1,$2,'torn-down',$3,$4,$5,$6,now())`, [source, design.id, input, input.seed, input.workloadProfile, final]);
  const read = async (id: string) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  const options = async (): Promise<RerunOptions> => (await harness.request(`/deployments/${source}/rerun-options`)).options;
  expect((await options()).matchedStop).toMatchObject({ target: 620, defaultEnabled: true });
  const bob = await sessions.create();
  const counts = async () => (await harness.sql.query('SELECT (SELECT count(*) FROM "Deployment") AS runs, (SELECT count(*) FROM "Outbox") AS events, (SELECT count(*) FROM "RunAction") AS actions')).rows[0];
  const before = await counts();
  try {
    harness.cookie = bob.cookie;
    for (const path of ["rerun-options", "family"]) await harness.request(`/deployments/${source}/${path}`, undefined, "GET", 404);
    await harness.request(`/deployments/${source}/reruns`, { mode: "exact", matchedStop: true }, "POST", 404);
  } finally { harness.cookie = cookie; }
  expect(await counts()).toEqual(before);
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
  const live = async (id: string) => until(async () => (await read(id)).status === "live" || undefined, "rerun live", 30000, 500);
  const stopped = async (id: string) => until(async () => {
    const row = await read(id); return row.status === "torn-down" ? row : undefined;
  }, "rerun exact terminal capture", 35000, 500);
  const speed = async (id: string, value: number) => {
    const result = await harness.request(`/deployments/${id}/speed`, { speed: value }, "POST", 202);
    await until(async () => (await harness.sql.query('SELECT status FROM "RunAction" WHERE id=$1', [result.action.id])).rows[0].status === "completed" || undefined, "rerun speed applied", 15000, 500);
  };
  const exact = await create("exact", true);
  expect(exact.runInputs).toEqual(input);
  await live(exact.id);
  await speed(exact.id, 60);
  const queue = new Queue("deployments", { connection: { host: "127.0.0.1", port: harness.settings.redisPort } });
  try {
    // Fresh duplicate job IDs reach the real worker, without altering captured inputs or creating a second simulator.
    for (let i = 0; i < 2; i++) await queue.add("deploy", { deploymentId: exact.id, seed: "stale", layout: {} }, { jobId: randomUUID() });
    const done = await stopped(exact.id);
    expect(done.terminalSnapshot.simulatedSeconds).toBe(620);
    expect(done.runInputs).toEqual(input);
    const actions = (await harness.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [exact.id])).rows;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ parameters: { trigger: "matched-stop" }, status: "completed", appliedSimulatedSeconds: 620, completedSimulatedSeconds: 620 });
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
  await live(current.id); await speed(current.id, 60); await stopped(current.id);
  expect((await read(source)).runInputs).toEqual(input);

  // A failed action insertion and then a failed terminal transaction freeze the same target/capture.
  const delayed = await create("exact", true);
  await harness.sql.query("CREATE SEQUENCE rerun_probe_seq");
  await harness.sql.query(`CREATE FUNCTION rerun_probe() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."deploymentId" = '${delayed.id}' AND NEW.kind='teardown' THEN
      PERFORM nextval('rerun_probe_seq'); RAISE EXCEPTION 'owned matched stop action failure'; END IF; RETURN NEW; END $$`);
  await harness.sql.query('CREATE TRIGGER rerun_probe BEFORE INSERT ON "RunAction" FOR EACH ROW EXECUTE FUNCTION rerun_probe()');
  let capturedBeforeRetry: Date;
  try {
    await live(delayed.id); await speed(delayed.id, 60);
    await until(async () => Number((await harness.sql.query('SELECT last_value FROM rerun_probe_seq')).rows[0].last_value) >= 2 || undefined, "matched-stop insertion retries", 35000, 500);
    expect((await read(delayed.id)).terminalSnapshot).toBeNull();
    capturedBeforeRetry = (await harness.sql.query('SELECT now() AS at')).rows[0].at;
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
  expect(recovered.terminalSnapshot.simulatedSeconds).toBe(620);
  expect(new Date(recovered.terminalSnapshot.capturedAt).getTime()).toBeLessThan(capturedBeforeRetry!.getTime());
  expect((await harness.sql.query('SELECT count(*) FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [delayed.id])).rows[0].count).toBe("1");

  const manual = await create("exact", true);
  await live(manual.id);
  await harness.request(`/deployments/${manual.id}/teardown`, { trigger: "matched-stop" }, "POST", 202);
  const early = await stopped(manual.id);
  expect(early.terminalSnapshot.simulatedSeconds).toBeLessThan(620);
  expect((await harness.sql.query('SELECT parameters FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [manual.id])).rows[0].parameters).toEqual({});
  const earlyComparison: RunComparison = (await harness.request(`/deployments/compare?a=${source}&b=${manual.id}`)).comparison;
  expect(earlyComparison.costs[1]!.delta).toBeNull();
  expect(earlyComparison.observed.some((fact) => fact.message.includes("matched stop was not reached"))).toBe(true);

  await harness.request(`/infrastructure/${design.id}`, undefined, "DELETE");
  const detached = await create("exact", true);
  expect(detached.infrastructureId).toBeNull();
  expect(detached.runName).toBe("Rerun source");
  await live(detached.id); await speed(detached.id, 60); await stopped(detached.id);
  await harness.request(`/deployments/${source}/reruns`, { mode: "current-design", matchedStop: false, expectedInputHash: stale }, "POST", 409);
  const family = (await harness.request(`/deployments/${source}/family`)).family;
  expect(family.reruns.map((item: any) => item.run.id)).toContain(detached.id);
  expect(family.reruns.find((item: any) => item.run.id === current.id).starting.grade).toBe("one-change-design");
  return { source, exact: exact.id, current: current.id, delayed: delayed.id, manual: manual.id, detached: detached.id,
    target: 620, exactStops: 4, insertionAndTerminalRetries: true, originalCapturePreserved: true, crossOwnerNoMutation: true };
}
