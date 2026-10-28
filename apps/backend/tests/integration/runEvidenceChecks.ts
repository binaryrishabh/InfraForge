import { expect } from "bun:test";
import WebSocket from "ws";
import type { RunAction } from "@infraforge/contracts/actions";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { layout, workload } from "./scenario";

/* The server applies a browser run's actions through its durable action path while it replays. Each action is
recorded in order and applied once, even when its acknowledgement fails and is retried or Redis cannot publish,
and a replay cut short by a worker restart fails plainly instead of being guessed at. */
export async function checkReliableEvidence(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const cookie = harness.cookie;
  const name = "Evidence original design";
  const design = (await harness.request("/infrastructure", { name, layout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const created = (await harness.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 201)).createdDeployment;
  const id = created.id; runs.push(id);
  const row = async (runId = id) => (await harness.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [runId])).rows[0];
  const report = async (): Promise<RunReport> => (await harness.request(`/deployments/${id}/report`)).report;
  const actions = async (runId = id): Promise<RunAction[]> => (await harness.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 ORDER BY sequence', [runId])).rows;
  await until(async () => (await row()).status === "browser" || undefined, "evidence run in the browser", 30_000, 500);
  await harness.request(`/infrastructure/${design.id}`, { name: "Renamed saved design" }, "PUT");
  expect((await report()).run.infrastructureName).toBe(name);
  expect((await report()).provenance).toMatchObject({ inputVersion: 2, simulationModelVersion: "2", catalogSnapshot: "2026-08" });

  // Nothing reaches a waiting run except its own browser's submission, and only valid submissions are taken.
  for (const [path, parameters] of [["load", { targetLoadFraction: 1 }], ["chaos", { type: "crash", resourceId: "vm-a" }], ["speed", { speed: 60 }]] as const) {
    await harness.request(`/deployments/${id}/${path}`, parameters, "POST", 409);
  }
  for (const invalid of [{ stopAtSecond: 0, actions: [] }, { stopAtSecond: 901, actions: [] }, { stopAtSecond: 10, actions: [], extra: true },
    { stopAtSecond: 10, actions: [{ atSecond: 11, request: { kind: "load", parameters: { targetLoadFraction: 1 } } }] },
    { stopAtSecond: 10, actions: [{ atSecond: 5, request: { kind: "vertical-scale", parameters: { resourceId: "vm-a", skuId: "m5.xlarge" } } }] }]) {
    await harness.request(`/deployments/${id}/submit`, invalid, "POST", 400);
  }
  const bob = await sessions.create();
  try {
    harness.cookie = bob.cookie;
    await harness.request(`/deployments/${id}/submit`, { stopAtSecond: 10, actions: [] }, "POST", 404);
    await harness.request(`/deployments/${id}/browser-run`, undefined, "GET", 404);
  } finally { harness.cookie = cookie; }
  expect(await actions()).toEqual([]);

  const probe = async (runId: string, operation: () => Promise<void>) => {
    await harness.sql.query("CREATE SEQUENCE evidence_action_probe_seq");
    await harness.sql.query(`CREATE FUNCTION evidence_action_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."deploymentId" = '${runId}' AND NEW.kind = 'load' AND NEW.status = 'completed' THEN
        PERFORM nextval('evidence_action_probe_seq'); RAISE EXCEPTION 'owned action write failure'; END IF; RETURN NEW; END $$`);
    await harness.sql.query('CREATE TRIGGER evidence_action_probe BEFORE UPDATE ON "RunAction" FOR EACH ROW EXECUTE FUNCTION evidence_action_probe()');
    try { await operation(); } finally {
      await harness.sql.query('DROP TRIGGER evidence_action_probe ON "RunAction"');
      await harness.sql.query('DROP FUNCTION evidence_action_probe()');
      await harness.sql.query('DROP SEQUENCE evidence_action_probe_seq');
    }
  };
  const attempts = async () => Number((await harness.sql.query('SELECT last_value FROM evidence_action_probe_seq')).rows[0].last_value);
  const load = (atSecond: number, targetLoadFraction: number) => ({ atSecond, request: { kind: "load", parameters: { targetLoadFraction } } });
  const submitted = [load(1, 0.5), ...[0.2, 0.4, 0.6, 0.8, 1].map((target, i) => load(2 + i, target)),
    { atSecond: 7, request: { kind: "chaos", parameters: { type: "crash", resourceId: "vm-a" } } }];

  // Redis cannot publish during the whole replay, and the first load's acknowledgement fails twice.
  const access = await harness.redis.call("ACL", "GETUSER", "default") as unknown[];
  const permissions = access[access.indexOf("commands") + 1];
  if (typeof permissions !== "string") throw new Error("Owned Redis permissions unavailable");
  try {
    await harness.redis.call("ACL", "SETUSER", "default", "-publish");
    await probe(id, async () => {
      await harness.request(`/deployments/${id}/submit`, { stopAtSecond: 60, actions: submitted }, "POST", 202);
      await until(async () => (await attempts()) >= 2 || undefined, "two acknowledgement attempts", 60_000, 250);
      const pending = await actions();
      expect(pending.filter((a) => a.kind === "load")).toHaveLength(1);
      expect(pending[0]).toMatchObject({ status: "applying", appliedSimulatedSeconds: null });
      // The learner cannot stop or steer a run the server is replaying.
      await harness.request(`/deployments/${id}/teardown`, {}, "POST", 409);
      await harness.request(`/deployments/${id}/submit`, { stopAtSecond: 10, actions: [] }, "POST", 409);
    });
    await until(async () => (await row()).status === "torn-down" || undefined, "replay recorded without Redis", 120_000, 500);
  } finally { await harness.redis.call("ACL", "SETUSER", "default", ...permissions.split(" ")); }

  const final = await row();
  expect(final).toMatchObject({ runtimeActive: false, terminalSnapshot: { kind: "terminal", simulatedSeconds: 60, topologyRevision: 0 } });
  const recorded = await actions();
  expect<unknown>(recorded.map((a) => [a.kind, a.status, a.appliedSimulatedSeconds])).toEqual([...submitted.map((a) => [a.request.kind, "completed", a.atSecond]), ["teardown", "completed", 60]]);
  expect(recorded.map((a) => a.sequence)).toEqual(recorded.map((_, i) => i + 1));
  // Each load was applied once, in order: every outcome starts from the target the previous one set.
  let previous = 1;
  for (const a of recorded.filter((r) => r.kind === "load")) {
    expect(a.outcome).toEqual({ previousTarget: previous, appliedTarget: (a.parameters as { targetLoadFraction: number }).targetLoadFraction });
    previous = a.outcome!.appliedTarget!;
  }
  const fault = recorded.find((a) => a.kind === "chaos")!;
  expect(fault).toMatchObject({ completedSimulatedSeconds: 37, outcome: { durationSimulatedSeconds: 30, faultEnded: true } });
  expect(recorded.at(-1)!.parameters).toEqual({});
  await harness.sql.query('UPDATE "RunAction" SET parameters=$1 WHERE id=$2', [JSON.stringify({ targetLoadFraction: 1 }), recorded[0]!.id])
    .then(() => { throw new Error("Action parameters were mutable"); }, (error: Error) => { expect(error.message).toContain("immutable"); });
  const finalReport = await report();
  expect(finalReport.terminal?.capturedAt).toBe(final.terminalSnapshot.capturedAt);
  expect(finalReport.terminal?.simulatedSeconds).toBe(60);
  await harness.request(`/infrastructure/${design.id}`, undefined, "DELETE");
  const retained = await report();
  expect(retained.run.infrastructureId).toBeNull();
  expect(retained.run.infrastructureName).toBe(name);
  expect(retained.actions).toEqual(finalReport.actions);
  const subscribe = async (sessionCookie: string) => {
    const socket = new WebSocket("ws://localhost:3001", { headers: { Origin: harness.origin, Cookie: sessionCookie } });
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.send(JSON.stringify({ type: "subscribe", deploymentId: id }));
    return socket;
  };
  const ownerSocket = await subscribe(cookie);
  let otherSocket: WebSocket | undefined;
  try {
    await until(async () => Number((await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`))[1]) === 1 || undefined,
      "deleted-design owner subscription");
    otherSocket = await subscribe(bob.cookie);
    const closed = await new Promise<number>((resolve) => otherSocket!.once("close", resolve));
    expect(closed).toBe(1008);
    expect(Number((await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`))[1])).toBe(1);
  } finally { ownerSocket.terminate(); otherSocket?.terminate(); }
  try {
    harness.cookie = bob.cookie;
    await harness.request(`/deployments/${id}/report`, undefined, "GET", 404);
    await harness.request(`/deployments/${id}/actions/${recorded[0]!.id}`, undefined, "GET", 404);
    expect((await harness.request("/deployments/history")).runs.some((r: { id: string }) => r.id === id)).toBe(false);
  } finally { harness.cookie = cookie; }

  // A worker restart in the middle of a replay fails the run; the action it was applying is not replayed.
  const offlineDesign = (await harness.request("/infrastructure", { name: "Unavailable simulator", layout }, "POST", 201)).createdInfrastructure;
  designs.push(offlineDesign.id);
  const offline = (await harness.request("/deployments", { infrastructureId: offlineDesign.id }, "POST", 201)).createdDeployment;
  runs.push(offline.id);
  await until(async () => (await row(offline.id)).status === "browser" || undefined, "offline fixture in the browser", 30_000, 500);
  await probe(offline.id, async () => {
    await harness.request(`/deployments/${offline.id}/submit`, { stopAtSecond: 60, actions: [load(5, 0.77)] }, "POST", 202);
    await until(async () => (await attempts()) >= 2 || undefined, "application with unavailable acknowledgement", 60_000, 250);
    expect((await actions(offline.id))[0]!.status).toBe("applying");
    await harness.stop("worker");
  });
  expect((await row(offline.id))).toMatchObject({ status: "live", terminalSnapshot: null });
  await harness.request(`/infrastructure/${offlineDesign.id}`, undefined, "DELETE", 409);
  await harness.startWorker();
  await until(async () => (await row(offline.id)).status === "failed" || undefined, "interrupted replay", 20_000, 500);
  const notReplayed = (await actions(offline.id))[0]!;
  expect(notReplayed.status).toBe("failed");
  expect(notReplayed.failureReason).toContain("not replayed");
  expect((await row(offline.id)).terminalSnapshot).toBeNull();
  return { redisPublicationIndependent: true, stableOrder: recorded.map((a) => a.sequence), acknowledgementRetryAppliedOnce: recorded[0],
    chaos: fault, exactTerminal: final.terminalSnapshot, retainedReport: retained, interruptedReplayFails: true };
}
