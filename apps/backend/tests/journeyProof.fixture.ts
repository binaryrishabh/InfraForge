import type { Resource } from "@infraforge/domain/resource";
import type { WorkloadProfile, WorkloadVariant } from "@infraforge/domain/workload";
import type { RunInputs } from "@infraforge/contracts/run-inputs";
import { captureRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { captureSnapshot } from "../simulator/snapshot";
import { buildRunReport, type StoredRun } from "../reports/report";
import { classifyComparison } from "../comparison/classify";
import { createWorkloadVariantInput } from "../reruns/variants";
import type { Request, Response, NextFunction } from "express";

// Runs real product-compiled workloads and prints what the live panel, the stored report and the
// comparison receive. A subprocess keeps the rendering test inside the web workspace's import boundary.
// Input is either {profiles, seconds} (unrelated runs) or {source, variants, seconds}: the first run is the
// source and every other run is built by the same server function that creates a traffic experiment.
const at = new Date("2026-11-03T00:00:00.000Z");
const resources: Resource[] = [
  { id: "lb", type: "Load Balancer", x: 0, y: 0 },
  { id: "app", type: "Virtual Machine", x: 1, y: 0, vmExecution: { version: 1, workers: 1, queuedRequests: 8 } },
  { id: "db", type: "Database", x: 2, y: 0 },
];
const topology = { resources, connectionLines: [
  { id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer" as const, targetType: "Virtual Machine" as const, port: 80 },
  { id: "app-db", sourceId: "app", targetId: "db", sourceType: "Virtual Machine" as const, targetType: "Database" as const, port: 5432 },
] };

function run(id: string, input: RunInputs, createdAt: Date, seconds: number, lineage?: { sourceRunId: string }) {
  const engine = createModel2Engine(input, seconds);
  const live: unknown[] = [];
  for (let s = 0; s < seconds; s++) { engine.advance(); live.push(engine.view().traffic); }
  const terminal = captureSnapshot(id, { model2: engine, tickCount: seconds, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0,
    topology, topologyRevision: 0, actions: new Map(), metricsComputedAt: at.toISOString(), metricsTopologyRevision: 0, acknowledge: null }, "terminal");
  const row: StoredRun & { sourceRunId?: string; rerunMode?: string } = { id, infrastructureId: null, runName: id, status: "torn-down", resourceCount: resources.length,
    createdAt, updatedAt: createdAt, stages: [], timeline: [], chaosEvents: [], seed: input.seed, workloadProfile: input.workloadProfile,
    runInputs: input, liveTopology: topology, simulationState: null, terminalSnapshot: JSON.parse(JSON.stringify(terminal)),
    topologyRevision: 0, actions: [], actionCount: 0, ...(lineage ? { ...lineage, rerunMode: "workload-variant", autoStopAtSimulatedSeconds: seconds } : {}) };
  return { row, live, report: buildRunReport(row), evidence: engine.evidence() };
}

const spec = JSON.parse(process.env.JOURNEY_INPUT!) as { learning?: boolean; profiles?: WorkloadProfile[]; source?: WorkloadProfile; variants?: WorkloadVariant[]; seconds: number };
if (spec.learning) {
  await learningJourneyServer();
} else {
const seed = "learner-journey-seed";
const sourceInput = captureRunInputs(topology, spec.source ?? spec.profiles![0], seed);
const inputs = spec.variants ? [sourceInput, ...spec.variants.map(v => createWorkloadVariantInput(sourceInput, v))]
  : [sourceInput, ...spec.profiles!.slice(1).map(profile => captureRunInputs(topology, profile, seed))];
const runs = inputs.map((input, i) => run(`journey-${i + 1}`, input, new Date(at.getTime() + i * 1000), spec.seconds, spec.variants && i > 0 ? { sourceRunId: "journey-1" } : undefined));
console.log(JSON.stringify({
  runs: runs.map(r => ({ live: r.live, report: r.report, evidence: r.evidence })),
  comparison: classifyComparison(runs[0]!.row, runs[1]!.row),
  comparisons: runs.slice(1).map(r => classifyComparison(runs[0]!.row, r.row)),
}));
}

/** Extend the existing journey fixture with loopback HTTP. Only persistence, session
 * lookup, queue delivery and gate completion are stand-ins. Admission, predictions,
 * submission validation, server runtime/terminal writes, reports and progress are real.
 * No external services, environment files or database connection can be opened. */
async function learningJourneyServer() {
  const { mock } = await import("bun:test");
  const { randomUUID } = await import("node:crypto");
  const { default: express } = await import("express");
  // Prisma-shaped test storage, isolated in this subprocess. Unsupported operators fail closed.
  type Row = Record<string, any>;
  const runs: Row[] = [], designs: Row[] = [], actions: Row[] = [], events: Row[] = [], samples: Row[] = [];
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === "OR") return value.some((w: Row) => matches(row, w));
      if (key === "AND") return value.every((w: Row) => matches(row, w));
      if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, expected]) => {
        const actual = row[key];
        switch (op) {
          case "in": return (expected as unknown[]).includes(actual);
          case "notIn": return !(expected as unknown[]).includes(actual);
          case "not": return actual !== expected;
          case "lte": return actual <= (expected as Date);
          case "gt": return actual > (expected as Date);
          default: throw Error(`Unsupported journey storage predicate: ${key}.${op}`);
        }
      });
      return row[key] === value;
    });
  }
  const detached = (row: Row | undefined) => row ? structuredClone({ ...row,
    ...(runs.includes(row) ? { actions: actions.filter((a) => a.deploymentId === row.id),
      evidenceSamples: samples.filter((s) => s.deploymentId === row.id), _count: { actions: actions.filter((a) => a.deploymentId === row.id).length } } : {}) }) : null;
  function table(rows: Row[], defaults: () => Row = () => ({})) {
    const find = ({ where }: Row = {}) => rows.find((r) => matches(r, where));
    return {
      findMany: async ({ where, take, orderBy }: Row = {}) => {
        const found = rows.filter((r) => matches(r, where));
        if (orderBy) found.sort((a, b) => {
          for (const order of Array.isArray(orderBy) ? orderBy : [orderBy]) for (const [key, direction] of Object.entries(order)) {
            if (a[key] < b[key]) return direction === "asc" ? -1 : 1;
            if (a[key] > b[key]) return direction === "asc" ? 1 : -1;
          }
          return 0;
        });
        return (take === undefined ? found : found.slice(0, take)).map(detached);
      },
      findFirst: async (query: Row) => detached(find(query)),
      findUnique: async (query: Row) => detached(find(query)),
      findFirstOrThrow: async (query: Row) => { const r = find(query); if (!r) throw Error("Missing journey row"); return detached(r); },
      findUniqueOrThrow: async (query: Row) => { const r = find(query); if (!r) throw Error("Missing journey row"); return detached(r); },
      count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
      create: async ({ data }: Row) => { const r = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data }; rows.push(r); return detached(r); },
      update: async ({ where, data }: Row) => {
        const r = find({ where }); if (!r) throw Error("Missing journey update");
        for (const [key, value] of Object.entries(data)) r[key] = value && typeof value === "object" && "increment" in value ? r[key] + value.increment : value;
        r.updatedAt = new Date(); return detached(r);
      },
      updateMany: async ({ where, data }: Row) => { const found = rows.filter((r) => matches(r, where)); found.forEach((r) => Object.assign(r, data)); return { count: found.length }; },
    };
  }
  const database = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    deployment: table(runs, () => ({ status: "pending", runtimeActive: false, stages: [], timeline: [], chaosEvents: [],
      simulationState: null, terminalSnapshot: null, topologyRevision: 0, actionSequence: 0, browserSubmission: null,
      challengeExperiment: null, challengeScenario: null, sourceRunId: null, rerunMode: null, autoStopAtSimulatedSeconds: null,
      improvementSourceId: null, learningIntent: null, learningHypothesis: null })),
    infrastructure: table(designs),
    runAction: table(actions, () => ({ status: "requested", scenarioStepId: null, requestedAt: new Date(),
      appliedAt: null, completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null, failureReason: null })),
    outbox: table(events),
    runEvidenceSample: { ...table(samples), createMany: async ({ data }: Row) => { samples.push(...data); return { count: data.length }; } },
  };
  const transaction = async (fn: (tx: typeof database) => Promise<unknown>) => {
    const tables = [runs, designs, actions, events, samples], before = tables.map((rows) => structuredClone(rows));
    try { return await fn(database); }
    catch (error) { tables.forEach((rows, i) => rows.splice(0, rows.length, ...before[i]!)); throw error; }
  };
  mock.module("../lib/prisma", () => ({ prisma: { ...database, $transaction: transaction } }));
  mock.module("../infra/pubsub", () => ({ publishSimulationSnapshot: async () => {}, publishDeploymentFailed: async () => {} }));
  mock.module("../infra/redis", () => ({ redis: { publish: async () => {} } }));
  mock.module("../auth/auth", () => ({ authSettings: { origins: ["http://localhost"] }, auth: { api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const cookie = headers.get("cookie");
      const owner = cookie === "journey=alice" ? "alice" : cookie === "journey=bob" ? "bob" : null;
      return owner ? { user: { id: owner } } : null;
    },
  } } }));
  const { requireSession } = await import("../auth/httpSecurity");
  const { challengeRouter } = await import("../challenges/routes");
  const { deploymentRouter } = await import("../routes/deployment.routes");
  const { createLearningRouter } = await import("../learning/routes");
  const { readLearningAttempts } = await import("../learning/attempts");
  const { startSimulation, startRuntime, stopRuntime } = await import("../simulator/simulator");
  const { claimDeployment } = await import("../deployments/admission");
  const { runSecurityScan } = await import("../stages/securityScan.stages");
  const { runCostEstimation } = await import("../stages/costEstimation.stages");
  const { runValidation } = await import("../stages/validate.stages");
  const app = express(); app.use(express.json()); app.use("/api", requireSession);
  app.use("/api/challenges", challengeRouter);
  app.use("/api/deployments", deploymentRouter);
  app.use("/api/learning", createLearningRouter({ readAttempts: (owner, ids) => readLearningAttempts(owner, ids, { deployment: database.deployment } as never) }));
  // Saved design stand-in: the normal challenge routes still validate its owner/version/input.
  app.put("/api/infrastructure/:id", async (req, res) => {
    const design = designs.find((r) => r.id === req.params.id && r.ownerId === res.locals.userId);
    if (!design) return res.sendStatus(404);
    design.layout = req.body.layout; res.json({ infrastructure: detached(design), updatedInfrastructure: detached(design) });
  });
  app.use((error: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.statusCode ?? 500).json({ message: error.message });
  });
  // Delivery is local and deterministic; the production server runtime performs replay.
  let delivering = false;
  const delivery = setInterval(() => { if (delivering) return; delivering = true;
    void (async () => {
      for (const event of events.filter((e) => !e.delivered)) {
        const row = runs.find((r) => r.id === event.payload.deploymentId)!;
        if (event.eventType === "deployment-created") {
          const input = row.runInputs;
          const security = runSecurityScan(input.resources), cost = runCostEstimation(input.resources);
          const stage = (name: string, result: { summary: string; details: object }) => ({ name, status: "completed",
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), message: result.summary, details: result.details });
          const validation = runValidation(input);
          if (!validation.valid) throw Error("Invalid admitted journey design");
          row.stages = [stage("Validate", { summary: "Design validated", details: { warnings: validation.warnings } }),
            stage("SecurityScan", security), stage("CostEstimate", cost)];
          row.status = "browser";
        } else if (event.eventType === "deployment-replay") {
          const result = await claimDeployment(database as never, row.id);
          if (result !== "claimed") throw Error(`Journey replay was not claimed: ${result}`);
          if (!await startSimulation(row.id)) throw Error("Journey replay did not start");
        } else throw Error(`Unexpected outbox event ${event.eventType}`);
        event.delivered = true;
      }
    })().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { delivering = false; });
  }, 10);
  await startRuntime({ assertHeld: async () => {} } as never);
  const server = app.listen(0, "127.0.0.1");
  const address = server.address() as import("node:net").AddressInfo;
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}/api` }));
  process.on("SIGTERM", () => { clearInterval(delivery); void stopRuntime(); server.closeAllConnections(); server.close(); });
}
