import { expect } from "bun:test";
import { Queue } from "bullmq";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { internalProductFixture } from "../model2Fixture";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { alterRecordedField } from "./model2Barriers";
import { checkModel2Failures } from "./model2FailureChecks";
export async function checkInternalModel2(h: LocalHarness, sessions: SessionFixtures, designs: string[]) {
  const cookie = h.cookie, rows: string[] = [], grants: string[] = [], queue = new Queue("internal-model2", { connection: h.redis });
  const processStart = h.processes().length;
  const proof: Record<string, any> = { schema: "infraforge-model2-product-proof/1", commit: process.env.GITHUB_SHA ?? "local-unpublished", startedAt: new Date().toISOString(), success: false };
  const failureSummary = () => Object.fromEntries(Object.entries(proof.failures ?? {}).map(([kind, raw]) => {
    const value = raw as Record<string, unknown>;
    return [kind, Object.fromEntries(["id", "status", "sequence", "throughUs", "retained", "before", "replay", "unauthorizedReport"].filter((key) => key in value).map((key) => [key, value[key]]))];
  }));
  const file = join(tmpdir(), `infraforge-model2-${randomUUID()}.json`);
  const read = async (id: string) => (await h.sql.query('SELECT * FROM "InternalModel2Run" WHERE id=$1', [id])).rows[0];
  const base = "/internal/model2", fixture = internalProductFixture();
  let owner = "";
  try {
    proof.services = { postgres: (await h.sql.query("SHOW server_version")).rows[0].server_version,
      redis: /^redis_version:(.+)$/m.exec(await h.redis.info("server"))?.[1]?.trim() };
    await h.stop("worker");
    const session = await (await fetch(h.api + "/auth/get-session", { headers: h.headers })).json() as { user: { id: string } };
    owner = session.user.id;
    const legacyCount = (await h.sql.query('SELECT count(*)::int AS n FROM "Deployment"')).rows[0].n;
    expect((await fetch(h.api + base + "/runs", { headers: { Origin: h.origin } })).status).toBe(401);
    await h.request(base + "/runs", undefined, "GET", 404);
    await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Disposable internal product proof\')', [owner]); grants.push(owner);
    const saved = (await h.request("/infrastructure", { name: "Internal Model-2 fixture", layout: fixture.layout }, "POST", 201)).createdInfrastructure;
    designs.push(saved.id);
    const request = { ...fixture.request, infrastructureId: saved.id, expectedDesignUpdatedAt: saved.updatedAt };
    const create = async (key: string) => { const result = await h.request(base + "/runs", { ...request, idempotencyKey: key }, "POST", 202); rows.push(result.id); return result.id as string; };
    // A failed admission transaction cannot retain either its run or its outbox entry.
    await h.sql.query(`CREATE FUNCTION model2_fixture_admission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."eventType"='model2-internal-created' THEN RAISE EXCEPTION 'fixture admission rollback'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER model2_fixture_admission_failure BEFORE INSERT ON "Outbox" FOR EACH ROW EXECUTE FUNCTION model2_fixture_admission_failure()`);
    try { await h.request(base + "/runs", { ...request, idempotencyKey: "admission-rollback" }, "POST", 500); }
    finally { await h.sql.query('DROP TRIGGER model2_fixture_admission_failure ON "Outbox"; DROP FUNCTION model2_fixture_admission_failure()'); }
    expect((await h.sql.query('SELECT 1 FROM "InternalModel2Run" WHERE "ownerId"=$1 AND "idempotencyKey"=\'admission-rollback\'', [owner])).rowCount).toBe(0);
    const initial = await Promise.all([0, 1].map(async () => {
      const response = await fetch(h.api + base + "/runs", { method: "POST", headers: h.headers, body: JSON.stringify(request) });
      return { status: response.status, body: await response.json() as { id: string } };
    }));
    expect(initial.map((r) => r.status).sort()).toEqual([200, 202]);
    // Concurrent responses may arrive in either order; inspect durable identity.
    const found = (await h.sql.query('SELECT * FROM "InternalModel2Run" WHERE "ownerId"=$1 AND "idempotencyKey"=$2', [owner, request.idempotencyKey])).rows;
    expect(found).toHaveLength(1); const id = found[0].id; rows.push(id);
    expect(initial.every((r) => r.body.id === id)).toBe(true);
    expect((await h.sql.query('SELECT 1 FROM "Outbox" WHERE "eventType"=\'model2-internal-created\' AND payload->>\'internalModel2RunId\'=$1', [id])).rowCount).toBe(1);
    expect(found[0].status).toBe("queued"); expect(found[0].evidence).toBeNull();
    await h.request(base + "/runs", { ...request, contract: { ...request.contract, seed: "different" } }, "POST", 409);
    await h.request(base + "/runs", { ...request, ownerId: "someone-else" }, "POST", 400);
    const cancelled = await create("cancelled-before-worker"); await h.request(`${base}/runs/${cancelled}/cancel`, {}, "POST", 202);
    expect((await read(cancelled)).status).toBe("cancelled"); expect((await read(cancelled)).sequence).toBe(0);
    const quotaRuns = await Promise.all(["quota-a", "quota-b", "quota-c"].map(create));
    await h.request(base + "/runs", { ...request, idempotencyKey: "quota-exhausted" }, "POST", 409);
    // A retry of the original request remains safe even while admission is full.
    expect((await h.request(base + "/runs", request, "POST", 200)).id).toBe(id);
    for (const quotaId of quotaRuns) await h.request(`${base}/runs/${quotaId}/cancel`, {}, "POST", 202);
    const bob = await sessions.create(); await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Disposable second-user proof\')', [bob.user.id]); grants.push(bob.user.id);
    h.cookie = bob.cookie;
    for (const suffix of ["report", "input", "replay"]) await h.request(`${base}/runs/${id}/${suffix}`, undefined, "GET", 404);
    await h.request(`${base}/runs/${id}/cancel`, {}, "POST", 404);
    await h.request(base + "/runs", { ...request, idempotencyKey: "foreign-design" }, "POST", 404);
    expect((await h.request(base + "/runs")).runs).toEqual([]); h.cookie = cookie;
    const missing = structuredClone(request); delete missing.contract.application;
    const refused = await h.request(base + "/runs", { ...missing, idempotencyKey: "missing-profile" }, "POST", 422);
    expect(refused.diagnostics.some((d: any) => d.code === "MISSING_APPLICATION_PROFILE")).toBe(true);
    await h.request(base + "/runs", { ...request, idempotencyKey: "stale-design", expectedDesignUpdatedAt: "2020-01-01T00:00:00.000Z" }, "POST", 409);
    const unsupportedLayout = structuredClone(fixture.layout); unsupportedLayout.resources[1]!.type = "Database" as "Object Storage";
    const unsupported = (await h.request("/infrastructure", { name: "Unsupported internal scope", layout: unsupportedLayout }, "POST", 201)).createdInfrastructure; designs.push(unsupported.id);
    expect((await h.request(base + "/runs", { ...request, infrastructureId: unsupported.id, expectedDesignUpdatedAt: unsupported.updatedAt, idempotencyKey: "unsupported-resource" }, "POST", 422)).diagnostics[0].code).toBe("INTERNAL_SCOPE");
    const oversized = await fetch(h.api + base + "/runs", { method: "POST", headers: h.headers, body: JSON.stringify({ ...request, padding: "x".repeat(270000) }) }); expect(oversized.status).toBe(413);
    const input = await h.request(`${base}/runs/${id}/input`);
    expect(input.input.ownerId).toBe(owner); expect(input.input.compiled.input.arrivals[0].trace.rows).toHaveLength(19);
    proof.admission = { id, inputHash: input.inputHash, queued: true, sameKeyRows: 1, outboxRows: 1, rollbackNoRow: true, ownerIsolation: true, concurrentActiveQuota: 4, quotaRefusal: 409 };
    await h.startWorker();
    const complete = await until(async () => { const row = await read(id); return row.status === "completed" ? row : undefined; }, "real worker completes internal saved-design execution", 30000);
    const report = (await h.request(`${base}/runs/${id}/report`)).report;
    expect(report.model).toBe("2"); expect(report.internal).toBe(true); expect(report.problems).toEqual([]);
    expect(report.state.objects[0].objects).toEqual([{ namespace: "n", key: "retained", generation: 3, bytes: 7, content: "retained" }]);
    expect(report.state.commands.results.find((r: any) => r.id === "after-recovery").reply.object.bytes).toBe(20);
    expect(report.usage.measurements.find((m: any) => m.family === "object-store")).toMatchObject({ storedBytes: "7", generation: 3, byteUs: "264472" });
    expect(report.checkpoints.find((c: any) => c.atUs === 5000).endpoints.objects.ready).toBe(false);
    expect(report.checkpoints.find((c: any) => c.atUs === 9000).endpoints.objects.ready).toBe(true);
    expect(report.unknown.join(" ")).toContain("full pricing");
    const beforeReplay = await read(id), replay = (await h.request(`${base}/runs/${id}/replay`)).replay;
    expect(replay.kind).toBe("MatchesRecordedPrefix"); expect(replay.complete).toBe(true); expect(await read(id)).toEqual(beforeReplay);
    const html = await fetch(h.api + `${base}/runs/${id}/report?format=html`, { headers: h.headers });
    expect(html.status).toBe(200); expect(html.headers.get("content-security-policy")).toContain("default-src 'none'"); expect(await html.text()).toContain("Observed modeled facts");
    const duplicate = await queue.add("duplicate-terminal", { internalModel2RunId: id }, { jobId: randomUUID() });
    await until(async () => await duplicate.getState() === "completed" ? true : undefined, "duplicate delivery settles");
    expect(await read(id)).toEqual(beforeReplay);
    expect((await h.sql.query('SELECT count(*)::int AS n FROM "Deployment"')).rows[0].n).toBe(legacyCount);
    proof.normal = { input: input.input, capture: complete.evidence, status: complete.status, report, replay, persistedInputBytes: Buffer.byteLength(JSON.stringify(complete.input)), persistedEvidenceBytes: Buffer.byteLength(JSON.stringify(complete.evidence)) };
    proof.failures = await checkModel2Failures(h, create, read, owner);
    // Historical reports remain safe after corruption; the test uses privileged
    // fixture SQL, never an application mutation path or a client-provided hash.
    await alterRecordedField(h, id, "input", {}, async () => {
      const damaged = (await h.request(`${base}/runs/${id}/report`)).report;
      expect(damaged.inputValid).toBe(false); expect(damaged.observed).toEqual([]);
      expect((await h.request(`${base}/runs/${id}/replay`)).replay.kind).toBe("Unavailable");
    });
    await alterRecordedField(h, id, "input", input.input, async () => {});
    await alterRecordedField(h, id, "evidence", {}, async () => {
      expect((await h.request(`${base}/runs/${id}/report`)).report.problems.join(" ")).toContain("evidence");
    });
    await alterRecordedField(h, id, "evidence", complete.evidence, async () => {});
    proof.success = true;
  } finally {
    h.cookie = cookie;
    await h.stop("worker");
    await h.sql.query('UPDATE "InternalModel2Run" SET status=\'failed\',reason=\'Disposable cleanup\' WHERE id=ANY($1::text[]) AND status IN (\'queued\',\'running\')', [rows]);
    await h.sql.query('DELETE FROM "Outbox" WHERE payload->>\'internalModel2RunId\'=ANY($1::text[])', [rows]);
    await h.sql.query('DELETE FROM "InternalModel2Run" WHERE id=ANY($1::text[])', [rows]);
    await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=ANY($1::text[])', [grants]);
    await queue.close();
    proof.workerProcesses = h.processes().slice(processStart).filter((p) => p.name === "worker");
    proof.endedAt = new Date().toISOString(); proof.fixtureRowsRemoved = true;
    const serialized = JSON.stringify(proof); if (Buffer.byteLength(serialized) > 1048576) throw Error("Internal product proof artifact exceeded one MiB");
    await Bun.write(file, serialized);
    console.info(`M2K_PRODUCT_PROOF ${JSON.stringify({ success: proof.success, normal: proof.admission, failures: failureSummary(), bytes: Buffer.byteLength(serialized), sha256: createHash("sha256").update(serialized).digest("hex"), path: file })}`);
  }
  return { success: proof.success, proof: file, admission: proof.admission, failures: failureSummary() };
}
