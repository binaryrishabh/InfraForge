import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Queue } from "bullmq";
import WebSocket from "ws";
import { createInitialState, tick } from "@infraforge/simulation/engine";
import type { SimulationSnapshot } from "@infraforge/contracts/telemetry";
import { ResourceHealth } from "@infraforge/domain/resource";
import { LocalHarness, readLocalSettings, until } from "./localHarness";
import { layout, seed, workload } from "./scenario";
import { engineSeed, captureRunInputs } from "../../deployments/runInputs";
import { SessionFixtures } from "./sessionFixtures";
import { checkUserIsolation } from "./securityChecks";

type Event = Record<string, any>;
type Snapshot = SimulationSnapshot & { publishType: string };
const integration = process.env.INTEGRATION_RUN === "1" ? describe : describe.skip;

integration("local deployment lifecycle", () => {
  test("preserves save, outbox, worker, controls, realtime and restart boundaries", async () => {
    const harness = new LocalHarness(readLocalSettings(process.env));
    const evidence: Record<string, any> = { startedAt: new Date().toISOString(), architecture: layout, workload, seed,
      controls: [], redisEvents: [], wsEvents: [] };
    const infrastructureIds: string[] = [];
    const deploymentIds: string[] = [];
    const sockets: WebSocket[] = [];
    const observer = harness.redis.duplicate({ lazyConnect: true });
    observer.on("error", () => {});
    let queue: Queue | undefined;
    let latest: Snapshot;
    let workerStarted = false;
    let schemaReady = false;
    let actualSeed: string;
    let sessions: SessionFixtures | undefined;
    const editedSavedLayout = { ...layout, resources: [...layout.resources, { id: "saved-only", type: "Object Storage", x: 900, y: 0 }] };
    const evidencePath = join(tmpdir(), `infraforge-integration-${randomUUID()}.json`);
    const phase = (name: string) => {
      evidence.phase = name;
      console.info(`Integration phase: ${name}`);
    };

    const deployment = async (id: string) => (await harness.request(`/deployments/${id}`)).deployment;
    const connectWs = async (id: string) => {
      const socket = new WebSocket("ws://localhost:3001", { headers: harness.headers });
      sockets.push(socket);
      socket.on("message", (raw) => evidence.wsEvents.push(JSON.parse(raw.toString())));
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      socket.send("invalid-json");
      socket.send(JSON.stringify({ type: "subscribe", deploymentId: id }));
      socket.send(JSON.stringify({ type: "subscribe", deploymentId: id }));
      await until(async () => {
        const counts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
        return Number(counts[1]) >= 1 || undefined;
      }, "WebSocket Redis subscription");
      await Bun.sleep(100);
      const counts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
      expect(Number(counts[1])).toBe(1);
      return socket;
    };
    const command = async (id: string, path: string, body: unknown) => {
      const count = evidence.redisEvents.filter((e: Event) => e.channel === "simulator:control").length;
      evidence.controls.push({ beforeTick: latest?.simulatedSeconds ?? null, path, body });
      if (path === "sync-topology") {
        const revision = (await deployment(id)).topologyRevision;
        const response = await harness.request(`/deployments/${id}/${path}`, { ...(body as object), expectedRevision: revision });
        expect(response.topologyRevision).toBe(revision + 1);
        await until(async () => (await deployment(id)).topologyRevision === revision + 1 || undefined, "durable topology edit");
        // Runtime applies durable topology even while the clock is paused.
        await Bun.sleep(1200);
        return;
      }
      const actions: Record<string, string> = { load: "set-load", chaos: "inject-chaos", "scale-vertical": "scale-vertical",
        "scale-pool": "scale-pool", speed: "set-speed", "sync-topology": "sync-topology", teardown: "stop" };
      await harness.request(`/deployments/${id}/${path}`, body);
      const emitted = await until(async () => evidence.redisEvents.filter((e: Event) => e.channel === "simulator:control")
        .slice(count).find((e: Event) => e.event.deploymentId === id && e.event.action === actions[path]), `${path} Redis command`);
      const fields = body as Record<string, any>;
      expect(emitted.event).toEqual({ deploymentId: id, action: actions[path],
        ...(path === "chaos" ? { chaosType: fields.type, resourceId: fields.resourceId } : fields) });
      // There is no control acknowledgement. Pause prevents an engine tick
      // while both the observer and host consume the emitted command.
      await Bun.sleep(100);
    };
    const snapshotAfter = async (id: string, seconds: number, fromEvent = 0) => until(async () => {
      const snapshot = evidence.wsEvents.slice(fromEvent).find((e: Event) => e.deploymentId === id &&
        e.publishType === "simulation-snapshot" && e.simulatedSeconds > seconds);
      return snapshot as Snapshot | undefined;
    }, "next simulation snapshot");
    const advance = async (id: string, speed: 1 | 10 | 60) => {
      const before = latest.simulatedSeconds;
      await command(id, "speed", { speed });
      latest = await snapshotAfter(id, before);
      await command(id, "speed", { speed: 0 });
      expect(latest.simulatedSeconds).toBe(before + speed);
      expect(latest.speed).toBe(speed);
      const raw = evidence.redisEvents.find((e: Event) => e.event.publishType === "simulation-snapshot" &&
        e.event.deploymentId === id && e.event.simulatedSeconds === latest.simulatedSeconds);
      expect(latest).toEqual(raw?.event);
      return latest;
    };

    try {
      phase("prepare");
      await harness.prepare();
      schemaReady = true;
      sessions = new SessionFixtures(harness);
      harness.cookie = (await sessions.create()).cookie;
      const invalidJson = await fetch(harness.api + "/infrastructure", {
        method: "POST", headers: harness.headers, body: "{",
      });
      expect(invalidJson.status).toBe(400);
      expect(await invalidJson.json()).toEqual({ success: false, message: "Invalid JSON body" });
      const oversized = await fetch(harness.api + "/infrastructure", {
        method: "POST", headers: harness.headers, body: JSON.stringify({ name: "x".repeat(110000) }),
      });
      expect(oversized.status).toBe(413);
      await harness.request("/infrastructure", { name: "Malformed layout", layout: { resources: [null] } }, "POST", 400);
      queue = new Queue("deployments", { connection: harness.redis });
      await observer.connect();
      observer.on("pmessage", (_pattern, channel, raw) => evidence.redisEvents.push({ channel, event: JSON.parse(raw) }));
      await observer.psubscribe("deployment:*:updates", "simulator:control");

      const saved = await harness.request("/infrastructure", { name: "Integration architecture", layout }, "POST", 201);
      const infrastructureId = saved.createdInfrastructure.id;
      infrastructureIds.push(infrastructureId);
      expect(saved.success).toBe(true);
      expect(saved.createdInfrastructure.layout).toEqual(layout);
      const read = await harness.request(`/infrastructure/${infrastructureId}`);
      expect(read.infrastructure.layout).toEqual(layout);
      const updated = await harness.request(`/infrastructure/${infrastructureId}`, { name: "Integration saved layout" }, "PUT");
      expect(updated.updatedInfrastructure.name).toBe("Integration saved layout");
      expect(updated.updatedInfrastructure.layout).toEqual(layout);

      // Force failure in the second write, after Deployment INSERT succeeds.
      // The real HTTP transaction must roll back both writes.
      await harness.sql.query(`CREATE FUNCTION integration_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'integration rollback probe'; END $$`);
      await harness.sql.query(`CREATE TRIGGER integration_reject_outbox BEFORE INSERT ON "Outbox"
        FOR EACH ROW EXECUTE FUNCTION integration_reject_outbox()`);
      try {
        await harness.request("/deployments", { infrastructureId, workloadProfile: workload }, "POST", 500);
        const counts = await harness.sql.query(`SELECT (SELECT count(*) FROM "Deployment") AS deployments,
          (SELECT count(*) FROM "Outbox") AS outbox`);
        expect(counts.rows[0]).toEqual({ deployments: "0", outbox: "0" });
      } finally {
        await harness.sql.query('DROP TRIGGER integration_reject_outbox ON "Outbox"');
        await harness.sql.query("DROP FUNCTION integration_reject_outbox()");
      }

      const created = await harness.request("/deployments", { infrastructureId, workloadProfile: workload }, "POST", 201);
      const id = created.createdDeployment.id;
      deploymentIds.push(id);
      expect(created.createdDeployment.status).toBe("pending");
      expect(created.createdDeployment.resourceCount).toBe(layout.resources.length);
      const outbox = await harness.sql.query('SELECT * FROM "Outbox" WHERE payload->>\'deploymentId\' = $1', [id]);
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0].status).toBe("pending");
      expect(outbox.rows[0].payload).toEqual({ deploymentId: id });
      actualSeed = created.createdDeployment.runInputs.seed;
      evidence.capturedInputs = created.createdDeployment.runInputs;
      expect(created.createdDeployment.seed).toBe(actualSeed);
      expect(created.createdDeployment.runInputs.workloadProfile.peakMultiplier).toBe(3);
      expect(created.createdDeployment.liveTopology).toEqual(layout);
      await harness.request(`/infrastructure/${infrastructureId}`, { layout: editedSavedLayout }, "PUT");
      await harness.request(`/infrastructure/${infrastructureId}`, undefined, "DELETE", 409);
      await harness.request("/infrastructure", undefined, "DELETE", 404);
      await expect(harness.sql.query('UPDATE "Deployment" SET "runInputs" = NULL WHERE id = $1', [id])).rejects.toThrow("immutable");
      await expect(harness.sql.query('UPDATE "Deployment" SET seed = $1 WHERE id = $2', ["stale", id])).rejects.toThrow("immutable");
      await expect(harness.sql.query('DELETE FROM "Infrastructure" WHERE id = $1', [infrastructureId])).rejects.toThrow("active");
      // Deliver the same deployment twice through the real outbox poller.
      await harness.sql.query('INSERT INTO "Outbox" (id, "eventType", payload) VALUES ($1, $2, $3)',
        [randomUUID(), "deployment-created", JSON.stringify(outbox.rows[0].payload)]);

      const invalidLayout = { resources: [layout.resources[2]], connectionLines: [] };
      const invalid = await harness.request("/infrastructure", { name: "Invalid isolated VM", layout: invalidLayout }, "POST", 201);
      infrastructureIds.push(invalid.createdInfrastructure.id);
      const invalidDeployment = await harness.request("/deployments", { infrastructureId: invalid.createdInfrastructure.id }, "POST", 201);
      deploymentIds.push(invalidDeployment.createdDeployment.id);
      // A corrupt outbox job ID exercises delivery retries, independently of
      // readiness failures (which complete a BullMQ job without retrying).
      await harness.sql.query(`INSERT INTO "Deployment" (id, "infrastructureId", "updatedAt") VALUES ('0', $1, now())`, [infrastructureId]);
      deploymentIds.push("0");
      const retryOutboxId = randomUUID();
      await harness.sql.query(`INSERT INTO "Outbox" (id, "eventType", payload, "maxRetries") VALUES ($1, 'deployment-created', $2, 2)`,
        [retryOutboxId, JSON.stringify({ deploymentId: "0", resources: layout.resources, connectionLines: layout.connectionLines })]);

      const legacyId = randomUUID();
      const historicalId = randomUUID();
      deploymentIds.push(legacyId, historicalId);
      for (const [legacy, status] of [[legacyId, "live"], [historicalId, "completed"]]) {
        await harness.sql.query(`INSERT INTO "Deployment" (id, "infrastructureId", status, seed, "workloadProfile", timeline, "updatedAt")
          VALUES ($1, $2, $3, 'legacy-seed', $4, $5, now())`, [legacy, infrastructureId, status,
          JSON.stringify(workload), JSON.stringify([{ event: "Existing history", message: "keep", timestamp: "2026-10-01T00:00:00Z" }])]);
      }

      let socket = await connectWs(id);
      await harness.sql.query("CREATE SEQUENCE integration_worker_attempt");
      await harness.sql.query(`CREATE FUNCTION integration_worker_retry() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = TG_ARGV[0] AND NEW.status = 'running' AND nextval('integration_worker_attempt') = 1 THEN
            RAISE EXCEPTION 'integration transient worker probe';
          END IF;
          RETURN NEW;
        END $$`);
      await harness.sql.query(`CREATE TRIGGER integration_worker_retry BEFORE UPDATE OF status ON "Deployment"
        FOR EACH ROW EXECUTE FUNCTION integration_worker_retry('${id}')`);
      phase("worker and gates");
      await harness.startWorker();
      workerStarted = true;
      await until(async () => (await queue!.getJob(id))?.getState().then((state) => state === "delayed" || undefined), "worker retry delay");
      const intermediateStatus = (await deployment(id)).status;
      expect(intermediateStatus).toBe("running");
      expect(evidence.wsEvents.some((event: Event) => event.deploymentId === id && event.publishType === "deployment-failed")).toBe(false);
      await harness.sql.query('DROP TRIGGER integration_worker_retry ON "Deployment"');
      await harness.sql.query("DROP FUNCTION integration_worker_retry()");
      await harness.sql.query("DROP SEQUENCE integration_worker_attempt");
      evidence.workerRetry = { intermediateStatus, recovered: false };
      latest = await snapshotAfter(id, 0);
      await command(id, "speed", { speed: 0 });
      expect(latest.simulatedSeconds).toBe(1);
      const initial = tick(createInitialState(id, layout.resources, layout.connectionLines,
        created.createdDeployment.runInputs.workloadProfile, engineSeed(actualSeed)), {}).state;
      expect(latest.metrics).toEqual(initial.metrics);
      expect(latest.health).toBe(initial.overallHealth);
      expect(latest.loadFraction).toBe(initial.loadFraction);
      expect(latest.burnRatePerHourUsd).toBeGreaterThan(0);
      expect(latest.accumulatedCostUsd).toBeCloseTo(latest.burnRatePerHourUsd! / 3600, 12);
      evidence.firstSnapshot = latest;
      expect(Object.keys(latest).sort()).toEqual([
        "deploymentId", "timestamp", "simulatedSeconds", "loadFraction", "metrics", "logs", "health", "pools",
        "spawnedVms", "restarting", "activeChaos", "speed", "burnRatePerHourUsd", "accumulatedCostUsd", "publishType",
        "liveTopology", "topologyRevision",
      ].sort());
      const wireEvents = evidence.wsEvents.filter((e: Event) => e.deploymentId === id);
      expect(wireEvents.filter((e: Event) => e.publishType === "stage-of-deployment-completed").map((e: Event) => e.stageName))
        .toEqual(["Validate", "SecurityScan", "CostEstimate"]);
      expect(wireEvents.find((e: Event) => e.publishType === "deployment-started"))
        .toMatchObject({ deploymentId: id, status: "running", resourceCount: layout.resources.length });
      expect(wireEvents.find((e: Event) => e.publishType === "deployment-live"))
        .toMatchObject({ deploymentId: id, status: "live", resourceCount: layout.resources.length });
      for (const event of wireEvents) {
        expect(Date.parse(event.timestamp)).toBeGreaterThan(0);
        expect(evidence.redisEvents.some((emitted: Event) => emitted.channel === `deployment:${id}:updates` &&
          JSON.stringify(emitted.event) === JSON.stringify(event))).toBe(true);
      }

      const live = await deployment(id);
      const first = evidence.wsEvents.find((event: Event) => event.deploymentId === id && event.publishType === "simulation-snapshot");
      expect(first.simulatedSeconds).toBe(0);
      expect(first.accumulatedCostUsd).toBe(0);
      expect(first.liveTopology).toEqual(layout);
      expect(first.topologyRevision).toBe(0);
      evidence.initialSnapshot = first;
      expect(live.status).toBe("live");
      expect(live.seed).toBe(actualSeed);
      expect(latest.liveTopology).toEqual(layout);
      expect(latest.metrics["saved-only"]).toBeUndefined();
      expect(live.runInputs).toEqual(created.createdDeployment.runInputs);
      const legacy = await deployment(legacyId);
      expect(legacy.status).toBe("failed");
      expect(legacy.runInputs).toBeNull();
      expect(legacy.seed).toBe("legacy-seed");
      expect(legacy.workloadProfile).toEqual(workload);
      expect(legacy.timeline[0].event).toBe("Existing history");
      expect(legacy.timeline[1].message).toContain("cannot be reconstructed");
      const historical = await deployment(historicalId);
      expect(historical.status).toBe("completed");
      expect(historical.runInputs).toBeNull();
      expect(historical.timeline).toHaveLength(1);
      expect(live.stages.map((s: Event) => s.name)).toEqual(["Validate", "SecurityScan", "CostEstimate"]);
      expect(live.stages.every((s: Event) => s.status === "completed")).toBe(true);
      expect(live.stages[1].details.issues).toContain("Database should not be publicly accessible");
      expect(live.stages[2].details.lineItems).toHaveLength(layout.resources.length);
      expect((await harness.request("/deployments/live")).deployments.find((d: Event) => d.id === id)).toEqual({
        id, infrastructureId, infrastructureName: "Integration saved layout", resourceCount: layout.resources.length,
        status: "live", createdAt: live.createdAt, updatedAt: live.updatedAt,
      });
      const validJob = await queue.getJob(id);
      expect(validJob?.id).toBe(id);
      expect(validJob?.opts.attempts).toBe(10);
      expect(validJob?.opts.backoff).toEqual({ type: "exponential", delay: 10000 });
      await until(async () => (await validJob?.getState()) === "completed" || undefined, "valid BullMQ completion");
      const retriedJob = await queue.getJob(id);
      expect(retriedJob?.attemptsMade).toBe(2);
      evidence.workerRetry = { intermediateStatus, recovered: true, attemptsMade: retriedJob?.attemptsMade };
      const delivered = await harness.sql.query('SELECT status FROM "Outbox" WHERE payload->>\'deploymentId\' = $1', [id]);
      expect(delivered.rows.map((r) => r.status)).toEqual(["completed", "completed"]);
      phase("duplicate jobs and competing worker");
      const duplicateJobs = await Promise.all(Array.from({ length: 4 }, () => queue!.add("deployment-created", {
        deploymentId: id, resources: [], connectionLines: [], seed: "stale", workloadProfile: { targetThroughput: 1 },
      }, { jobId: randomUUID() })));
      for (const duplicate of duplicateJobs) await until(async () => (await duplicate.getState()) === "completed" || undefined, "duplicate job skip");
      expect((await deployment(id)).runInputs).toEqual(live.runInputs);
      expect((await deployment(id)).stages).toEqual(live.stages);
      expect(evidence.wsEvents.filter((event: Event) => event.deploymentId === id && event.publishType === "simulation-snapshot")
        .map((event: Event) => event.simulatedSeconds)).toEqual([0, 1]);
      await harness.startWorker("competing-worker");
      expect(await harness.waitForExit("competing-worker")).toBe(1);
      expect((await deployment(id)).status).toBe("live");
      expect(harness.logs()["competing-worker"]).toContain("Another InfraForge worker owns");
      await harness.stop("competing-worker");
      evidence.duplicateJobs = { skipped: duplicateJobs.length, runInputsUnchanged: true, competingWorkerExit: 1 };
      phase("authentication and ownership");
      evidence.authentication = await checkUserIsolation(harness, sessions, infrastructureId, id);
      await until(async () => (await deployment(invalidDeployment.createdDeployment.id)).status === "failed" || undefined, "readiness failure");
      const rejected = await deployment(invalidDeployment.createdDeployment.id);
      expect(rejected.stages).toEqual([]);
      expect(rejected.timeline[0].message).toContain("isolated");
      const invalidJob = await queue.getJob(invalidDeployment.createdDeployment.id);
      expect(await invalidJob?.getState()).toBe("completed");

      const workerFixture = async (name: string) => {
        const infrastructure = (await harness.request("/infrastructure", { name, layout }, "POST", 201)).createdInfrastructure;
        infrastructureIds.push(infrastructure.id);
        const deploymentId = randomUUID();
        deploymentIds.push(deploymentId);
        const input = captureRunInputs(layout, workload);
        await harness.sql.query(`INSERT INTO "Deployment" (id, "infrastructureId", "resourceCount", seed, "workloadProfile", "runInputs", "liveTopology", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, now())`, [deploymentId, infrastructure.id, layout.resources.length,
          input.seed, JSON.stringify(input.workloadProfile), JSON.stringify(input), JSON.stringify(layout)]);
        return { deploymentId, infrastructureId: infrastructure.id };
      };
      const fixtureJob = (deploymentId: string) => queue!.add("deployment-created", {
        deploymentId, resources: layout.resources, connectionLines: layout.connectionLines,
      }, { jobId: deploymentId, attempts: 2, backoff: { type: "fixed", delay: 20 } });
      const fixtureEvents = (deploymentId: string, type: string) => evidence.redisEvents.filter((event: Event) =>
        event.event.deploymentId === deploymentId && event.event.publishType === type);

      phase("saved layout cannot break captured run");
      const bootstrap = await workerFixture("Live bootstrap failure");
      await harness.sql.query('UPDATE "Infrastructure" SET layout = $1 WHERE id = $2',
        [JSON.stringify({ resources: [null], connectionLines: [] }), bootstrap.infrastructureId]);
      await harness.request("/deployments", { infrastructureId: bootstrap.infrastructureId }, "POST", 400);
      const bootstrapJob = await fixtureJob(bootstrap.deploymentId);
      await until(async () => (await bootstrapJob.getState()) === "completed" || undefined, "captured bootstrap completion");
      const failedBootstrapJob = await queue.getJob(bootstrap.deploymentId);
      expect((await deployment(bootstrap.deploymentId)).status).toBe("live");
      expect(failedBootstrapJob?.attemptsMade).toBe(1);
      expect(fixtureEvents(bootstrap.deploymentId, "deployment-failed")).toHaveLength(0);
      expect(fixtureEvents(bootstrap.deploymentId, "deployment-started")).toHaveLength(1);
      expect(fixtureEvents(bootstrap.deploymentId, "stage-of-deployment-completed")).toHaveLength(3);
      const bootstrapSnapshot = await until(async () => fixtureEvents(bootstrap.deploymentId, "simulation-snapshot")
        .map((entry: Event) => entry.event).find((snapshot: Snapshot) => snapshot.simulatedSeconds > 0), "captured bootstrap snapshot");
      expect(Object.keys(bootstrapSnapshot.metrics).sort()).toEqual(layout.resources.map((resource) => resource.id).sort());
      evidence.savedLayoutIsolation = { status: (await deployment(bootstrap.deploymentId)).status, snapshot: bootstrapSnapshot };
      await harness.request(`/deployments/${bootstrap.deploymentId}/teardown`, {});
      await until(async () => !(await deployment(bootstrap.deploymentId)).runtimeActive || undefined, "bootstrap stop acknowledgement");
      await harness.sql.query('DELETE FROM "Deployment" WHERE id = $1', [bootstrap.deploymentId]);

      phase("gate retries");
      for (const recover of [true, false]) {
        const fixture = await workerFixture(recover ? "Gate retry recovery" : "Gate retry exhaustion");
        await harness.sql.query("CREATE SEQUENCE integration_gate_attempt");
        await harness.sql.query(`CREATE FUNCTION integration_gate_retry() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.id = TG_ARGV[0] AND jsonb_array_length(NEW.stages::jsonb) = 2
              AND (${recover ? "nextval('integration_gate_attempt') = 1" : "TRUE"}) THEN
              RAISE EXCEPTION 'integration gate retry probe';
            END IF;
            RETURN NEW;
          END $$`);
        await harness.sql.query(`CREATE TRIGGER integration_gate_retry BEFORE UPDATE OF stages ON "Deployment"
          FOR EACH ROW EXECUTE FUNCTION integration_gate_retry('${fixture.deploymentId}')`);
        try {
          const job = await fixtureJob(fixture.deploymentId);
          await until(async () => (await job.getState()) === (recover ? "completed" : "failed") || undefined, "gate retry outcome");
          const processedJob = await queue.getJob(fixture.deploymentId);
          const current = await deployment(fixture.deploymentId);
          expect(processedJob?.attemptsMade).toBe(2);
          expect(current.status).toBe(recover ? "live" : "failed");
          expect(current.stages.map((stage: Event) => stage.name)).toEqual(recover ? ["Validate", "SecurityScan", "CostEstimate"] : ["Validate"]);
          expect(current.timeline.map((entry: Event) => entry.event)).toEqual(recover ? ["Validate", "SecurityScan", "CostEstimate"] : ["Validate"]);
          await until(async () => fixtureEvents(fixture.deploymentId, recover ? "simulation-snapshot" : "deployment-failed").length > 0 || undefined,
            "gate retry published outcome");
          expect(fixtureEvents(fixture.deploymentId, "deployment-started")).toHaveLength(2);
          expect(fixtureEvents(fixture.deploymentId, "deployment-failed")).toHaveLength(recover ? 0 : 1);
          expect(fixtureEvents(fixture.deploymentId, "stage-of-deployment-completed").map((event: Event) => event.event.stageName))
            .toEqual(recover ? ["Validate", "SecurityScan", "CostEstimate"] : ["Validate"]);
          evidence[recover ? "gateRetryRecovery" : "gateRetryExhaustion"] = { status: current.status, attemptsMade: processedJob?.attemptsMade,
            stages: current.stages, timeline: current.timeline, startedEvents: fixtureEvents(fixture.deploymentId, "deployment-started").length };
          if (recover) await harness.request(`/deployments/${fixture.deploymentId}/teardown`, {});
        } finally {
          await harness.sql.query('DROP TRIGGER integration_gate_retry ON "Deployment"');
          await harness.sql.query("DROP FUNCTION integration_gate_retry()");
          await harness.sql.query("DROP SEQUENCE integration_gate_attempt");
        }
      }
      expect(invalidJob?.attemptsMade).toBe(1);

      phase("notification delivery failure");
      const access = await harness.redis.call("ACL", "GETUSER", "default") as Array<unknown>;
      const originalCommands = access[access.indexOf("commands") + 1];
      if (typeof originalCommands !== "string") throw new Error("Disposable Redis ACL commands are unavailable");
      const notificationId = randomUUID();
      try {
        await harness.redis.call("ACL", "SETUSER", "default", "-publish");
        await harness.sql.query(`INSERT INTO "Outbox" (id, "eventType", payload, "maxRetries") VALUES ($1, 'chaos-injected', $2, 1)`,
          [notificationId, JSON.stringify({ deploymentId: id, chaosType: "crash", resourceId: "vm-a", message: "Notification delivery probe" })]);
        await until(async () => {
          const result = await harness.sql.query('SELECT status FROM "Outbox" WHERE id = $1', [notificationId]);
          return result.rows[0]?.status === "failed" || undefined;
        }, "notification outbox exhaustion");
        expect((await deployment(id)).status).toBe("live");
      } finally {
        await harness.redis.call("ACL", "SETUSER", "default", ...originalCommands.split(" "));
      }
      expect(fixtureEvents(id, "outbox-BullMQ-push-failed")).toHaveLength(0);
      evidence.notificationFailure = { outboxId: notificationId, deploymentStatus: (await deployment(id)).status };

      const pausedCount = evidence.wsEvents.filter((e: Event) => e.publishType === "simulation-snapshot" && e.deploymentId === id).length;
      phase("live controls");
      await Bun.sleep(1500);
      expect(evidence.wsEvents.filter((e: Event) => e.publishType === "simulation-snapshot" && e.deploymentId === id)).toHaveLength(pausedCount);

      await command(id, "load", { targetLoadFraction: 0.5 });
      await harness.request(`/deployments/${id}/sync-topology`, { resources: [null], connectionLines: [] }, "POST", 400);
      await command(id, "chaos", { type: "crash", resourceId: "vm-a" });
      await command(id, "scale-vertical", { resourceId: "vm-b", skuId: "m5.xlarge" });
      await command(id, "scale-pool", { lbId: "lb", delta: 1 });
      const liveLayout = { ...layout, resources: [...layout.resources, { id: "live-storage", type: "Object Storage", x: 800, y: 0 }] };
      await command(id, "sync-topology", liveLayout);
      expect((await harness.request(`/infrastructure/${infrastructureId}`)).infrastructure.layout).toEqual(editedSavedLayout);
      expect((await deployment(id)).runInputs).toEqual(live.runInputs);
      await harness.request(`/deployments/${id}/sync-topology`, { ...layout, expectedRevision: 0 }, "POST", 409);
      expect((await deployment(id)).liveTopology).toEqual(liveLayout);
      // Two editors using the same revision: exactly one may commit.
      const concurrent = await Promise.all([liveLayout, layout].map(async (topology) => {
        const response = await fetch(harness.api + `/deployments/${id}/sync-topology`, {
          method: "POST", headers: harness.headers, body: JSON.stringify({ ...topology, expectedRevision: 1 }),
        });
        return { status: response.status, topology };
      }));
      expect(concurrent.map((result) => result.status).sort()).toEqual([200, 409]);
      expect((await deployment(id)).liveTopology).toEqual(concurrent.find((result) => result.status === 200)!.topology);
      // Put the chosen learning fixture back through its current revision.
      await command(id, "sync-topology", liveLayout);
      await harness.redis.publish("simulator:control", JSON.stringify({ deploymentId: id, action: "sync-topology", resources: [], connectionLines: [], topologyRevision: 0 }));
      const at2 = await advance(id, 1);
      expect(at2.activeChaos?.[0]?.resourceId).toBe("vm-a");
      expect(at2.metrics["vm-a"]?.health).toBe(ResourceHealth.FAILED);
      expect(at2.restarting).toEqual(["vm-b"]);
      expect(at2.spawnedVms?.[0]?.status).toBe("provisioning");
      expect(at2.metrics["live-storage"]).toBeDefined();
      expect(at2.logs.some((log) => log.source === "load-tester")).toBe(true);
      const chaosStored = (await deployment(id)).chaosEvents;
      expect(chaosStored).toHaveLength(1);
      expect(chaosStored[0]).toMatchObject({ type: "crash", resourceId: "vm-a" });
      await advance(id, 10);
      const at22 = await advance(id, 10);
      expect(at22.restarting).toEqual([]);
      expect(at22.burnRatePerHourUsd).toBeGreaterThan(at2.burnRatePerHourUsd!);
      const at82 = await advance(id, 60);
      expect(at82.loadFraction).toBe(0.5);
      expect(at82.activeChaos).toEqual([]);
      expect(at82.pools?.lb?.currentReplicas).toBe(3);
      expect(at82.spawnedVms?.[0]?.status).toBe("active");
      await command(id, "scale-pool", { lbId: "lb", delta: -1 });
      await advance(id, 10);
      const at102 = await advance(id, 10);
      expect(at102.pools?.lb?.currentReplicas).toBe(2);
      expect(at102.spawnedVms).toEqual([]);
      expect(at102.accumulatedCostUsd).toBeGreaterThan(at2.accumulatedCostUsd!);

      socket.close();
      await until(async () => socket.readyState === WebSocket.CLOSED || undefined, "socket disconnect");
      await until(async () => {
        const counts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
        return Number(counts[1]) === 0 || undefined;
      }, "subscription cleanup");
      socket = await connectWs(id);
      expect((await deployment(id)).status).toBe("live");
      await advance(id, 1);

      const retry = await until(async () => {
        const rows = await harness.sql.query('SELECT * FROM "Outbox" WHERE id = $1', [retryOutboxId]);
        return rows.rows[0]?.status === "failed" ? rows.rows[0] : undefined;
      }, "outbox retry exhaustion");
      expect(retry.retries).toBe(2);
      expect(retry.error).toBe("JobId cannot be '0' or start with '0:'");
      expect((await harness.sql.query('SELECT status FROM "Deployment" WHERE id = \'0\'')).rows[0].status).toBe("failed");
      evidence.retry = { status: retry.status, retries: retry.retries, error: retry.error };

      // Diagnostic checkpoints are preserved; they are not recovery state.
      phase("checkpoint");
      await command(id, "speed", { speed: 60 });
      const checkpoint = await until(async () => {
        const current = await deployment(id);
        return current.simulationState?.simulatedSeconds > 103 ? current.simulationState : undefined;
      }, "real simulation checkpoint", 70000, 500);
      latest = evidence.wsEvents.filter((e: Event) => e.deploymentId === id && e.publishType === "simulation-snapshot").at(-1);
      await command(id, "speed", { speed: 0 });
      expect(checkpoint.metrics["live-storage"]).toBeDefined();
      expect(checkpoint.accumulatedCostUsd).toBeGreaterThan(at102.accumulatedCostUsd!);
      evidence.checkpoint = checkpoint;
      phase("worker restart");
      await harness.stop("worker");
      const beforeRestart = evidence.wsEvents.length;
      await harness.startWorker();
      await until(async () => (await deployment(id)).status === "failed" || undefined, "explicit interrupted run failure");
      await Bun.sleep(1500);
      expect(evidence.wsEvents.slice(beforeRestart).some((event: Event) => event.deploymentId === id && event.publishType === "simulation-snapshot")).toBe(false);
      expect((await deployment(id)).runtimeActive).toBe(false);
      expect((await deployment(id)).seed).toBe(actualSeed);
      expect((await deployment(id)).stages).toEqual(live.stages);
      expect((await deployment(id)).runInputs).toEqual(live.runInputs);
      expect((await deployment(id)).liveTopology).toEqual(liveLayout);
      expect((await deployment(id)).simulationState).toEqual(checkpoint);
      expect((await deployment(id)).timeline.at(-1).message).toContain("Checkpoints are diagnostic only");
      const staleRestart = await queue.add("deployment-created", { deploymentId: id, resources: [] }, { jobId: randomUUID() });
      await until(async () => (await staleRestart.getState()) === "completed" || undefined, "interrupted duplicate skip");
      evidence.restart = { status: (await deployment(id)).status, originalInputsPreserved: true, checkpointPreserved: true, snapshotsAfterRestart: 0 };

      const teardownFixture = await workerFixture("Teardown safety");
      const retiredId = teardownFixture.deploymentId;
      socket.close();
      socket = await connectWs(retiredId);
      await fixtureJob(retiredId);
      latest = await snapshotAfter(retiredId, 0);
      await harness.request(`/infrastructure/${teardownFixture.infrastructureId}`, undefined, "DELETE", 409);

      const beforeResume = evidence.wsEvents.length;
      phase("teardown");
      await command(retiredId, "speed", { speed: 1 });
      latest = await snapshotAfter(retiredId, latest.simulatedSeconds, beforeResume);
      expect(latest.speed).toBe(1);
      await command(retiredId, "teardown", {});
      await until(async () => evidence.wsEvents.some((e: Event) => e.deploymentId === retiredId && e.publishType === "deployment-torn-down") || undefined,
        "teardown WebSocket event");
      expect((await deployment(retiredId)).status).toBe("torn-down");
      const retiredJob = await queue.add("deployment-created", { deploymentId: retiredId }, { jobId: randomUUID() });
      await until(async () => (await retiredJob.getState()) === "completed" || undefined, "retired deployment job skip");
      expect((await deployment(retiredId)).status).toBe("torn-down");
      expect((await harness.request("/deployments/live")).deployments.some((d: Event) => d.id === retiredId)).toBe(false);
      await harness.request(`/deployments/${retiredId}/load`, { targetLoadFraction: 1 }, "POST", 400);
      await Bun.sleep(200);
      const afterTeardown = evidence.wsEvents.length;
      await Bun.sleep(1500);
      expect(evidence.wsEvents.slice(afterTeardown).some((e: Event) => e.deploymentId === retiredId && e.publishType === "simulation-snapshot")).toBe(false);
      await until(async () => !(await deployment(retiredId)).runtimeActive || undefined, "simulator stopped before deletion");
      await harness.request(`/infrastructure/${teardownFixture.infrastructureId}`, undefined, "DELETE");
      expect((await harness.sql.query('SELECT id FROM "Deployment" WHERE id = $1', [retiredId])).rowCount).toBe(0);
      expect((await harness.request(`/infrastructure/${infrastructureId}`)).infrastructure.layout).toEqual(editedSavedLayout);
      phase("creation versus deletion");
      const raceDesign = (await harness.request("/infrastructure", { name: "Creation deletion race", layout }, "POST", 201)).createdInfrastructure;
      infrastructureIds.push(raceDesign.id);
      const race = await Promise.all([
        fetch(harness.api + "/deployments", { method: "POST", headers: harness.headers, body: JSON.stringify({ infrastructureId: raceDesign.id }) }),
        fetch(harness.api + `/infrastructure/${raceDesign.id}`, { method: "DELETE", headers: harness.headers }),
      ]);
      if (race[0]!.status === 201) {
        expect(race[1]!.status).toBe(409);
        const raceRun = ((await race[0]!.json()) as Event).createdDeployment;
        deploymentIds.push(raceRun.id);
        await until(async () => (await deployment(raceRun.id)).status === "live" || undefined, "racing creation preserved");
        await harness.request(`/deployments/${raceRun.id}/teardown`, {});
      } else {
        expect(race[0]!.status).toBe(404);
        expect(race[1]!.status).toBe(200);
      }
      evidence.creationDeletionRace = race.map((response) => response.status);

      phase("worker ownership loss");
      const lossFixture = await workerFixture("Worker connection loss");
      await fixtureJob(lossFixture.deploymentId);
      await until(async () => fixtureEvents(lossFixture.deploymentId, "simulation-snapshot")
        .some((entry: Event) => entry.event.simulatedSeconds > 0) || undefined, "ownership fixture snapshot");
      const owner = await harness.sql.query(`SELECT pid FROM pg_locks WHERE locktype = 'advisory'
        AND classid = 186542854 AND objid = 1 AND objsubid = 2 AND granted`);
      expect(owner.rows).toHaveLength(1);
      await harness.sql.query("SELECT pg_terminate_backend($1)", [owner.rows[0].pid]);
      expect(await harness.waitForExit("worker")).toBe(1);
      const afterLoss = evidence.wsEvents.length;
      await Bun.sleep(1500);
      expect(evidence.wsEvents.slice(afterLoss).some((event: Event) => event.publishType === "simulation-snapshot")).toBe(false);
      await harness.stop("worker");
      await harness.startWorker();
      await until(async () => (await deployment(lossFixture.deploymentId)).status === "failed" || undefined, "ownership loss interrupted run");
      evidence.ownershipLoss = { exit: 1, subsequentSnapshots: 0, interruptedStatus: "failed" };
      phase("WebSocket transport failures");
      socket.close();
      await until(async () => socket.readyState === WebSocket.CLOSED || undefined, "final socket disconnect");
      await until(async () => {
        const counts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
        return Number(counts[1]) === 0 || undefined;
      }, "final subscription cleanup");
      await harness.redis.call("CLIENT", "PAUSE", 1000, "ALL");
      const pendingSocket = new WebSocket("ws://localhost:3001", { headers: harness.headers });
      sockets.push(pendingSocket);
      await new Promise<void>((resolve, reject) => { pendingSocket.once("open", resolve); pendingSocket.once("error", reject); });
      pendingSocket.send(JSON.stringify({ type: "subscribe", deploymentId: id }));
      await Bun.sleep(30);
      pendingSocket.close();
      await until(async () => pendingSocket.readyState === WebSocket.CLOSED || undefined, "pending socket disconnect");
      const pendingCounts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
      expect(Number(pendingCounts[1])).toBe(0);
      const oversizedSocket = new WebSocket("ws://localhost:3001", { headers: harness.headers });
      sockets.push(oversizedSocket);
      await new Promise<void>((resolve, reject) => { oversizedSocket.once("open", resolve); oversizedSocket.once("error", reject); });
      let closedCode: number | undefined;
      oversizedSocket.once("close", (code) => { closedCode = code; });
      oversizedSocket.send("x".repeat(1025));
      await until(async () => closedCode, "oversized frame rejection");
      expect(closedCode).toBe(1009);
      expect((await fetch("http://localhost:3001")).status).toBe(200);
      evidence.websocketFailures = { pendingSubscriberCount: Number(pendingCounts[1]), oversizedCloseCode: 1009, serverHealth: 200 };
      evidence.result = "passed";
    } catch (error) {
      evidence.result = "failed";
      evidence.failure = error instanceof Error ? error.message : "Unknown test failure";
      throw error;
    } finally {
      phase("cleanup");
      for (const socket of sockets) socket.terminate();
      observer.disconnect();
      const cleanupErrors: string[] = [];
      try {
        if (workerStarted) await harness.stop("worker");
        if (schemaReady) {
          // Only these fixture rows, after owned child processes have stopped.
          await harness.sql.query(`UPDATE "Deployment" SET status = 'failed', "runtimeActive" = false WHERE id = ANY($1::text[])`, [deploymentIds]);
          await harness.sql.query('DELETE FROM "Outbox" WHERE payload->>\'deploymentId\' = ANY($1::text[])', [deploymentIds]);
          await harness.sql.query('DELETE FROM "Deployment" WHERE id = ANY($1::text[])', [deploymentIds]);
          await harness.sql.query('DELETE FROM "Infrastructure" WHERE id = ANY($1::text[])', [infrastructureIds]);
        }
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : "Fixture row cleanup failed");
      } finally {
        try { await queue?.close(); } catch { cleanupErrors.push("Queue close failed"); }
        try { await sessions?.close(); } catch { cleanupErrors.push("Session fixture cleanup failed"); }
        try { await harness.close(); } catch (error) {
          cleanupErrors.push(error instanceof Error ? error.message : "Harness close failed");
        }
        evidence.cleanupErrors = cleanupErrors;
        evidence.processLogs = harness.logs();
        evidence.processes = harness.processes();
        evidence.serviceChecks = harness.checks();
        evidence.endedAt = new Date().toISOString();
        await Bun.write(evidencePath, JSON.stringify(evidence, null, 2));
        console.info(`Integration evidence: ${evidencePath}`);
        if (cleanupErrors.length && evidence.result === "passed") throw new Error(cleanupErrors.join("; "));
      }
    }
  }, 180000);
});
