import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Queue } from "bullmq";
import WebSocket from "ws";
import { createInitialState, tick } from "@shared/simulation/engine";
import type { SimulationSnapshot } from "@shared/interface/SimulationSnapshot.interface";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import { LocalHarness, readLocalSettings, until } from "./localHarness";
import { layout, seed, workload } from "./scenario";

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
    const evidencePath = join(tmpdir(), `infraforge-integration-${randomUUID()}.json`);

    const deployment = async (id: string) => (await harness.request(`/deployments/${id}`)).deployment;
    const connectWs = async (id: string) => {
      const socket = new WebSocket("ws://localhost:3001");
      sockets.push(socket);
      socket.on("message", (raw) => evidence.wsEvents.push(JSON.parse(raw.toString())));
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      socket.send("invalid-json");
      socket.send(JSON.stringify({ type: "subscribe", deploymentId: id }));
      await until(async () => {
        const counts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
        return Number(counts[1]) >= 1 || undefined;
      }, "WebSocket Redis subscription");
      return socket;
    };
    const command = async (id: string, path: string, body: unknown) => {
      const count = evidence.redisEvents.filter((e: Event) => e.channel === "simulator:control").length;
      evidence.controls.push({ beforeTick: latest?.simulatedSeconds ?? null, path, body });
      await harness.request(`/deployments/${id}/${path}`, body);
      const emitted = await until(async () => evidence.redisEvents.filter((e: Event) => e.channel === "simulator:control")[count],
        `${path} Redis command`);
      const actions: Record<string, string> = { load: "set-load", chaos: "inject-chaos", "scale-vertical": "scale-vertical",
        "scale-pool": "scale-pool", speed: "set-speed", "sync-topology": "sync-topology", teardown: "stop" };
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
      await harness.prepare();
      schemaReady = true;
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
      expect(outbox.rows[0].payload).toEqual({ deploymentId: id, resources: layout.resources, connectionLines: layout.connectionLines });
      await harness.sql.query('UPDATE "Deployment" SET seed = $1 WHERE id = $2', [seed.text, id]);
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

      let socket = await connectWs(id);
      await harness.startWorker();
      workerStarted = true;
      latest = await snapshotAfter(id, 0);
      await command(id, "speed", { speed: 0 });
      expect(latest.simulatedSeconds).toBe(1);
      const initial = tick(createInitialState(id, layout.resources, layout.connectionLines, workload, seed.engine), {}).state;
      expect(latest.metrics).toEqual(initial.metrics);
      expect(latest.health).toBe(initial.overallHealth);
      expect(latest.loadFraction).toBe(initial.loadFraction);
      expect(latest.burnRatePerHourUsd).toBeGreaterThan(0);
      expect(latest.accumulatedCostUsd).toBeCloseTo(latest.burnRatePerHourUsd! / 3600, 12);
      evidence.firstSnapshot = latest;
      expect(Object.keys(latest).sort()).toEqual([
        "deploymentId", "timestamp", "simulatedSeconds", "loadFraction", "metrics", "logs", "health", "pools",
        "spawnedVms", "restarting", "activeChaos", "speed", "burnRatePerHourUsd", "accumulatedCostUsd", "publishType",
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
      expect(live.status).toBe("live");
      expect(live.seed).toBe(seed.text);
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
      const delivered = await harness.sql.query('SELECT status FROM "Outbox" WHERE payload->>\'deploymentId\' = $1', [id]);
      expect(delivered.rows.map((r) => r.status)).toEqual(["completed", "completed"]);
      await until(async () => (await deployment(invalidDeployment.createdDeployment.id)).status === "failed" || undefined, "readiness failure");
      const rejected = await deployment(invalidDeployment.createdDeployment.id);
      expect(rejected.stages).toEqual([]);
      expect(rejected.timeline[0].message).toContain("isolated");
      const invalidJob = await queue.getJob(invalidDeployment.createdDeployment.id);
      expect(await invalidJob?.getState()).toBe("completed");
      expect(invalidJob?.attemptsMade).toBe(1);

      const pausedCount = evidence.wsEvents.filter((e: Event) => e.publishType === "simulation-snapshot" && e.deploymentId === id).length;
      await Bun.sleep(1500);
      expect(evidence.wsEvents.filter((e: Event) => e.publishType === "simulation-snapshot" && e.deploymentId === id)).toHaveLength(pausedCount);

      await command(id, "load", { targetLoadFraction: 0.5 });
      await command(id, "chaos", { type: "crash", resourceId: "vm-a" });
      await command(id, "scale-vertical", { resourceId: "vm-b", skuId: "m5.xlarge" });
      await command(id, "scale-pool", { lbId: "lb", delta: 1 });
      const liveLayout = { ...layout, resources: [...layout.resources, { id: "live-storage", type: "Object Storage", x: 800, y: 0 }] };
      await command(id, "sync-topology", liveLayout);
      expect((await harness.request(`/infrastructure/${infrastructureId}`)).infrastructure.layout).toEqual(layout);
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

      // Exercise an actual wall-time checkpoint. It is persisted but current
      // resurrection intentionally starts again from saved layout + seed.
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
      await harness.stop("worker");
      const beforeRestart = evidence.wsEvents.length;
      await harness.startWorker();
      latest = await until(async () => evidence.wsEvents.slice(beforeRestart).find((e: Event) =>
        e.deploymentId === id && e.publishType === "simulation-snapshot") as Snapshot | undefined, "worker resurrection");
      await command(id, "speed", { speed: 0 });
      expect(latest.simulatedSeconds).toBe(1);
      expect(latest.speed).toBe(1);
      expect(latest.metrics).toEqual(evidence.firstSnapshot.metrics);
      expect(latest.metrics["live-storage"]).toBeUndefined();
      expect(latest.accumulatedCostUsd).toBe(evidence.firstSnapshot.accumulatedCostUsd);
      expect((await deployment(id)).seed).toBe(seed.text);
      expect((await deployment(id)).stages).toEqual(live.stages);
      evidence.resurrectedSnapshot = latest;

      const beforeResume = evidence.wsEvents.length;
      await command(id, "speed", { speed: 1 });
      latest = await snapshotAfter(id, latest.simulatedSeconds, beforeResume);
      expect(latest.speed).toBe(1);
      await command(id, "teardown", {});
      await until(async () => evidence.wsEvents.some((e: Event) => e.deploymentId === id && e.publishType === "deployment-torn-down") || undefined,
        "teardown WebSocket event");
      expect((await deployment(id)).status).toBe("torn-down");
      expect((await harness.request("/deployments/live")).deployments.some((d: Event) => d.id === id)).toBe(false);
      await harness.request(`/deployments/${id}/load`, { targetLoadFraction: 1 }, "POST", 400);
      await Bun.sleep(200);
      const afterTeardown = evidence.wsEvents.length;
      await Bun.sleep(1500);
      expect(evidence.wsEvents.slice(afterTeardown).some((e: Event) => e.deploymentId === id && e.publishType === "simulation-snapshot")).toBe(false);
      expect((await harness.request(`/infrastructure/${infrastructureId}`)).infrastructure.layout).toEqual(layout);
      evidence.result = "passed";
    } catch (error) {
      evidence.result = "failed";
      evidence.failure = error instanceof Error ? error.message : "Unknown test failure";
      throw error;
    } finally {
      for (const socket of sockets) socket.terminate();
      observer.disconnect();
      const cleanupErrors: string[] = [];
      try {
        if (workerStarted) await harness.stop("worker");
        if (schemaReady) {
          await harness.sql.query('DELETE FROM "Outbox" WHERE payload->>\'deploymentId\' = ANY($1::text[])', [deploymentIds]);
          await harness.sql.query('DELETE FROM "Deployment" WHERE id = ANY($1::text[])', [deploymentIds]);
          await harness.sql.query('DELETE FROM "Infrastructure" WHERE id = ANY($1::text[])', [infrastructureIds]);
        }
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : "Fixture row cleanup failed");
      } finally {
        try { await queue?.close(); } catch { cleanupErrors.push("Queue close failed"); }
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
