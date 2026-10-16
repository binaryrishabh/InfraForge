import { expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectedFixture } from "../connectedFixture";
import { verifyConnectedState } from "../connectedAssertions";
import { contentHash, executionSource } from "../../internalModel2/identity";
import { captureBarrier } from "./model2Barriers";
import { until } from "./localHarness";
import type { LocalHarness } from "./localHarness";
import type { SessionFixtures } from "./sessionFixtures";
export async function checkConnected(h: LocalHarness, sessions: SessionFixtures, designs: string[]) {
  const originalCookie = h.cookie, owners: string[] = [], rows: string[] = [], base = "/internal/model2";
  const start = h.processes().length;
  const proof: Record<string, any> = { schema: "infraforge-connected-product-proof/1", commit: process.env.GITHUB_SHA ?? "local-unpublished", source: executionSource, success: false, cases: [], runs: [] };
  const read = async (id: string) => (await h.sql.query('SELECT * FROM "InternalModel2Run" WHERE id=$1', [id])).rows[0];
  try {
    await h.stop("worker");
    const alice = await sessions.create(), bob = await sessions.create(); owners.push(alice.user.id, bob.user.id); h.cookie = alice.cookie;
    expect((await fetch(h.api + base + "/runs", { headers: { Origin: h.origin } })).status).toBe(401);
    await h.request(base + "/runs", undefined, "GET", 404);
    await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Disposable connected proof\'),($2,\'Disposable cross-owner proof\')', owners);
    const f = connectedFixture(), saved = (await h.request("/infrastructure", { name: "Connected internal proof", layout: f.layout }, "POST", 201)).createdInfrastructure; designs.push(saved.id);
    const request = (mode: Parameters<typeof connectedFixture>[0], key: string = mode ?? "healthy") => ({ ...connectedFixture(mode).request, infrastructureId: saved.id, expectedDesignUpdatedAt: saved.updatedAt, idempotencyKey: `connected-${key}` });
    const create = async (mode: Parameters<typeof connectedFixture>[0], key: string = mode ?? "healthy") => { const value = await h.request(base + "/runs", request(mode, key), "POST", 202); rows.push(value.id); return value.id as string; };
    await h.request(base + "/runs", { ...request("healthy"), expectedDesignUpdatedAt: "2000-01-01T00:00:00.000Z" }, "POST", 409);
    const invalid = request("healthy"); (invalid.contract as any).application.demands = [];
    await h.request(base + "/runs", invalid, "POST", 422);
    expect((await h.sql.query('SELECT count(*)::int AS n FROM "InternalModel2Run" WHERE "ownerId"=$1', [alice.user.id])).rows[0].n).toBe(0);
    const first = await create("healthy");
    expect((await h.request(base + "/runs", request("healthy"), "POST", 200)).id).toBe(first);
    expect((await h.sql.query('SELECT count(*)::int AS n FROM "Outbox" WHERE payload->>\'internalModel2RunId\'=$1', [first])).rows[0].n).toBe(1);
    h.cookie = bob.cookie;
    for (const suffix of ["input", "report", "replay"]) await h.request(`${base}/runs/${first}/${suffix}`, undefined, "GET", 404);
    await h.request(base + "/runs", request("healthy", "foreign"), "POST", 404);
    await h.sql.query('UPDATE "InternalModel2Grant" SET scope=\'lesson\' WHERE "userId"=$1', [bob.user.id]);
    await h.request(base + "/runs", request("healthy", "lesson-scope"), "POST", 404); h.cookie = alice.cookie;
    proof.cases.push("authentication and operator-only scope", "cross-owner refusal", "saved revision and compiler refusal", "atomic outbox and exact retry");
    const retain = async (name: string, id: string) => {
      const row = await read(id), report = (await h.request(`${base}/runs/${id}/report`)).report, before = contentHash(row);
      expect(report.schema).toBe("infraforge-internal-report/2"); expect(report.problems).toEqual([]);
      const replay = (await h.request(`${base}/runs/${id}/replay`)).replay; expect(replay.kind).toBe("MatchesRecordedPrefix"); expect(contentHash(await read(id))).toBe(before);
      if (row.evidence) verifyConnectedState(row.evidence);
      const result = { name, row, reportHash: contentHash(report), replay, inputBytes: Buffer.byteLength(JSON.stringify(row.input)), evidenceBytes: Buffer.byteLength(JSON.stringify(row.evidence)) };
      proof.runs.push(result); return { ...result, report };
    };
    await h.startWorker();
    for (const mode of ["healthy", "failure", "late-cancel", "early-cancel", "overflow"] as const) {
      const id = mode === "healthy" ? first : await create(mode);
      await until(async () => { const r = await read(id); if (["failed", "interrupted"].includes(r.status)) throw Error(`Connected ${mode}: ${r.reason}`); return r.status === "completed" ? r : undefined; }, `connected ${mode} worker completion`, 30000);
      const retained = await retain(mode, id);
      if (mode === "overflow") expect(retained.report.unknown.join(" ")).toContain("Exact request causality is Unknown");
    }
    proof.cases.push("healthy connected identities", "two-target distribution", "app failure and health detection lag", "surviving CPU pressure and DB consequence", "readiness and health recovery", "timeout after commit", "timeout before commit", "causal overflow remains Unknown", "read-only deterministic replay");
    await h.stop("worker");
    const barrier = await captureBarrier(h, 9);
    try {
      const id = await create("failure", "worker-prefix"); await h.startWorker(); await barrier.waiting();
      const before = await read(id); expect(before.sequence).toBe(8); await h.stop("worker");
      const absent = (await h.request(`${base}/runs/${id}/report`)).report; expect(absent.unknown.join(" ")).toContain("retained prefix");
      await barrier.release(); await barrier.close(); await h.startWorker();
      await until(async () => (await read(id)).status === "interrupted" || undefined, "connected interrupted retirement");
      const retained = await retain("worker-prefix", id); expect(retained.row.evidence.fingerprint).toBe(before.evidence.fingerprint); expect(retained.replay.complete).toBe(false);
    } finally { await barrier.close(); }
    proof.cases.push("actual worker SIGKILL retains durable v2 prefix");
    await h.sql.query('UPDATE "Infrastructure" SET name=\'Changed after admission\',"updatedAt"=now() WHERE id=$1', [saved.id]);
    expect((await h.request(base + "/runs", request("healthy"), "POST", 200)).id).toBe(first);
    await h.request(base + "/runs", request("healthy", "stale-after-save"), "POST", 409);
    proof.cases.push("exact retry survives saved revision change");
    const html = await fetch(h.api + `${base}/runs/${first}/report?format=html`, { headers: h.headers }); expect(html.status).toBe(200); expect(await html.text()).toContain("infraforge-causal/1");
    proof.cases.push("read-only HTML exposes connected evidence"); proof.success = true;
  } catch (error) { proof.failure = error instanceof Error ? error.message : String(error); proof.logs = h.logs(); throw error; }
  finally {
    await h.stop("worker"); h.cookie = originalCookie;
    await h.sql.query('UPDATE "InternalModel2Run" SET status=\'failed\',reason=\'Disposable connected cleanup\' WHERE id=ANY($1::text[]) AND status IN (\'queued\',\'running\')', [rows]);
    await h.sql.query('DELETE FROM "Outbox" WHERE payload->>\'internalModel2RunId\'=ANY($1::text[])', [rows]);
    await h.sql.query('DELETE FROM "InternalModel2Run" WHERE id=ANY($1::text[])', [rows]);
    await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=ANY($1::text[])', [owners]);
    proof.processes = h.processes().slice(start); proof.rowsRemoved = true;
    const bytes = JSON.stringify(proof); if (Buffer.byteLength(bytes) > 4194304) throw Error("Connected proof exceeds four MiB");
    await Bun.write(join(tmpdir(), "infraforge-connected-proof.json"), bytes);
  }
  return { success: proof.success, cases: proof.cases.length, runs: proof.runs.length };
}
