import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical } from "@infraforge/simulation/internal-product";
import { requireCapability as enforce, authorizeCapability, type CapabilityPolicy } from "../../capabilities/policy";
import { layout, workload } from "../integration/scenario";
import { captureRunInputs } from "../../deployments/runInputs";
import { latestChallenge, challengeSeed } from "../../challenges/registry";
import { recordedExperiment } from "../../challenges/experiment";
import { answers, tier } from "../challengeHarness";
import { internalProductFixture } from "../model2Fixture";

const enforceCapability = enforce, authorize = authorizeCapability;
const owner = "fixture-owner", id = "11111111-1111-4111-8111-111111111111";
const entry = latestChallenge("cache-matters")!, definition = entry.definition;
let effects = 0, checks: string[] = [];
const denied = true;
const deny: CapabilityPolicy = { authorize: (_subject, request) => {
  checks.push(request.capability);
  return { allowed: !denied, revision: "fixture/1", reason: "fixture capability denied", allowance: { kind: "unavailable" } };
} };
mock.module("../../capabilities/policy", () => ({ requireCapability: (subject: string, request: Parameters<typeof enforce>[1]) => enforceCapability(subject, request, deny), authorizeCapability: authorize }));
mock.module("../../executionIdentity/launch", () => ({ verifyLaunch() {}, assertExecutionHost() {} }));
mock.module("../../utils/config", () => ({ config: { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture" } }));
mock.module("../../internalModel2/identity", () => ({ contentHash: (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex"), executionSource: "authored-fixture-source", executionSourceFiles: () => [], hasher: { algorithm: "sha256-utf8/1", hash: (v: string) => createHash("sha256").update(v).digest("hex") } }));
let design: any = { id, ownerId: owner, name: "Fixture", layout }, source: any;
const effect = async () => { effects++; throw Error("fixture unexpected side effect"); };
const tx: any = { $queryRaw: async () => [],
  infrastructure: { findUnique: async () => design, findFirst: async () => design, findMany: async () => [], create: effect, update: effect },
  deployment: { findFirst: async () => source, findUnique: async () => source, count: async () => 0, create: effect, update: effect },
  outbox: { create: effect }, runAction: { findMany: async () => [], findFirst: async () => null, create: effect },
};
tx.$transaction = async (fn: any) => fn(tx);
mock.module("../../lib/prisma", () => ({ prisma: tx }));
let existing: any = null, lessonExisting: any = null, hasGrant = true;
const fixture = internalProductFixture();
const client: any = { release() {}, query: async (sql: string) => {
  if (/INSERT INTO|UPDATE /.test(sql)) return effect();
  if (sql.includes('FROM "InternalModel2Grant"')) return { rows: hasGrant ? [{ scope: "operator" }] : [] };
  if (sql.includes('SELECT * FROM "InternalModel2Run"')) return { rows: existing ? [existing] : [] };
  if (sql.includes('count(*)')) return { rows: [{ total: 0, owned: 0, active: 0 }] };
  if (sql.includes('SELECT layout,')) return { rows: [{ layout: fixture.layout, updatedAt: new Date(fixture.request.expectedDesignUpdatedAt), challengeId: null }] };
  if (sql.includes('FROM "Infrastructure"')) return { rows: lessonExisting ? [lessonExisting] : [] };
  return { rows: [] };
} };
mock.module("pg", () => ({ Pool: class { connect = async () => client; query = client.query; } }));

const { deploymentRouter } = await import("../../routes/deployment.routes");
const { infrastructureRouter } = await import("../../routes/infrastructure.routes");
const { challengeRouter } = await import("../../challenges/routes");
const { improvementRouter } = await import("../../challenges/improvementRoutes");
const { rerunRouter } = await import("../../reruns/routes");
const { requestRunAction } = await import("../../actions/persistence");
const { admit } = await import("../../internalModel2/store");
const { createLessonDesign, lessonLayout } = await import("../../internalModel2/lessonAuthoring");
const { internalModel2Router } = await import("../../internalModel2/routes");
const { contentHash } = await import("../../internalModel2/identity");
const res: any = { locals: { userId: owner }, status() { return this; }, json() { return this; }, set() { return this; }, type() { return this; }, send: effect };
async function route(router: any, method: string, path: string, body: unknown = {}, params = {}, query = {}) {
  const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  return layer.route.stack[0].handle({ body, params, query, path }, res, () => {});
}
let cases = 0;
async function refuses(run: () => Promise<unknown>, capability: string) {
  checks = []; const before = effects;
  await assert.rejects(run, /fixture capability denied/);
  assert.equal(effects, before); assert.ok(checks.includes(capability), `${capability}: ${checks}`); cases++;
}
const input = captureRunInputs(layout, workload, "fixture-seed");
source = { id, infrastructureId: id, runName: "Fixture", status: "torn-down", resourceCount: 5, createdAt: new Date(), updatedAt: new Date(), topologyRevision: 0,
 stages: [], timeline: [], chaosEvents: [], workloadProfile: input.workloadProfile, seed: input.seed, simulationState: null, runInputs: input, liveTopology: layout,
 terminalSnapshot: { version: 1, kind: "terminal", capturedAt: new Date().toISOString(), topologyRevision: 0, simulatedSeconds: 120, metrics: {} } };
await refuses(() => route(deploymentRouter, "post", "/", { infrastructureId: id }), "run.start");
await refuses(() => route(infrastructureRouter, "post", "/", { name: "Fixture", layout }), "design.persist");
await refuses(() => route(infrastructureRouter, "put", "/:infrastructureId", { name: "Fixture" }, { infrastructureId: id }), "design.persist");
await refuses(() => route(challengeRouter, "post", "/:id/workspace", { fresh: true }, { id: definition.id }), "design.persist");
await refuses(() => route(challengeRouter, "post", "/:id/workspace", { copyFrom: id }, { id: definition.id }), "design.persist");
await refuses(() => route(rerunRouter, "post", "/:id/reruns", { mode: "exact", matchedStop: false }, { id }), "run.start");
const { currentDesignInput, rerunInputHash } = await import("../../reruns/options");
await refuses(() => route(rerunRouter, "post", "/:id/reruns", { mode: "current-design", matchedStop: false, expectedInputHash: rerunInputHash(currentDesignInput(input, layout)) }, { id }), "run.start");
const challengeLayout = tier(2, { cache: true });
const prediction = answers(definition, { database: "healthy", busiest: "Database" });
design = { ...design, challengeId: definition.id, challengeVersion: definition.version, layout: challengeLayout };
await refuses(() => route(challengeRouter, "post", "/:id/attempts", { infrastructureId: id, prediction }, { id: definition.id }), "run.start");
source = { ...source, challengeId: definition.id, challengeVersion: definition.version, challengeSpecHash: entry.hash, challengePrediction: prediction,
 evaluationStopAtSimulatedSeconds: definition.evaluationSeconds, challengeExperiment: recordedExperiment(definition),
 runInputs: captureRunInputs(challengeLayout, definition.workload, challengeSeed(definition)) };
await refuses(() => route(improvementRouter, "post", "/:id/improvement-workspace", { sourceRunId: id }, { id: definition.id }), "design.persist");
source = { ...source, challengeId: null, status: "live", runtimeActive: true, actionSequence: 0, runInputs: input, liveTopology: layout };
await refuses(() => requestRunAction(id, owner, { kind: "load", parameters: { targetLoadFraction: 1 } }), "run.control");
await refuses(() => requestRunAction(id, owner, { kind: "topology", parameters: { ...layout, expectedRevision: 0 } }), "run.control");
await refuses(() => createLessonDesign(owner), "design.persist");
await refuses(() => admit(owner, fixture.request), "load.recorded.accept");
// Allow the trace decision so this checks the separate execution admission.
const baseEnforce = enforceCapability;
mock.module("../../capabilities/policy", () => ({ authorizeCapability: authorize, requireCapability: (subject: string, request: Parameters<typeof enforce>[1]) => request.capability === "load.recorded.accept" ? {} : baseEnforce(subject, request, deny) }));
await refuses(() => admit(owner, fixture.request), "run.start");
await refuses(() => admit(owner, fixture.request, () => { throw Error("fixture lesson policy must not be built"); }), "run.start");
// Returning the same idempotent admission never consumes another slot.
existing = { requestHash: contentHash(fixture.request), id };
checks = []; assert.equal((await admit(owner, fixture.request)).created, false); assert.deepEqual(checks, []); cases++;
// Existing lesson design likewise remains available under a denying provider.
lessonExisting = { ownerId: owner, layout: lessonLayout }; checks = []; await createLessonDesign(owner); assert.deepEqual(checks, []); cases++;
// Technical/ownership checks precede commercial decisions.
design = null; checks = []; await assert.rejects(() => route(deploymentRouter, "post", "/", { infrastructureId: id }), /Infrastructure not found/); assert.deepEqual(checks, []); cases++;
await refuses(() => route(internalModel2Router, "get", "/runs/:id/report", {}, { id }, { format: "html" }), "artifact.export");
hasGrant = false; checks = []; await assert.rejects(() => admit(owner, fixture.request), /Resource not found/); assert.deepEqual(checks, []); cases++;
// Fixed prediction integrity is checked even though all public capabilities are free.
design = { id, ownerId: owner, name: "Fixture", challengeId: definition.id, challengeVersion: definition.version, layout: challengeLayout };
checks = []; await assert.rejects(() => route(challengeRouter, "post", "/:id/attempts", { infrastructureId: id, prediction: null }, { id: definition.id }), /prediction/i); assert.deepEqual(checks, []); cases++;
const stopping = { id: "stop", deploymentId: id, kind: "teardown", parameters: {}, sequence: 1, status: "requested", requestedAt: new Date(), appliedAt: null, completedAt: null, appliedSimulatedSeconds: null, completedSimulatedSeconds: null, outcome: null, failureReason: null };
tx.runAction.findMany = async () => [stopping]; checks = [];
assert.equal((await requestRunAction(id, owner, { kind: "teardown", parameters: {} })).id, "stop"); assert.deepEqual(checks, []); cases++;
assert.equal(effects, 0);
console.log(JSON.stringify({ cases, protectedSideEffects: effects }));
