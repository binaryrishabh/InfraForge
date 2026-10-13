import { expect } from "bun:test";
import WebSocket from "ws";
import type { RunAction } from "@infraforge/contracts/actions";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { layout, workload } from "./scenario";

export async function checkReliableEvidence(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const cookie = harness.cookie;
  const name = "Evidence original design";
  const design = (await harness.request("/infrastructure", { name, layout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const created = (await harness.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 201)).createdDeployment;
  const id = created.id; runs.push(id);
  const run = async () => (await harness.request(`/deployments/${id}`)).deployment;
  const action = async (actionId: string): Promise<RunAction> => (await harness.request(`/deployments/${id}/actions/${actionId}`)).action;
  const report = async (): Promise<RunReport> => (await harness.request(`/deployments/${id}/report`)).report;
  const requested = async (path: string, parameters: unknown): Promise<RunAction> => {
    const response = await harness.request(`/deployments/${id}/${path}`, parameters, "POST", 202);
    expect(response.action.status).toBe("requested");
    expect(response.action.appliedAt).toBeNull();
    return response.action;
  };
  const applied = async (a: RunAction) => until(async () => {
    const current = await action(a.id);
    return ["running", "completed", "failed", "cancelled"].includes(current.status) ? current : undefined;
  }, `${a.kind} application`);
  const complete = async (a: RunAction) => until(async () => {
    const current = await action(a.id);
    return current.status === "completed" ? current : undefined;
  }, `${a.kind} completion`);
  await until(async () => (await run()).status === "live" || undefined, "evidence run live");
  await complete(await requested("speed", { speed: 0 }));
  await harness.request(`/infrastructure/${design.id}`, { name: "Renamed saved design" }, "PUT");
  expect((await report()).run.infrastructureName).toBe(name);
  expect((await report()).provenance).toMatchObject({ inputVersion: 2, simulationModelVersion: "1", catalogSnapshot: "2026-08" });
  const count = async () => Number((await harness.sql.query('SELECT count(*) FROM "RunAction" WHERE "deploymentId"=$1', [id])).rows[0].count);
  const beforeInvalid = await count();
  for (const [path, parameters] of [["chaos", { type: "crash", resourceId: "missing" }],
    ["scale-vertical", { resourceId: "vm-a", skuId: "db.m5.large" }], ["scale-pool", { lbId: "dns", delta: 1 }],
    ["scale-pool", { lbId: "constructor", delta: 1 }]] as const) {
    await harness.request(`/deployments/${id}/${path}`, parameters, "POST", 400);
  }
  expect(await count()).toBe(beforeInvalid);
  const bob = await sessions.create();
  try {
    harness.cookie = bob.cookie;
    await harness.request(`/deployments/${id}/load`, { targetLoadFraction: 1 }, "POST", 404);
  } finally { harness.cookie = cookie; }
  expect(await count()).toBe(beforeInvalid);

  // A real Redis publication denial cannot lose a PostgreSQL-backed control.
  const access = await harness.redis.call("ACL", "GETUSER", "default") as unknown[];
  const permissions = access[access.indexOf("commands") + 1];
  if (typeof permissions !== "string") throw new Error("Owned Redis permissions unavailable");
  let first: RunAction;
  try {
    await harness.redis.call("ACL", "SETUSER", "default", "-publish");
    first = await complete(await requested("load", { targetLoadFraction: 0.5 }));
    expect(first.outcome).toEqual({ previousTarget: 1, appliedTarget: 0.5 });
  } finally { await harness.redis.call("ACL", "SETUSER", "default", ...permissions.split(" ")); }
  const ordered = await Promise.all([0.2, 0.4, 0.6, 0.8, 1].map((targetLoadFraction) => requested("load", { targetLoadFraction })));
  const completed = (await Promise.all(ordered.map(complete))).sort((a, b) => a.sequence - b.sequence);
  let previous = 0.5;
  for (const [index, a] of completed.entries()) {
    expect(a.sequence).toBe(first!.sequence + index + 1);
    expect(a.outcome?.previousTarget).toBe(previous);
    previous = a.outcome!.appliedTarget!;
  }

  const probe = async (kind: string, status: string, operation: () => Promise<void>, scopeId = id) => {
    await harness.sql.query("CREATE SEQUENCE evidence_action_probe_seq");
    await harness.sql.query(`CREATE FUNCTION evidence_action_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."deploymentId" = '${scopeId}' AND NEW.kind = '${kind}' AND NEW.status = '${status}' THEN
        PERFORM nextval('evidence_action_probe_seq'); RAISE EXCEPTION 'owned action write failure'; END IF; RETURN NEW; END $$`);
    await harness.sql.query('CREATE TRIGGER evidence_action_probe BEFORE UPDATE ON "RunAction" FOR EACH ROW EXECUTE FUNCTION evidence_action_probe()');
    try { await operation(); } finally {
      await harness.sql.query('DROP TRIGGER evidence_action_probe ON "RunAction"');
      await harness.sql.query('DROP FUNCTION evidence_action_probe()');
      await harness.sql.query('DROP SEQUENCE evidence_action_probe_seq');
    }
  };
  let edit!: RunAction;
  const changed = { resources: [...layout.resources, { id: "evidence-storage", type: "Object Storage", x: 800, y: 0 }], connectionLines: layout.connectionLines };
  await probe("topology", "applying", async () => {
    edit = await requested("sync-topology", { ...changed, expectedRevision: 0 });
    await until(async () => (await harness.sql.query('SELECT is_called FROM evidence_action_probe_seq')).rows[0].is_called || undefined, "topology claim failure");
    const pending = await report();
    expect(pending.run.topologyRevision).toBe(1);
    expect(pending.actions.find((a) => a.id === edit.id)).toMatchObject({ status: "requested", appliedAt: null });
    expect(pending.actions.find((a) => a.id === edit.id)?.outcome).toBeNull();
    expect(pending.topology.original?.resources.some((r) => r.id === "evidence-storage")).toBe(false);
  });
  expect((await complete(edit)).outcome).toEqual({ acceptedRevision: 1, appliedRevision: 1 });
  await harness.request(`/deployments/${id}/sync-topology`, { ...layout, expectedRevision: 0 }, "POST", 409);

  // The first failed acknowledgement follows memory application. Retrying must keep its original previous target.
  let delayed!: RunAction;
  await probe("load", "completed", async () => {
    delayed = await requested("load", { targetLoadFraction: 0.42 });
    await until(async () => Number((await harness.sql.query('SELECT last_value FROM evidence_action_probe_seq')).rows[0].last_value) >= 2 || undefined,
      "two acknowledgement attempts");
    expect((await action(delayed.id)).status).toBe("applying");
  });
  const once = await complete(delayed);
  expect(once.outcome).toEqual({ previousTarget: previous, appliedTarget: 0.42 });
  await harness.sql.query('UPDATE "RunAction" SET parameters=$1 WHERE id=$2', [JSON.stringify({ targetLoadFraction: 1 }), once.id])
    .then(() => { throw new Error("Action parameters were mutable"); }, (error: Error) => { expect(error.message).toContain("immutable"); });

  const fault = await applied(await requested("chaos", { type: "crash", resourceId: "vm-a" }));
  const vertical = await applied(await requested("scale-vertical", { resourceId: "vm-b", skuId: "m5.xlarge" }));
  const pool = await applied(await requested("scale-pool", { lbId: "lb", delta: 1 }));
  expect([fault.status, vertical.status, pool.status]).toEqual(["running", "running", "running"]);
  const beforeClock = (await action(fault.id)).appliedSimulatedSeconds!;
  await complete(await requested("speed", { speed: 60 }));
  const ended = await complete(fault);
  await complete(await requested("speed", { speed: 0 }));
  expect(ended.completedSimulatedSeconds).toBe(beforeClock + fault.outcome!.durationSimulatedSeconds!);
  expect(ended.outcome?.faultEnded).toBe(true);
  expect((await complete(vertical)).outcome).toMatchObject({ installedSkuId: "m5.xlarge", online: true });
  expect((await complete(pool)).outcome?.finalReplicaCount).toBe(3);
  const drain = await applied(await requested("scale-pool", { lbId: "lb", delta: -1 }));
  await complete(await requested("speed", { speed: 10 }));
  expect((await complete(drain)).outcome?.finalReplicaCount).toBe(2);
  await complete(await requested("speed", { speed: 0 }));
  let stop!: RunAction;
  let acknowledgementBlockedAt = 0;
  await probe("teardown", "completed", async () => {
    stop = await requested("teardown", {});
    const duplicate = await harness.request(`/deployments/${id}/teardown`, {}, "POST", 202);
    expect(duplicate.action.id).toBe(stop.id);
    await until(async () => Number((await harness.sql.query('SELECT last_value FROM evidence_action_probe_seq')).rows[0].last_value) >= 2 || undefined,
      "two terminal acknowledgement attempts");
    expect((await action(stop.id)).status).toBe("applying");
    const pendingStop = await run();
    expect(pendingStop.status).toBe("live");
    expect(pendingStop.runtimeActive).toBe(true);
    expect(pendingStop.terminalSnapshot).toBeNull();
    acknowledgementBlockedAt = Date.now();
  });
  const stopped = await complete(stop);
  // The retry persists the original capture, not a fabricated later measurement time.
  expect(Date.parse(stopped.outcome!.capturedAt!)).toBeLessThan(acknowledgementBlockedAt);
  const final = await run();
  expect(final.status).toBe("torn-down");
  expect(final.runtimeActive).toBe(false);
  expect(final.terminalSnapshot).toMatchObject({ kind: "terminal", topologyRevision: 1, capturedAt: stopped.outcome?.capturedAt,
    simulatedSeconds: stopped.completedSimulatedSeconds, installedSkus: { "vm-b": "m5.xlarge" } });
  expect((await harness.request(`/deployments/${id}/teardown`, {}, "POST", 200)).action.id).toBe(stop.id);
  const finalReport = await report();
  expect(finalReport.terminal?.capturedAt).toBe(final.terminalSnapshot.capturedAt);
  expect(finalReport.terminal?.simulatedSeconds).toBe(final.terminalSnapshot.simulatedSeconds);
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
    await harness.request(`/deployments/${id}/actions/${stop.id}`, undefined, "GET", 404);
    expect((await harness.request("/deployments/history")).runs.some((r: { id: string }) => r.id === id)).toBe(false);
  } finally { harness.cookie = cookie; }

  const offlineDesign = (await harness.request("/infrastructure", { name: "Unavailable simulator", layout }, "POST", 201)).createdInfrastructure;
  designs.push(offlineDesign.id);
  const offline = (await harness.request("/deployments", { infrastructureId: offlineDesign.id }, "POST", 201)).createdDeployment;
  runs.push(offline.id);
  await until(async () => (await harness.request(`/deployments/${offline.id}`)).deployment.status === "live" || undefined, "offline fixture live");
  let uncertain!: RunAction;
  await probe("load", "completed", async () => {
    uncertain = (await harness.request(`/deployments/${offline.id}/load`, { targetLoadFraction: 0.77 }, "POST", 202)).action;
    await until(async () => Number((await harness.sql.query('SELECT last_value FROM evidence_action_probe_seq')).rows[0].last_value) >= 2 || undefined,
      "application with unavailable acknowledgement");
    expect((await harness.request(`/deployments/${offline.id}/actions/${uncertain.id}`)).action.status).toBe("applying");
    await harness.stop("worker");
  }, offline.id);
  const unavailable = await harness.request(`/deployments/${offline.id}/teardown`, {}, "POST", 202);
  const noSimulator = (await harness.request(`/deployments/${offline.id}`)).deployment;
  expect(noSimulator.status).toBe("live");
  expect(noSimulator.terminalSnapshot).toBeNull();
  expect(unavailable.action.appliedAt).toBeNull();
  expect((await harness.request(`/deployments/${offline.id}/teardown`, {}, "POST", 202)).action.id).toBe(unavailable.action.id);
  await harness.request(`/infrastructure/${offlineDesign.id}`, undefined, "DELETE", 409);
  await harness.startWorker();
  await until(async () => (await harness.request(`/deployments/${offline.id}`)).deployment.status === "failed" || undefined, "interrupted offline run");
  const interrupted = (await harness.request(`/deployments/${offline.id}/actions/${unavailable.action.id}`)).action;
  expect(interrupted.status).toBe("failed");
  expect(interrupted.appliedAt).toBeNull();
  const notReplayed = (await harness.request(`/deployments/${offline.id}/actions/${uncertain.id}`)).action;
  expect(notReplayed.status).toBe("failed");
  expect(notReplayed.appliedAt).toBeNull();
  expect(notReplayed.failureReason).toContain("not replayed");
  expect((await harness.request(`/deployments/${offline.id}`)).deployment.terminalSnapshot).toBeNull();
  return { redisPublicationIndependent: true, stableOrder: completed.map((a) => a.sequence), acknowledgementRetryAppliedOnce: once,
    chaos: ended, vertical: await action(vertical.id), pool: await action(pool.id), exactTerminal: final.terminalSnapshot,
    retainedReport: retained, unavailableTeardownFailsOnRestart: true };
}
