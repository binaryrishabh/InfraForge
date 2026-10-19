import { rejects } from "node:assert/strict";
import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalHarness, readLocalSettings, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { captureBarrier, alterRecordedField, verifyOwnershipLoss } from "./model2Barriers";
import { checkLessonBrowser } from "./lessonBrowserChecks";
import { checkLessonSandbox } from "./lessonSandboxChecks";
import { lessonSource } from "./lessonSource";
import { compileEnvelope, admissionSchema } from "../../internalModel2/envelope";
import { checkLessonSchema } from "../../release/lessonSchema";
import { checkLessonUpgrade } from "./lessonUpgradeChecks";
import { DockerConnection } from "../../internalModel2/dockerConnection";
const suite = process.env.M2M_RUN === "1" ? describe : describe.skip;
suite("controlled internal object restart lesson", () => {
  test("proves scoped product execution, durable failure boundaries and real OS containment", async () => {
    const h = new LocalHarness(readLocalSettings(process.env)), output = join(tmpdir(), "infraforge-m2m"); await mkdir(output, { recursive: true });
    const proof: Record<string, any> = { schema: "infraforge-m2m-preview/1", commit: process.env.GITHUB_SHA ?? "local-working-tree", source: lessonSource(), image: process.env.MODEL2_LESSON_IMAGE, startedAt: new Date().toISOString(), success: false, cases: [], runs: [] };
    let sessions: SessionFixtures | undefined, owners: string[] = [];
    const base = "/internal/model2", read = async (id: string) => (await h.sql.query('SELECT * FROM "InternalModel2Run" WHERE id=$1', [id])).rows[0];
    const replayReady = (id: string) => until(async () => {
      const value = (await h.request(`${base}/runs/${id}/replay`)).replay;
      return value.kind === "Unavailable" && /busy|still active/.test(value.reason) ? undefined : value;
    }, "isolated runner cleanup releases replay lease", 30000, 200);
    try {
      await h.prepare(); proof.actualHost = "UNVERIFIED"; proof.connection = await DockerConnection.use(async (c) => c.receipt);
      sessions = new SessionFixtures(h); const alice = await sessions.create(), bob = await sessions.create(); owners = [alice.user.id, bob.user.id]; h.cookie = alice.cookie;
      proof.upgrade = await checkLessonUpgrade(h);
      await checkLessonSchema(h.sql);
      await h.sql.query('ALTER TABLE "InternalModel2LessonRun" DISABLE TRIGGER model2_lesson_guard');
      try { await rejects(checkLessonSchema(h.sql)); }
      finally { await h.sql.query('ALTER TABLE "InternalModel2LessonRun" ENABLE TRIGGER model2_lesson_guard'); }
      proof.services = { postgres: (await h.sql.query("SHOW server_version")).rows[0].server_version, redis: /^redis_version:(.+)$/m.exec(await h.redis.info("server"))?.[1]?.trim() };
      expect((await fetch(h.api + base + "/lesson", { headers: { Origin: h.origin } })).status).toBe(401);
      await h.request(base + "/lesson", undefined, "GET", 404);
      await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason,scope) VALUES ($1,\'Disposable M2M proof\',\'lesson\'),($2,\'Disposable second owner\',\'lesson\')', owners);
      expect((await h.request(base + "/capability")).scope).toBe("lesson");
      for (const path of ["/workspace", "/workspace/", "/WORKSPACE", "/validate", "/validate/", "/VALIDATE", "/runs", "/RUNS"]) await h.request(base + path, path.toLowerCase().startsWith("/workspace") ? undefined : {}, path.toLowerCase().startsWith("/workspace") ? "GET" : "POST", 404);
      const id = (await h.request(base + "/lesson/design", {}, "POST", 201)).id;
      expect((await h.request(base + "/lesson/design", {}, "POST", 201)).id).toBe(id);
      const design = (await h.request(base + "/lesson")).workspace.designs.find((d: any) => d.id === id);
      const choice = (phase = "after") => ({ schema: "object-restart/1", infrastructureId: id, expectedDesignUpdatedAt: design.updatedAt, idempotencyKey: crypto.randomUUID(), phase });
      const pinnedImage = process.env.MODEL2_LESSON_IMAGE!;
      delete process.env.MODEL2_LESSON_IMAGE;
      try {
        await h.restartApi();
        expect((await h.request(base + "/lesson")).workspace.configured).toBe(false);
        await h.request(base + "/lesson/review", choice(), "POST", 409);
      } finally { process.env.MODEL2_LESSON_IMAGE = pinnedImage; await h.restartApi(); }
      const create = async (phase = "after") => { const review = (await h.request(base + "/lesson/review", choice(phase), "POST")).lesson; return (await h.request(base + "/lesson/runs", { ...review.choice, reviewHash: review.reviewHash }, "POST", 202)).id as string; };
      const review = (await h.request(base + "/lesson/review", choice(), "POST")).lesson, submission = { ...review.choice, reviewHash: review.reviewHash };
      expect((await h.sql.query('SELECT count(*)::int AS n FROM "InternalModel2Run"')).rows[0].n).toBe(0);
      const bypassId = crypto.randomUUID(), bypassLayout = (await h.sql.query('SELECT layout FROM "Infrastructure" WHERE id=$1', [id])).rows[0].layout;
      const bypass = compileEnvelope(bypassId, alice.user.id, bypassLayout, new Date(design.updatedAt), admissionSchema.parse(review.review.request));
      await rejects(h.sql.query(`INSERT INTO "InternalModel2Run" (id,"ownerId","infrastructureId","idempotencyKey","requestHash",input,"inputHash") VALUES ($1,$2,$3,'no-metadata',$4,$5,$6)`, [bypassId, alice.user.id, id, "0".repeat(64), bypass, bypass.fingerprint]));
      expect((await h.sql.query('SELECT 1 FROM "InternalModel2Run" WHERE id=$1', [bypassId])).rowCount).toBe(0);
      await h.request(base + "/lesson/review", { ...choice(), phase: "invented" }, "POST", 400);
      await h.request(base + "/lesson/review", { ...choice(), contract: {} }, "POST", 400);
      await h.request(base + "/lesson/review", { ...choice(), expectedDesignUpdatedAt: "2020-01-01T00:00:00.000Z" }, "POST", 409);
      await h.request(base + "/lesson/runs", { ...submission, reviewHash: "0".repeat(64) }, "POST", 409);
      const admitted = await h.request(base + "/lesson/runs", submission, "POST", 202);
      expect((await h.request(base + "/lesson/runs", submission, "POST", 200)).id).toBe(admitted.id);
      await h.request(base + "/lesson/runs", { ...submission, phase: "during" }, "POST", 409);
      await h.request(`${base}/runs/${admitted.id}/cancel`, {}, "POST", 202);
      await h.sql.query('UPDATE "InternalModel2Grant" SET scope=\'operator\' WHERE "userId"=$1', [alice.user.id]);
      const advanced = await h.request(base + "/runs", { ...review.review.request, idempotencyKey: "advanced-owner-only", contract: { ...review.review.request.contract, version: "internal-authoring/1" } }, "POST", 202);
      await h.request(`${base}/runs/${advanced.id}/cancel`, {}, "POST", 202);
      await h.sql.query('UPDATE "InternalModel2Grant" SET scope=\'lesson\' WHERE "userId"=$1', [alice.user.id]);
      for (const action of ["report", "input", "replay"]) await h.request(`${base}/runs/${advanced.id}/${action}`, undefined, "GET", 404);
      expect((await h.request(base + "/runs")).runs.some((r: any) => r.id === advanced.id)).toBe(false);
      h.cookie = bob.cookie;
      await h.request(base + "/lesson/review", choice(), "POST", 404);
      for (const action of ["report", "input", "replay"]) await h.request(`${base}/runs/${admitted.id}/${action}`, undefined, "GET", 404);
      await h.request(`${base}/runs/${admitted.id}/cancel`, {}, "POST", 404);
      h.cookie = alice.cookie;
      const layout = (await h.sql.query('SELECT layout FROM "Infrastructure" WHERE id=$1', [id])).rows[0].layout;
      const unsupported = (await h.request("/infrastructure", { name: "Legacy refusal", layout: { ...layout, resources: [{ ...layout.resources[0], public: false }, layout.resources[1]] } }, "POST", 201)).createdInfrastructure;
      await h.request(base + "/lesson/review", { ...choice(), infrastructureId: unsupported.id, expectedDesignUpdatedAt: unsupported.updatedAt }, "POST", 400);
      expect((await h.sql.query('SELECT layout FROM "Infrastructure" WHERE id=$1', [unsupported.id])).rows[0].layout.resources[0].public).toBe(false);
      proof.cases.push("authentication and scoped operator refusal", "strict choices and stale review refusal", "owned explicit design creation", "read-only review", "idempotent retry and mismatch refusal", "cross-owner isolation", "unsupported design preserved", "queued cancellation");
      await h.startWorker();
      for (const phase of ["before", "during", "after"]) {
        const run = await create(phase), row = await until(async () => { const r = await read(run); if (["failed", "interrupted"].includes(r.status)) throw Error(`${r.status}: ${r.reason}`); return r.status === "completed" ? r : undefined; }, `isolated ${phase} completion`, 40000);
        const report = (await h.request(`${base}/runs/${run}/report`)).report;
        expect(report.lesson.readOutcome).toBe(phase === "during" ? "rejected" : "completed"); expect(report.lesson.returnedBytes).toBe(phase === "during" ? null : 24);
        const before = await read(run), replay = (await h.request(`${base}/runs/${run}/replay`)).replay;
        expect(replay.kind).toBe("MatchesRecordedPrefix"); expect(replay.complete).toBe(true); expect(await read(run)).toEqual(before);
        const record = (await h.sql.query('SELECT * FROM "InternalModel2LessonRun" WHERE "runId"=$1', [run])).rows[0];
        expect(record.receipt.exit).toMatchObject({ code: 0, oom: false }); expect(record.receipt.enforcement.memory).toBe("536870912");
        await rejects(h.sql.query('UPDATE "InternalModel2LessonRun" SET policy=\'{}\' WHERE "runId"=$1', [run]));
        await rejects(h.sql.query('DELETE FROM "InternalModel2LessonRun" WHERE "runId"=$1', [run]));
        proof.runs.push({ phase, row, ...record, report, replay });
      }
      proof.cases.push("three supported phases execute in isolated worker", "isolated replay writes nothing", "kernel enforcement receipts", "immutable policy and terminal persistence");
      const history = (await h.request(base + "/runs")).runs;
      for (const saved of proof.runs) expect(history.find((r: any) => r.id === saved.row.id).lesson.phase).toBe(saved.phase);
      for (const loss of ["process-death", "ownership-loss", "cancel", "revoke", "persistence"] as const) {
        const barrier = await captureBarrier(h);
        try {
          const run = await create(), pid = await barrier.waiting(), before = await read(run); expect(before.sequence).toBe(3);
          if (loss === "process-death") await h.stop("worker");
          else if (loss === "ownership-loss") await verifyOwnershipLoss(h, pid);
          else if (loss === "revoke") { await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=$1', [alice.user.id]); await h.request(`${base}/runs/${run}/report`, undefined, "GET", 404); }
          else if (loss === "persistence") await h.sql.query("SELECT pg_cancel_backend($1)", [pid]);
          const cancellation = loss === "cancel" ? h.request(`${base}/runs/${run}/cancel`, {}, "POST", 202) : Promise.resolve();
          await barrier.release(); await cancellation; await barrier.close();
          if (["process-death", "ownership-loss"].includes(loss)) await h.startWorker();
          const expected = ["cancel", "revoke"].includes(loss) ? "cancelled" : "interrupted";
          const row = await until(async () => { const r = await read(run); return r.status === expected ? r : undefined; }, loss, 30000);
          if (["process-death", "ownership-loss", "persistence"].includes(loss)) { expect(row.sequence).toBe(3); expect(row.evidence.fingerprint).toBe(before.evidence.fingerprint); }
          else { expect(row.sequence).toBeGreaterThanOrEqual(4); expect(row.sequence).toBeLessThanOrEqual(6); }
          if (loss === "revoke") await h.sql.query('INSERT INTO "InternalModel2Grant" ("userId",reason,scope) VALUES ($1,\'Restore disposable proof\',\'lesson\')', [alice.user.id]);
          const replay = await replayReady(run); expect(replay.kind).toBe("MatchesRecordedPrefix"); expect(replay.complete).toBe(false);
          proof.runs.push({ failure: loss, row, policy: (await h.sql.query('SELECT policy FROM "InternalModel2LessonRun" WHERE "runId"=$1', [run])).rows[0].policy, replay });
        } finally { await barrier.close(); }
      }
      proof.cases.push("parent death retains committed prefix", "ownership loss prevents later commits", "running cancellation", "grant revocation stops execution", "capture persistence failure retains prefix");
      const complete = proof.runs[2].row;
      await h.stop("worker"); delete process.env.MODEL2_LESSON_IMAGE;
      try {
        await h.restartApi();
        expect((await h.request(base + "/lesson/runs", submission, "POST")).id).toBe(admitted.id);
        expect((await h.request(`${base}/runs/${complete.id}/replay`)).replay).toMatchObject({ kind: "Unavailable" });
        expect((await h.request(`${base}/runs/${complete.id}/report`)).report.lesson.kind).toBe("Observed");
        await h.startWorker();
        await until(async () => (await fetch("http://127.0.0.1:3002/health/ready", { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false)) || undefined, "Model-1 worker starts with lesson runner parked");
      } finally { await h.stop("worker"); process.env.MODEL2_LESSON_IMAGE = pinnedImage; await h.restartApi(); await h.startWorker(); }
      proof.cases.push("missing runner refuses review and replay without inline fallback", "retry recovers original admission after runner configuration changes", "parked lesson runner preserves Model-1 worker startup", "scope downgrade hides advanced owned reports");
      const pinnedEndpoint = process.env.MODEL2_LESSON_ENDPOINT!;
      await h.stop("worker"); delete process.env.MODEL2_LESSON_ENDPOINT;
      try {
        await h.restartApi(); expect((await h.request(base + "/lesson")).workspace.configured).toBe(false);
        await h.request(base + "/lesson/review", choice(), "POST", 409);
        expect((await h.request(base + "/lesson/runs", submission, "POST")).id).toBe(admitted.id);
        expect((await h.request(`${base}/runs/${complete.id}/replay`)).replay.kind).toBe("Unavailable");
        await h.startWorker(); await until(async () => (await fetch("http://127.0.0.1:3002/health/ready", { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false)) || undefined, "Model-1 worker with no lesson endpoint");
      } finally { await h.stop("worker"); process.env.MODEL2_LESSON_ENDPOINT = pinnedEndpoint; await h.restartApi(); await h.startWorker(); }
      proof.cases.push("missing endpoint refuses review and replay without fallback", "missing endpoint retains exact admission retry", "missing endpoint preserves Model-1 worker startup");
      await alterRecordedField(h, complete.id, "evidence", {}, async () => { const report = (await h.request(`${base}/runs/${complete.id}/report`)).report; expect(report.lesson.kind).toBe("Unknown"); expect(report.replay.compatible).toBe(false); });
      await alterRecordedField(h, complete.id, "evidence", complete.evidence, async () => {});
      proof.cases.push("corrupt evidence remains Unknown");
      proof.browser = await checkLessonBrowser(h, alice.cookie, output);
      proof.os = await checkLessonSandbox(process.env.MODEL2_LESSON_IMAGE!, output);
      proof.success = true;
    } catch (error) { proof.failure = error instanceof Error ? error.message : String(error); proof.logs = h.logs(); throw error; }
    finally {
      await h.stop("worker");
      if (owners.length) {
        await h.sql.query('UPDATE "InternalModel2Run" SET status=\'failed\',reason=\'Disposable M2M cleanup\' WHERE "ownerId"=ANY($1::text[]) AND status IN (\'queued\',\'running\')', [owners]);
        await h.sql.query('DELETE FROM "Outbox" WHERE payload->>\'internalModel2RunId\' IN (SELECT id FROM "InternalModel2Run" WHERE "ownerId"=ANY($1::text[]))', [owners]);
        await h.sql.query('DELETE FROM "InternalModel2Run" WHERE "ownerId"=ANY($1::text[])', [owners]);
        await h.sql.query('DELETE FROM "InternalModel2Grant" WHERE "userId"=ANY($1::text[])', [owners]);
        await h.sql.query('DELETE FROM "Infrastructure" WHERE "ownerId"=ANY($1::text[])', [owners]);
        await sessions?.close();
      }
      proof.rowsRemoved = true; proof.endedAt = new Date().toISOString(); await Bun.write(join(output, "preview-proof.json"), JSON.stringify(proof));
      await h.close(); console.info(`M2M proof: ${join(output, "preview-proof.json")}; success=${proof.success}`);
    }
  }, 240000);
});
