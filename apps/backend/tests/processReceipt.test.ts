import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readExecutionReceipt, receiptState, type ProcessReceipt, type ExecutionReceipt } from "../firstStack/executionReceipt";
import { verificationOutcome } from "../firstStack/submissionWorker";
import { submissionFixture } from "./submissionFixture";
import { firstStackRunRecord } from "../runRecords/firstStack";
import { hash } from "../firstStack/canonical";

test("process completion binds exit, generation, token and engine without Docker evidence", async () => {
  const f = await submissionFixture(), token = randomUUID(), generation = randomUUID();
  const receipt: ProcessReceipt = { schema: "first-stack-process-receipt/1", token, generation, ...f.engine,
    exit: { code: 0, signal: null }, termination: "confirmed" };
  const owner = { token, generation, ...f.engine };
  const run = { ...f, token, generation, browserCut: f.request.browserCut, inputHash: f.request.browserCut.inputHash };
  const result: any = { status: "completed", receipt, durablePrefix: run.browserCut };
  expect(readExecutionReceipt(receipt)).toEqual(receipt);
  expect(verificationOutcome(run, result, true).body.verification).toBe("verified");
  for (const change of [{ token: randomUUID() }, { generation: randomUUID() }, { source: "f".repeat(64) },
    { image: `sha256:${"f".repeat(64)}` }, { termination: "unconfirmed" }, { exit: null },
    { exit: { code: null, signal: null } }, { cleanup: "removed" }]) {
    expect(receiptState({ ...receipt, ...change } as any, owner).clean).toBe(false);
    expect(verificationOutcome(run, { ...result, receipt: { ...receipt, ...change } } as any, true).body.verification).toBe("interrupted");
  }
  for (const change of [{ exit: { code: 1, signal: null } }, { exit: { code: null, signal: "SIGKILL" } },
    { exit: null, termination: "not-started" }]) {
    const value = { ...receipt, ...change } as ProcessReceipt;
    expect(receiptState(value, owner)).toEqual({ clean: true, completed: false });
    expect(verificationOutcome(run, { ...result, receipt: value }, true).body.verification).toBe("interrupted");
  }
  expect(verificationOutcome(run, result, false).body.verification).toBe("interrupted");
});

test("historical readers preserve Docker and process receipts and refuse corrupt process evidence", async () => {
  const f = await submissionFixture();
  const processReceipt: ProcessReceipt = { schema: "first-stack-process-receipt/1", token: randomUUID(), generation: randomUUID(),
    ...f.engine, exit: { code: 0, signal: null }, termination: "confirmed" };
  const docker: ExecutionReceipt = { schema: "first-stack-isolation-receipt/1", daemon: "c".repeat(64), image: f.engine.image,
    container: "fixture-container", enforcement: null, elapsedMs: 1, outputBytes: 0, exit: { code: 0, oom: false }, cleanup: "removed" };
  for (const receipt of [docker, processReceipt]) {
    expect(readExecutionReceipt(receipt)).toEqual(receipt);
    const result = { verification: "verified", actual: f.request.browserCut.fingerprint, receipt };
    const row = { ...f, id: randomUUID(), inputHash: f.request.browserCut.inputHash, browserCut: f.request.browserCut,
      durablePrefix: f.request.browserCut, status: "terminal", result, resultHash: hash(result),
      lineage: { infrastructureId: f.request.infrastructureId }, createdAt: new Date() };
    expect(firstStackRunRecord(row).availability?.report).toBe("readable");
    if (receipt === processReceipt) {
      const corrupt = { ...result, receipt: { ...receipt, exit: null } };
      expect(firstStackRunRecord({ ...row, result: corrupt, resultHash: hash(corrupt) }).availability?.report).toBe("unavailable");
    }
  }
});
