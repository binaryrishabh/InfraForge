import { expect, mock, test } from "bun:test";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Child-only doubles: the normal test process keeps its real pg/ownership modules.
// The real worker, reconciler, execution/qualification fences, container protocol
// and engine run here. This does not claim PostgreSQL locking/trigger evidence.
async function qualifiedRecoveryHarness() {
  let row: any, cuts: any[] = [], result: any = null, reconciled = 0;
  const db: any = { release() {}, async query(sql: string, values: any[] = []) {
    const rows = (value: any[]) => ({ rows: value, rowCount: value.length });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) return rows([]);
    if (sql.startsWith("SELECT r.*") || sql.startsWith("SELECT w.*") || sql.startsWith('SELECT * FROM "FirstStackWork"')) return rows([{ ...row }]);
    if (sql.startsWith('SELECT body FROM "FirstStackCut"')) return rows(cuts.length ? [{ body: cuts.at(-1) }] : []);
    if (sql.startsWith('INSERT INTO "FirstStackCut"')) { cuts.push(values[2]); return rows([]); }
    if (sql.startsWith('INSERT INTO "FirstStackResult"')) { result = values[1]; return rows([]); }
    if (sql.startsWith('INSERT INTO "FirstStackQueueEvent"')) { reconciled++; return rows([]); }
    if (sql.startsWith('UPDATE "FirstStackWork"')) {
      if (sql.includes("AND status='queued'") && row.status !== "queued") return rows([]);
      if (sql.includes("SET status='running'")) {
        // Deliberately no SQL trigger double: the worker's queued-state fence
        // must independently prevent a recovery delivery from launching.
        row.status = "running"; row.token = values[1]; row.daemon = values[2];
      } else if (sql.includes("SET status='recovery'")) row.status = "recovery";
      else if (sql.includes("SET status='terminal'")) row.status = "terminal";
      else throw Error(`Unhandled work update: ${sql}`);
      return rows([{ runId: row.id }]);
    }
    throw Error(`Unhandled fixture SQL: ${sql}`);
  } };
  const pool: any = { connect: async () => db, query: async (sql: string) => {
    if (sql.startsWith('DELETE FROM "FirstStackQueueEvent"')) return { rows: [], rowCount: 0 };
    if (sql.includes("UNION ALL")) return { rows: row.status === "queued" ? [{ id: row.id, operation: "submission" }] : [] };
    throw Error(`Unhandled fixture pool SQL: ${sql}`);
  } };
  mock.module("../firstStack/isolationOwnership", () => ({ withFirstStackOwnership: async (_url: string, store: any, task: any) => {
    const signal = new AbortController().signal;
    return task({ token: store.token, assertHeld: async () => store.check(db),
      commit: async (cut: any) => { await store.check(db); await store.commit(db, cut); } }, signal);
  } }));
  const { verifySubmission, verifierExecutionAllowed } = await import("../firstStack/submissionWorker");
  const { reconcileSubmissionQueue } = await import("../firstStack/queueOperations");
  const { submissionFixture } = await import("./submissionFixture");
  const { qualifiedVerifierFixture } = await import("./qualifiedVerifierFixture");
  const f = await submissionFixture(randomUUID());
  let beforeCut: () => Promise<void> = async () => {};
  const { fixture, configuration } = qualifiedVerifierFixture(f.engine, () => beforeCut());
  const prepare = () => {
    row = { id: randomUUID(), ownerId: f.owner, purpose: "shared", input: f.input,
      inputHash: f.request.browserCut.inputHash, seed: f.request.policy.seed, engine: f.engine,
      lock: f.lock, browserCut: f.request.browserCut, status: "queued", token: null, daemon: null,
      cancelRequested: false, authorized: true, reservedBytes: 37748736 + Buffer.byteLength(f.input) };
    cuts = []; result = null;
  };
  const verify = () => verifySubmission(pool, "unused-protocol-fixture", row.id, configuration);
  const liveBytes = () => row.status === "terminal" ? 0 : row.reservedBytes;

  assert.equal(verifierExecutionAllowed(configuration), true, "Positive control requires an enabled executor");
  prepare(); await verify();
  assert.equal(fixture.launches, 1, "Positive control must actually launch");
  assert.equal(fixture.removed, 1);
  assert.equal(result?.verification, "verified", "Positive control must complete verification");
  assert.equal(row.status, "terminal"); assert.equal(liveBytes(), 0);

  prepare(); const reserved = liveBytes();
  await reconcileSubmissionQueue(pool, { getJob: async () => undefined } as any, fixture.control.identity);
  assert.equal(row.status, "recovery"); assert.equal(reconciled, 1);
  const quarantined = structuredClone(row), launches = fixture.launches;
  // Deliver the quarantined ID twice with every independent execution gate open.
  for (let i = 0; i < 2; i++) {
    assert.equal(verifierExecutionAllowed(configuration), true);
    await verify();
    assert.equal(fixture.launches, launches, "Quarantined duplicate launched an executor");
    assert.deepEqual(row, quarantined); assert.equal(result, null);
    assert.equal(cuts.length, 0); assert.equal(liveBytes(), reserved);
  }

  // Reconciler observes queued, then the worker claims/launches before Redis's
  // missing-job response returns. Hold the real protocol at its first cut.
  prepare();
  const observed = Promise.withResolvers<void>(), lookup = Promise.withResolvers<undefined>();
  const began = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  beforeCut = async () => { began.resolve(); await release.promise; };
  const reconciliation = reconcileSubmissionQueue(pool, { getJob: async () => {
    observed.resolve(); return lookup.promise;
  } } as any, fixture.control.identity);
  await observed.promise;
  // Settle cleanup separately so a worker completion error cannot mask the
  // assertion identifying an overwritten claim when the fence regresses.
  const work = verify().then(() => undefined, error => error);
  try {
    await began.promise;
    assert.equal(row.status, "running");
    const claimed = structuredClone(row);
    lookup.resolve(undefined); await reconciliation;
    assert.deepEqual(row, claimed, "Reconciliation overwrote a winning worker claim");
    assert.equal(reconciled, 1); assert.equal(result, null);
  } finally { lookup.resolve(undefined); release.resolve(); await work; }
  assert.equal(await work, undefined, "Winning worker must complete successfully");
  assert.equal(fixture.launches, launches + 1); assert.equal(result?.verification, "verified");
  assert.equal(fixture.removed, fixture.launches); assert.equal(liveBytes(), 0);
  console.info("Qualified recovery: positive launch, quarantined duplicates fenced, worker claim preserved");
}

if (process.argv.includes("--qualified-recovery-harness")) {
  const deadline = setTimeout(() => { console.error("Qualified recovery fixture deadline"); process.exit(1); }, 20000);
  try { await qualifiedRecoveryHarness(); } finally { clearTimeout(deadline); }
} else {
  test("qualified executor launches ordinary work but never reexecutes quarantined work and preserves a winning claim", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", fileURLToPath(import.meta.url), "--qualified-recovery-harness"],
      { stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    expect(output).toContain("Qualified recovery: positive launch, quarantined duplicates fenced, worker claim preserved");
  }, 30000);
}
