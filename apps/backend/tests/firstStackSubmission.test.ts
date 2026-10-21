import { expect, test } from "bun:test";
import express from "express";
import { createSubmissionService, closedSubmissionAdmission } from "../firstStack/admission";
import { createSubmissionRouter } from "../firstStack/submissionRoutes";
import { verificationOutcome } from "../firstStack/submissionWorker";
import { errorHandler } from "../utils/middleware";
import { submissionFixture } from "./submissionFixture";

test("public submission and router default closed without opening a database", async () => {
  const pool: any = { connect: () => { throw Error("Unexpected database access"); } };
  expect(closedSubmissionAdmission).toEqual({ enabled: false, engine: null });
  await expect(createSubmissionService(pool).submit("owner", {})).rejects.toThrow("Resource not found");
  const app = express(); app.use(createSubmissionRouter(pool)); app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1"), address = server.address() as any;
  try { expect((await fetch(`http://127.0.0.1:${address.port}/`, { method: "POST" })).status).toBe(404); }
  finally { server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); }
});

test("forged owner fields and wrong engine refuse before a database transaction", async () => {
  const f = await submissionFixture(), pool: any = { connect: () => { throw Error("Unexpected database access"); } };
  const service = createSubmissionService(pool, { enabled: true, engine: f.engine });
  await expect(service.submit(f.owner, { ...f.request, ownerId: "forged" })).rejects.toThrow("strict");
  await expect(service.submit(f.owner, { ...f.request, engine: { ...f.engine, source: "c".repeat(64) } })).rejects.toThrow("Approved engine");
});

test("verification requires complete server evidence, exact identity, authorization and cleanup", async () => {
  const f = await submissionFixture(), run = { ...f, inputHash: f.request.browserCut.inputHash, browserCut: f.request.browserCut };
  const result: any = { status: "completed", durablePrefix: run.browserCut, receipt: { cleanup: "removed" }, interruption: null, summary: "{}", journal: "" };
  expect(verificationOutcome(run, result, true).body.verification).toBe("verified");
  expect(verificationOutcome({ ...run, browserCut: { ...run.browserCut, fingerprint: "c".repeat(64) } }, result, true).body.verification).toBe("mismatch");
  for (const changed of [
    { ...result, status: "interrupted" }, { ...result, durablePrefix: null },
    { ...result, receipt: { cleanup: "not-created" } }, { ...result, receipt: { cleanup: "unconfirmed" } },
    { ...result, durablePrefix: { ...run.browserCut, source: "c".repeat(64) } },
    { ...result, durablePrefix: { ...run.browserCut, cut: { ...run.browserCut.cut, lock: {} } } },
    { ...result, durablePrefix: { ...run.browserCut, cut: { ...run.browserCut.cut, completeness: { horizonReached: false } } } },
  ]) expect(verificationOutcome(run, changed, true).body.verification).toBe("interrupted");
  expect(verificationOutcome(run, result, false).body.verification).toBe("interrupted");
  expect(verificationOutcome(run, { ...result, receipt: { cleanup: "failed" } }, true).clean).toBe(false);
});
