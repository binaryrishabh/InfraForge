import { rejects } from "node:assert/strict";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Queue } from "bullmq";
import WebSocket from "ws";
import { LocalHarness, readLocalSettings, until } from "./localHarness";
import { layout, seed, workload } from "./scenario";
import { captureRunInputs } from "../../deployments/runInputs";
import { SessionFixtures } from "./sessionFixtures";
import { checkUserIsolation } from "./securityChecks";
import { checkRecordedReports } from "./reportChecks";
import { checkReliableEvidence } from "./runEvidenceChecks";
import { checkCompareAccess } from "./compareChecks";
import { checkHonestReruns } from "./rerunChecks";
import { checkChallengeAttempts, checkResilienceAttempt } from "./challengeChecks";
import { checkExperimentTraces } from "./experimentTraceChecks";
import { checkLearningHistory } from "./learningHistoryChecks";
import { checkCredentials } from "./credentialChecks";
import { checkLearningExperiments } from "./learningChecks";
import { checkOperationalDeadline } from "./operationalChecks";
import { checkBrowserRun, submitBrowserRun } from "./browserRunChecks";
import { checkScenarioAttempts } from "./scenarioChecks";

type Event = Record<string, any>;
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

    try {
      phase("prepare");
      await harness.prepare();
      schemaReady = true;
      sessions = new SessionFixtures(harness);
      phase("public credential authentication");
      evidence.credentials = await checkCredentials(harness, sessions);
      if (process.env.INTEGRATION_LEARNING_ONLY === "1") {
        await harness.startWorker(); workerStarted = true;
        evidence.learning = await checkLearningExperiments(harness, sessions, infrastructureIds, deploymentIds);
        evidence.result = "passed"; return;
      }
      if (process.env.INTEGRATION_AUTH_ONLY === "1") {
        const design = await harness.request("/infrastructure", { name: "Credential isolation", layout }, "POST", 201);
        infrastructureIds.push(design.createdInfrastructure.id);
        const run = await harness.request("/deployments", { infrastructureId: infrastructureIds[0], workloadProfile: workload }, "POST", 201);
        deploymentIds.push(run.createdDeployment.id);
        await harness.startWorker(); workerStarted = true;
        await until(async () => (await deployment(deploymentIds[0]!)).status === "browser" || undefined, "credential user browser run", 60000);
        phase("credential user HTTP and WS isolation");
        await checkUserIsolation(harness, sessions, infrastructureIds[0]!, deploymentIds[0]!);
        evidence.result = "passed"; return;
      }
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
      await rejects(harness.sql.query('UPDATE "Deployment" SET "runInputs" = NULL WHERE id = $1', [id]), /immutable/);
      await rejects(harness.sql.query('UPDATE "Deployment" SET seed = $1 WHERE id = $2', ["stale", id]), /immutable/);
      await rejects(harness.sql.query('DELETE FROM "Infrastructure" WHERE id = $1', [infrastructureId]), /active/);
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
      // The intentionally invalid job ID belongs to quarantined fixture history,
      // never the real owner's UUID-paginated history.
      const corruptDesign = randomUUID();
      infrastructureIds.push(corruptDesign);
      await harness.sql.query(`INSERT INTO "Infrastructure" (id, "userId", name, layout, "updatedAt")
        VALUES ($1, 'test-user', 'Corrupt delivery fixture', $2, now())`, [corruptDesign, JSON.stringify(layout)]);
      await harness.sql.query(`INSERT INTO "Deployment" (id, "infrastructureId", "updatedAt") VALUES ('0', $1, now())`, [corruptDesign]);
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
      // A failed claim transaction keeps its queued reservation, without taking an active slot.
      expect(intermediateStatus).toBe("pending");
      expect(evidence.wsEvents.some((event: Event) => event.deploymentId === id && event.publishType === "deployment-failed")).toBe(false);
      await harness.sql.query('DROP TRIGGER integration_worker_retry ON "Deployment"');
      await harness.sql.query("DROP FUNCTION integration_worker_retry()");
      await harness.sql.query("DROP SEQUENCE integration_worker_attempt");
      evidence.workerRetry = { intermediateStatus, recovered: false };
      // After its gates the run waits for the learner's browser; the server simulates nothing until the browser submits.
      await until(async () => (await deployment(id)).status === "browser" || undefined, "run waiting for the browser", 60000, 200);
      // The status is written before the live event is published; wait for the event itself.
      await until(async () => evidence.wsEvents.some((e: Event) => e.deploymentId === id && e.publishType === "deployment-live") || undefined, "live event", 10000, 100);
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
      expect(evidence.wsEvents.some((event: Event) => event.deploymentId === id && event.publishType === "simulation-snapshot")).toBe(false);
      expect(live.status).toBe("browser");
      expect(live.seed).toBe(actualSeed);
      expect(live.liveTopology).toEqual(layout);
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
        status: "browser", createdAt: live.createdAt, updatedAt: live.updatedAt, challengeId: null,
      });
      const validJob = await queue.getJob(id);
      expect(validJob?.id).toBe(id);
      expect(validJob?.opts.attempts).toBe(10);
      expect(validJob?.opts.backoff).toEqual({ type: "exponential", delay: 10000, jitter: 0.2 });
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
      await harness.startWorker("competing-worker");
      expect(await harness.waitForExit("competing-worker")).toBe(1);
      expect((await deployment(id)).status).toBe("browser");
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
      expect((await deployment(bootstrap.deploymentId)).status).toBe("browser");
      expect(failedBootstrapJob?.attemptsMade).toBe(1);
      expect(fixtureEvents(bootstrap.deploymentId, "deployment-failed")).toHaveLength(0);
      expect(fixtureEvents(bootstrap.deploymentId, "deployment-started")).toHaveLength(1);
      expect(fixtureEvents(bootstrap.deploymentId, "stage-of-deployment-completed")).toHaveLength(3);
      expect((await deployment(bootstrap.deploymentId)).liveTopology).toEqual(layout);
      evidence.savedLayoutIsolation = { status: (await deployment(bootstrap.deploymentId)).status };
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
          expect(current.status).toBe(recover ? "browser" : "failed");
          expect(current.stages.map((stage: Event) => stage.name)).toEqual(recover ? ["Validate", "SecurityScan", "CostEstimate"] : ["Validate"]);
          expect(current.timeline.map((entry: Event) => entry.event)).toEqual(recover ? ["Validate", "SecurityScan", "CostEstimate"] : ["Validate"]);
          await until(async () => fixtureEvents(fixture.deploymentId, recover ? "deployment-live" : "deployment-failed").length > 0 || undefined,
            "gate retry published outcome");
          expect(fixtureEvents(fixture.deploymentId, "deployment-started")).toHaveLength(2);
          expect(fixtureEvents(fixture.deploymentId, "deployment-failed")).toHaveLength(recover ? 0 : 1);
          expect(fixtureEvents(fixture.deploymentId, "stage-of-deployment-completed").map((event: Event) => event.event.stageName))
            .toEqual(recover ? ["Validate", "SecurityScan", "CostEstimate"] : ["Validate"]);
          evidence[recover ? "gateRetryRecovery" : "gateRetryExhaustion"] = { status: current.status, attemptsMade: processedJob?.attemptsMade,
            stages: current.stages, timeline: current.timeline, startedEvents: fixtureEvents(fixture.deploymentId, "deployment-started").length };
          // The browser never submits this fixture: release its run reservation.
          if (recover) await harness.sql.query(`UPDATE "Deployment" SET status = 'failed' WHERE id = $1`, [fixture.deploymentId]);
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
        expect((await deployment(id)).status).toBe("browser");
      } finally {
        await harness.redis.call("ACL", "SETUSER", "default", ...originalCommands.split(" "));
      }
      expect(fixtureEvents(id, "outbox-BullMQ-push-failed")).toHaveLength(0);
      evidence.notificationFailure = { outboxId: notificationId, deploymentStatus: (await deployment(id)).status };

      phase("browser submission and server replay");
      // The browser halved the load and crashed vm-a at second 2, then stopped at 40. The server replays exactly that.
      const beforeReplay = evidence.wsEvents.length;
      const replayed = await submitBrowserRun(harness, id, 40, [
        { atSecond: 2, request: { kind: "load", parameters: { targetLoadFraction: 0.5 } } },
        { atSecond: 2, request: { kind: "chaos", parameters: { type: "crash", resourceId: "vm-a" } } }]);
      expect(replayed.status).toBe("torn-down");
      expect(replayed.terminalSnapshot).toMatchObject({ kind: "terminal", simulatedSeconds: 40, loadFraction: 0.5, activeChaos: [] });
      expect(replayed.runInputs).toEqual(live.runInputs);
      expect(replayed.liveTopology).toEqual(layout);
      expect((await harness.request(`/infrastructure/${infrastructureId}`)).infrastructure.layout).toEqual(editedSavedLayout);
      const replayActions = (await harness.sql.query('SELECT kind, status, "appliedSimulatedSeconds" AS at, "completedSimulatedSeconds" AS done FROM "RunAction" WHERE "deploymentId"=$1 ORDER BY sequence', [id])).rows;
      expect(replayActions).toEqual([{ kind: "load", status: "completed", at: 2, done: 2 }, { kind: "chaos", status: "completed", at: 2, done: 32 },
        { kind: "teardown", status: "completed", at: 40, done: 40 }]);
      expect((await deployment(id)).chaosEvents).toHaveLength(0);
      // The replay streamed its seconds to the open socket, as published, from second 0.
      const streamed = evidence.wsEvents.slice(beforeReplay).filter((e: Event) => e.deploymentId === id && e.publishType === "simulation-snapshot");
      expect(streamed[0]).toMatchObject({ simulatedSeconds: 0, accumulatedCostUsd: 0, liveTopology: layout, topologyRevision: 0 });
      expect(Object.keys(streamed[0])).toEqual(expect.arrayContaining(["deploymentId", "timestamp", "simulatedSeconds", "loadFraction", "metrics", "logs",
        "health", "pools", "spawnedVms", "restarting", "activeChaos", "speed", "burnRatePerHourUsd", "accumulatedCostUsd", "publishType", "liveTopology", "topologyRevision"]));
      for (const snapshot of streamed) {
        expect(evidence.redisEvents.some((e: Event) => e.channel === `deployment:${id}:updates` && JSON.stringify(e.event) === JSON.stringify(snapshot))).toBe(true);
      }
      await until(async () => evidence.wsEvents.some((e: Event) => e.deploymentId === id && e.publishType === "deployment-torn-down") || undefined, "replay end event");
      evidence.replay = { terminal: replayed.terminalSnapshot, actions: replayActions, streamed: streamed.length };

      socket.close();
      await until(async () => socket.readyState === WebSocket.CLOSED || undefined, "socket disconnect");
      await until(async () => {
        const counts = await harness.redis.pubsub("NUMSUB", `deployment:${id}:updates`) as Array<string | number>;
        return Number(counts[1]) === 0 || undefined;
      }, "subscription cleanup");
      socket = await connectWs(id);
      expect((await deployment(id)).status).toBe("torn-down");

      const retry = await until(async () => {
        const rows = await harness.sql.query('SELECT * FROM "Outbox" WHERE id = $1', [retryOutboxId]);
        return rows.rows[0]?.status === "failed" ? rows.rows[0] : undefined;
      }, "outbox retry exhaustion");
      expect(retry.retries).toBe(2);
      expect(retry.error).toBe("Outbox delivery failed");
      expect((await harness.sql.query('SELECT status FROM "Deployment" WHERE id = \'0\'')).rows[0].status).toBe("failed");
      evidence.retry = { status: retry.status, retries: retry.retries, error: retry.error };

      phase("worker restart");
      // The server holds nothing in memory for a run waiting for its browser, so a restart does not touch it.
      const waitingFixture = await workerFixture("Waiting across a restart");
      await fixtureJob(waitingFixture.deploymentId);
      await until(async () => (await deployment(waitingFixture.deploymentId)).status === "browser" || undefined, "fixture waiting for the browser");
      await harness.stop("worker");
      await harness.startWorker();
      await Bun.sleep(1500);
      expect((await deployment(waitingFixture.deploymentId)).status).toBe("browser");
      const resumed = await submitBrowserRun(harness, waitingFixture.deploymentId, 5);
      expect(resumed.status).toBe("torn-down");
      const staleRestart = await queue.add("deployment-created", { deploymentId: waitingFixture.deploymentId, resources: [] }, { jobId: randomUUID() });
      await until(async () => (await staleRestart.getState()) === "completed" || undefined, "finished duplicate skip");
      expect((await deployment(waitingFixture.deploymentId)).status).toBe("torn-down");
      evidence.restart = { waitingRunSurvived: true, replayedAfterRestart: true };

      phase("paused operational deadline and durable capacity release");
      evidence.operationalDeadline = await checkOperationalDeadline(harness, infrastructureIds, deploymentIds);

      const teardownFixture = await workerFixture("Teardown safety");
      const retiredId = teardownFixture.deploymentId;
      socket.close();
      socket = await connectWs(retiredId);
      await fixtureJob(retiredId);
      await until(async () => (await deployment(retiredId)).status === "browser" || undefined, "teardown fixture waiting for the browser");
      await harness.request(`/infrastructure/${teardownFixture.infrastructureId}`, undefined, "DELETE", 409);

      phase("teardown");
      await submitBrowserRun(harness, retiredId, 5);
      await until(async () => evidence.wsEvents.some((e: Event) => e.deploymentId === retiredId && e.publishType === "deployment-torn-down") || undefined,
        "teardown WebSocket event");
      expect((await deployment(retiredId)).status).toBe("torn-down");
      const retiredJob = await queue.add("deployment-created", { deploymentId: retiredId }, { jobId: randomUUID() });
      await until(async () => (await retiredJob.getState()) === "completed" || undefined, "retired deployment job skip");
      expect((await deployment(retiredId)).status).toBe("torn-down");
      expect((await harness.request("/deployments/live")).deployments.some((d: Event) => d.id === retiredId)).toBe(false);
      await harness.request(`/deployments/${retiredId}/load`, { targetLoadFraction: 1 }, "POST", 409);
      await Bun.sleep(200);
      const afterTeardown = evidence.wsEvents.length;
      await Bun.sleep(1500);
      expect(evidence.wsEvents.slice(afterTeardown).some((e: Event) => e.deploymentId === retiredId && e.publishType === "simulation-snapshot")).toBe(false);
      await until(async () => !(await deployment(retiredId)).runtimeActive || undefined, "simulator stopped before deletion");
      await harness.request(`/infrastructure/${teardownFixture.infrastructureId}`, undefined, "DELETE");
      expect((await harness.sql.query('SELECT "infrastructureId", "terminalSnapshot" FROM "Deployment" WHERE id = $1', [retiredId])).rows[0])
        .toMatchObject({ infrastructureId: null, terminalSnapshot: { kind: "terminal" } });
      expect((await harness.request(`/deployments/${retiredId}/report`)).report.run.infrastructureId).toBeNull();
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
        await until(async () => (await deployment(raceRun.id)).status === "browser" || undefined, "racing creation preserved");
        await harness.sql.query(`UPDATE "Deployment" SET status = 'failed' WHERE id = $1`, [raceRun.id]);
      } else {
        expect(race[0]!.status).toBe(404);
        expect(race[1]!.status).toBe(200);
      }
      evidence.creationDeletionRace = race.map((response) => response.status);
      phase("reliable run evidence");
      evidence.reliableEvidence = await checkReliableEvidence(harness, sessions, infrastructureIds, deploymentIds);

      phase("worker ownership loss");
      const lossFixture = await workerFixture("Worker connection loss");
      await fixtureJob(lossFixture.deploymentId);
      await until(async () => (await deployment(lossFixture.deploymentId)).status === "browser" || undefined, "ownership fixture waiting");
      // A long submission, so the replay is still running when the worker loses ownership.
      await harness.request(`/deployments/${lossFixture.deploymentId}/submit`, { stopAtSecond: 900, actions: [] }, "POST", 202);
      await until(async () => fixtureEvents(lossFixture.deploymentId, "simulation-snapshot")
        .some((entry: Event) => entry.event.simulatedSeconds > 0) || undefined, "ownership fixture replaying");
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
      phase("durable run reports");
      evidence.reports = await checkRecordedReports(harness, id, invalidDeployment.createdDeployment.id);
      evidence.compare = await checkCompareAccess(harness, sessions, [id, invalidDeployment.createdDeployment.id]);
      phase("honest reruns and exact matched stop");
      evidence.reruns = await checkHonestReruns(harness, sessions, infrastructureIds, deploymentIds,
        (id) => evidence.redisEvents.filter((item: Event) => item.channel === `deployment:${id}:updates`).map((item: Event) => item.event));
      phase("challenge attempts and evaluation stop");
      evidence.challenges = await checkChallengeAttempts(harness, sessions, infrastructureIds, deploymentIds);
      phase("resilience experiment scheduled exactly and judged");
      evidence.resilience = await checkResilienceAttempt(harness, infrastructureIds, deploymentIds);
      phase("scripted challenge parity and scoring");
      evidence.scenario = await checkScenarioAttempts(harness, infrastructureIds, deploymentIds);
      phase("bounded experiment traces");
      evidence.experimentTraces = await checkExperimentTraces(harness, sessions, infrastructureIds, deploymentIds);
      phase("cross-challenge learning history");
      evidence.learningHistory = await checkLearningHistory(harness, sessions, infrastructureIds, deploymentIds);
      phase("deliberate challenge improvements");
      evidence.learning = await checkLearningExperiments(harness, sessions, infrastructureIds, deploymentIds);
      phase("Model 2 browser run, submission and server replay");
      await checkBrowserRun(harness, infrastructureIds, deploymentIds);
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
  }, 600000);
});
