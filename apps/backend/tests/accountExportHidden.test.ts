import { expect, test } from "bun:test";
import { exportAccountPage } from "../auth/accountData";
import { hash } from "../firstStack/canonical";

const verifiedScoredBody = {
  verification: "verified",
  score: {
    schema: "infraforge-server-score/1", challenge: { id: "url-redirect", version: "1" }, rubricVersion: "1",
    rubric: { version: "1", criteria: [{ id: "delivered", threshold: "HIDDEN-RUBRIC-THRESHOLD" }] },
    engine: { source: "engine" }, design: { visibleInputHash: "visible" },
    workloads: [{ workload: { id: "HIDDEN-WORKLOAD-ID", version: "1", hash: "h" }, input: "HIDDEN-WORKLOAD-INPUT",
      inputHash: "HIDDEN-INPUT-HASH", evidence: { marker: "HIDDEN-EVIDENCE" }, receipt: { marker: "HIDDEN-RECEIPT" },
      outcomes: [{ id: "delivered", required: true, outcome: "pass", measured: 0.99, reason: null, support: "supported-logical" }] }],
    assessment: "assessed", earned: 1, assessed: 1, pending: 0, systemPassed: true, support: "conditional logical exercise",
  },
};

function fakeDb(row: Record<string, unknown>) {
  return { firstStackResult: { findMany: async () => [row] } } as never;
}

test("account export never contains the server-only score audit, only the public summary", async () => {
  const row = { runId: "run-1", body: verifiedScoredBody, hash: hash(verifiedScoredBody), createdAt: new Date(0) };
  const page = await exportAccountPage(fakeDb(row), "owner", "results");
  const serialized = JSON.stringify(page);
  expect(serialized).not.toContain("HIDDEN-");
  expect(serialized).not.toContain("rubric\"");
  const body = (page.records[0] as { body: Record<string, unknown> }).body;
  expect(body.score).toBeUndefined();
  expect(body.scoreSummary).toMatchObject({ schema: "infraforge-score-summary/1", earned: 1,
    criteria: [{ id: "delivered", required: true, outcome: "pass", reason: null }] });
  expect(page.next).toEqual({ id: "run-1" });
});

test("a tampered or unverified scored result exports no score summary and still no audit", async () => {
  const tampered = { runId: "run-2", body: verifiedScoredBody, hash: "0".repeat(64), createdAt: new Date(0) };
  const page = await exportAccountPage(fakeDb(tampered), "owner", "results");
  expect(JSON.stringify(page)).not.toContain("HIDDEN-");
  expect((page.records[0] as { body: Record<string, unknown> }).body.scoreSummary).toBeUndefined();
});

test("results without a score export unchanged", async () => {
  const plain = { runId: "run-3", body: { verification: "unverified", purpose: "private" }, hash: "x", createdAt: new Date(0) };
  const page = await exportAccountPage(fakeDb(plain), "owner", "results");
  expect(page.records[0]).toEqual(plain);
});
