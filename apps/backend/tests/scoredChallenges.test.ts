import { fixtureChallenges, fixtureDefinition, fixtureDirectory } from "./scoringFixtures";
import { privateBundleSchema } from "../firstStack/scoredChallenges/schema";
import { expect, test } from "bun:test";
import express from "express";
import { challengeDefinition, createChallengeRegistry, publicChallenge, admitScoredChallenge, validateChallengeDesign } from "../firstStack/scoredChallenges/definition";
import { challengeFence, executeScoredChallenge } from "../firstStack/scoredChallenges/execution";
import { evaluateWorkload } from "../firstStack/scoredChallenges/scoring";
import { publicScore } from "../firstStack/scoredChallenges/projection";
import { canonical, designRevision, hash } from "../firstStack/canonical";
import { inputDigest, isolatedCut } from "../firstStack/isolationProtocol";
import { instantiatePreparedFirstStack, prepareFirstStackExecution } from "../firstStack/execution";
import { captureExecutionCut } from "../firstStack/executionCut";
import { createSubmissionService } from "../firstStack/admission";
import { createSubmissionRouter } from "../firstStack/submissionRoutes";
import { errorHandler } from "../utils/middleware";
import { firstStackRunRecord } from "../runRecords/firstStack";

const owner = "scored-fixture", engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` };
const limits = { wallMs: 60000, cpuUs: 20000000, rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 };
// Qualification test executor only; production exclusively uses the contained
// executor. Receipts here do not claim Docker or Linux host qualification.
function qualification(input: string) {
  const saved = JSON.parse(input), prepared = prepareFirstStackExecution(saved.owner, saved.layout, saved.candidate, saved.recording, saved.policy);
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  const cut = isolatedCut(captureExecutionCut(prepared, runtime, 1, limits, null).value, engine.source, inputDigest(input));
  return { status: "completed", durablePrefix: cut, receipt: { cleanup: "removed", fixture: "in-process software qualification only" }, summary: "{}", journal: "", interruption: null } as any;
}
async function fixture(cores = 4, workers = 8, queue = 64) {
  const sample = await publicChallenge(owner, "lose-an-app-server", "2", fixtureChallenges), sidecar = sample.layout.firstStack;
  for (const n of sidecar.nodes.filter(n => n.owner === "compute")) {
    n.cores = cores; n.workers = workers; n.queue = queue; sidecar.placement.find(h => h.id === n.host)!.cores = cores;
  }
  const admitted = await admitScoredChallenge(owner, sample.layout, { id: sample.id, version: sample.version }, sample.workload, sample.policy, fixtureChallenges);
  const input = canonical({ owner, layout: sample.layout, candidate: admitted.prepared.sidecar, recording: sample.workload, policy: sample.policy });
  const result = qualification(input);
  const run = { purpose: "scored", ownerId: owner, engine, input, inputHash: inputDigest(input), lock: admitted.prepared.lock,
    browserCut: result.durablePrefix, workload: { challenge: admitted.reference },
    lineage: { kind: "design", infrastructureId: "00000000-0000-4000-8000-000000000029", designRevision: designRevision(sample.layout), updatedAt: "2026-10-22T00:00:00.000Z" } };
  return { sample, admitted, result, run };
}
async function scored(f: Awaited<ReturnType<typeof fixture>>, transform: (r: any, input: string) => any = r => r) {
  let active = 0, executions = 0;
  const fence = challengeFence({ async check() {}, async commit() { throw Error("Hidden cut reached visible storage"); } }, engine.source);
  const authority = { token: "test", async assertHeld(signal: AbortSignal) { signal.throwIfAborted(); },
    async commit(cut: any) { await fence.commit({} as any, cut); } };
  const score = await executeScoredChallenge(f.run, f.result, authority, new AbortController().signal, fence.select, async (input, a, signal) => {
    expect(active++).toBe(0); executions++;
    const result = transform(qualification(input), input);
    if (result.durablePrefix) await a.commit(result.durablePrefix, signal);
    active--;
    return result;
  }, fixtureChallenges);
  if (score && !("workloads" in score)) throw Error("Fake scoring unavailable");
  return { score: score!, executions };
}

test("authored scenario qualifies several capacity designs with real routed caller evidence during app loss", async () => {
  for (const capacities of [[4, 8, 64], [4, 16, 32]]) {
    const f = await fixture(...capacities as [number, number, number]), { score, executions } = await scored(f);
    expect(executions).toBe(2); expect(score.systemPassed).toBe(true);
    expect(score.assessment).toBe("incomplete"); expect(score.earned).toBe(8); expect(score.assessed).toBe(8); expect(score.pending).toBe(2);
    for (const w of score.workloads) {
      expect(w.evidence!.cut.counts.completed).toBe(JSON.parse(w.input).recording.rows.length);
      expect(w.outcomes.find(c => c.id === "fault-survival")?.outcome).toBe("pass");
      expect(w.outcomes.find(c => c.id === "cost-subtotal")).toMatchObject({ outcome: "Unknown", measured: null });
      const events = w.evidence!.cut.reportCapture!.events;
      expect(events.some(e => e.kind === "caller-terminal" && e.detail.outcome === "completed")).toBe(true);
      const terminal = events.find(e => e.kind === "caller-terminal" && e.detail.outcome === "completed")!;
      expect(events.some(e => e.kind === "lb-selected" && e.detail.root === terminal.work?.rootId)).toBe(true);
      expect(events.some(e => e.kind === "db-terminal" && e.work?.rootId === terminal.work?.rootId)).toBe(true);
    }
  }
});
test("the vulnerable starter fails under held-out burst pressure; health eligibility grants no pass", async () => {
  const { score } = await scored(await fixture(1, 1, 0));
  expect(score.systemPassed).toBe(false);
  expect(score.workloads.some(w => w.outcomes.some(c => c.id === "fault-survival" && c.outcome === "fail"))).toBe(true);
});
test("hidden schedules, faults, rubric and inputs never appear in sample or run responses", async () => {
  const f = await fixture(), { score } = await scored(f);
  const result = { verification: "verified", actual: f.result.durablePrefix.fingerprint, score }, resultHash = hash(result);
  const row: any = { ...f.run, id: "scored-result", createdAt: new Date(), status: "terminal", durablePrefix: f.result.durablePrefix, result, resultHash };
  const pool: any = { query: async () => ({ rows: [row] }) };
  const response = await createSubmissionService(pool).read(owner, row.id);
  const visible = JSON.stringify([f.sample, response, publicScore(result, resultHash)]);
  for (const w of score.workloads) { expect(visible).not.toContain(w.workload.id); expect(visible).not.toContain(w.inputHash); expect(visible).not.toContain(w.input); }
  expect(visible).not.toContain('"rubric":'); expect(visible).not.toContain('"threshold":'); expect(visible).not.toContain('"hidden":');
  expect((response as any).score.criteria.find((c: any) => c.id === "cost-subtotal").outcome).toBe("Unknown");
  expect(publicScore({ ...result, score: { ...score, earned: 100 } }, resultHash)).toBeNull();
  expect(firstStackRunRecord(row).experiment.input).toEqual(JSON.parse(f.run.input));
});
test("sample HTTP endpoint has an explicit projection and inherits closed admission", async () => {
  const app = express(); app.use((_req, res, next) => { res.locals.userId = owner; next(); });
  app.use(createSubmissionRouter({} as any, { enabled: true, available: async () => true, engine }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"), address = server.address() as any;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/challenges/lose-an-app-server/versions/2/sample`);
    expect(response.status).toBe(200); const body = await response.text();
    expect(body).toContain("visible-sample"); expect(body).not.toContain("heldout"); expect(body).not.toContain('"rubric"');
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
test("a self-consistent forged browser cut cannot start hidden execution or earn a score", async () => {
  const f = await fixture();
  f.run.browserCut = isolatedCut({ ...f.run.browserCut.cut, counts: { ...f.run.browserCut.cut.counts, completed: 999 } }, engine.source, f.run.inputHash);
  const { score, executions } = await scored(f);
  expect(score).toBeNull(); expect(executions).toBe(0);
});
test("saved revision, out-of-domain demands and forged sample policy are refused", async () => {
  const f = await fixture(), definition = fixtureDefinition("lose-an-app-server");
  const changed = structuredClone(f.sample.layout); ((changed as Record<string, unknown>).resources as any[])[0].x++;
  expect(() => validateChallengeDesign(changed, definition)).toThrow("revision changed");
  const demand = structuredClone(f.sample.layout); demand.firstStack.operations[0]!.cpuUs = 0;
  expect(() => validateChallengeDesign(demand, definition)).toThrow("outside allowed");
  await expect(admitScoredChallenge(owner, f.sample.layout, { id: definition.id, version: definition.version }, f.sample.workload, { ...f.sample.policy, seed: "cheat" })).rejects.toThrow("exact server-owned");
  const db: any = { async query(sql: string) {
    if (sql.includes('SELECT id,"requestHash"')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT id,layout')) return { rows: [{ id: f.run.lineage.infrastructureId, layout: f.sample.layout, updatedAt: new Date("2026-10-22T00:00:01.000Z") }] };
    return { rows: [] };
  }, release() {} };
  const service = createSubmissionService({ connect: async () => db } as any,
    { enabled: true, available: async () => true, engine });
  await expect(service.submit(owner, { infrastructureId: f.run.lineage.infrastructureId, expectedDesignUpdatedAt: f.run.lineage.updatedAt,
    expectedDesignRevision: f.run.lineage.designRevision, idempotencyKey: "stale", purpose: "scored", engine,
    workload: f.sample.workload, policy: f.sample.policy, browserCut: f.run.browserCut, challenge: { id: definition.id, version: definition.version } })).rejects.toThrow("Saved design changed");
});
test("threshold equality is deterministic; missing and interrupted evidence remains Unknown", async () => {
  const f = await fixture(), { score } = await scored(f), w = score.workloads[0]!, definition = fixtureDefinition("lose-an-app-server");
  const workload = definition.hidden[0]!;
  const outcomes = evaluateWorkload(definition, workload, w.input, w.evidence);
  expect(evaluateWorkload(definition, workload, w.input, w.evidence)).toEqual(outcomes);
  const p95 = outcomes.find(c => c.id === "slo")!.measured!;
  definition.rubric.criteria.find(c => c.id === "slo")!.threshold = p95;
  expect(evaluateWorkload(definition, workload, w.input, w.evidence).find(c => c.id === "slo")!.outcome).toBe("pass");
  definition.rubric.criteria.find(c => c.id === "slo")!.threshold = p95 - 1;
  expect(evaluateWorkload(definition, workload, w.input, w.evidence).find(c => c.id === "slo")!.outcome).toBe("fail");
  expect(evaluateWorkload(definition, workload, w.input, null).every(c => c.outcome === "Unknown" && c.measured === null && c.reason)).toBe(true);
  const interrupted = isolatedCut({ ...w.evidence!.cut, completeness: { ...w.evidence!.cut.completeness, horizonReached: false } }, engine.source, w.inputHash);
  expect(evaluateWorkload(definition, workload, w.input, interrupted).every(c => c.outcome === "Unknown")).toBe(true);
});
test("unconfirmed cleanup retains recovery; lost evidence cannot grant required points", async () => {
  const f = await fixture();
  await expect(scored(f, r => ({ ...r, receipt: { cleanup: "unconfirmed" } }))).rejects.toThrow("cleanup unconfirmed");
  const { score } = await scored(f, r => ({ ...r, durablePrefix: null, status: "interrupted" }));
  expect(score.earned).toBe(0); expect(score.pending).toBe(10); expect(score.systemPassed).toBe(false);
});
test("versioned data refuses missing provenance, uncovered windows, duplicate criteria and empty hidden suites", () => {
  const definition = fixtureDefinition("lose-an-app-server");
  expect(() => challengeDefinition("lose-an-app-server", "1")).toThrow("version unavailable");
  for (const mutate of [
    (d: typeof definition) => { d.hidden = []; },
    (d: typeof definition) => { d.hidden[0]!.provenance = ""; },
    (d: typeof definition) => { d.hidden[0]!.observation.fromUs = 60000; },
    (d: typeof definition) => { d.rubric.criteria.push(d.rubric.criteria[0]!); },
  ]) { const copy = structuredClone(definition); mutate(copy); expect(privateBundleSchema.safeParse({ schema: "infraforge-private-scoring/1", id: copy.id, challengeVersion: copy.version, version: "fake-2", hidden: copy.hidden, rubric: copy.rubric }).success).toBe(false); }
});
test("the admission transaction pins the exact challenge in immutable workload metadata", async () => {
  const f = await fixture(), inserted: { sql: string; values: any[] }[] = [];
  const db: any = { async query(sql: string, values: any[] = []) {
    inserted.push({ sql, values });
    if (sql.includes('AS live')) return { rows: [{ recorded: "500", live: "0", runs: "0", cuts: "0", results: "0", replays: "0", physical: "0" }] };
    if (sql.includes('SELECT id,"requestHash"')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT id,layout')) return { rows: [{ id: f.run.lineage.infrastructureId, layout: f.sample.layout, updatedAt: new Date(f.run.lineage.updatedAt) }] };
    if (sql.includes('SELECT count(*)::int AS count')) return { rows: [{ count: 0 }] };
    if (sql.includes('AS queued')) return { rows: [{ queued: 0, owned: 0, bytes: 0, retained: 0 }] };
    return { rows: [] };
  }, release() {} };
  const service = createSubmissionService({ connect: async () => db } as any,
    { enabled: true, available: async () => true, engine });
  await service.submit(owner, { infrastructureId: f.run.lineage.infrastructureId, expectedDesignUpdatedAt: f.run.lineage.updatedAt,
    expectedDesignRevision: f.run.lineage.designRevision, idempotencyKey: "scored", purpose: "scored", engine,
    workload: f.sample.workload, policy: f.sample.policy, browserCut: f.run.browserCut, challenge: { id: f.sample.id, version: f.sample.version } });
  const run = inserted.find(q => q.sql.includes('INSERT INTO "FirstStackRun"'))!;
  expect(run.values[10]).toMatchObject({ origin: "server-challenge", challenge: { id: f.sample.id, version: f.sample.version, definitionHash: hash(challengeDefinition(f.sample.id, f.sample.version)) } });
  expect(run.values[6]).toBe(f.run.input);
  expect(inserted.some(q => q.sql.includes('INSERT INTO "FirstStackOutbox"'))).toBe(true);
  expect(inserted.at(-1)!.sql).toBe("COMMIT");
});
test("changed definition pins and hidden compile locks fail closed before score publication", async () => {
  const changed = await fixture(); changed.run.workload.challenge.definitionHash = "f".repeat(64);
  await expect(scored(changed)).rejects.toThrow("Pinned scored challenge");
  await expect(scored(await fixture(), r => ({ ...r, durablePrefix: isolatedCut({ ...r.durablePrefix.cut,
    lock: { ...r.durablePrefix.cut.lock, compiledHash: "f".repeat(64) } }, engine.source, r.durablePrefix.inputHash) }))).rejects.toThrow("compile lock changed");
});

test("missing or mismatched private bundles execute no hidden work and publish only scoring unavailable", async () => {
  const f = await fixture(), definition = fixtureChallenges.definition(f.sample.id, f.sample.version);
  for (const directory of [undefined, "missing-private-scoring-store", fixtureDirectory]) {
    const selected = structuredClone(definition);
    if (directory === fixtureDirectory) selected.scoring.sha256 = "0".repeat(64);
    const run = { ...f.run, workload: { challenge: { ...f.run.workload.challenge, definitionHash: hash(selected) } } };
    let executions = 0;
    const unavailable = await executeScoredChallenge(run, f.result, {} as any, new AbortController().signal, () => {}, async () => {
      executions++; throw Error("Private work must not start");
    }, createChallengeRegistry([selected], () => directory));
    expect(executions).toBe(0);
    expect(unavailable).toEqual({ schema: "infraforge-scoring-unavailable/1", state: "unavailable", message: "Scoring unavailable" });
    if (!unavailable || "workloads" in unavailable) throw Error("Expected unavailable scoring state");
    const result = { verification: "verified", score: unavailable }, row: any = { ...f.run, id: "unavailable", createdAt: new Date(),
      status: "terminal", durablePrefix: f.result.durablePrefix, result, resultHash: hash(result) };
    const response: any = await createSubmissionService({ query: async () => ({ rows: [row] }) } as any).read(owner, row.id);
    expect(response.score).toEqual(unavailable);
    expect(JSON.stringify(response.score)).not.toMatch(/earned|assessed|systemPassed|workloads|rubric/);
    expect(publicScore({ ...result, score: { ...unavailable, input: "PRIVATE-SENTINEL" } }, hash({ ...result, score: { ...unavailable, input: "PRIVATE-SENTINEL" } }))).toEqual(unavailable);
  }
});
