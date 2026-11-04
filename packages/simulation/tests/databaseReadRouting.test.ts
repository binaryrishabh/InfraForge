import { expect, test } from "bun:test";
import { relationalDatabase } from "../src/model2/data/database";
import type { RelationalConfig, DataReply } from "../src/model2/data/contracts";
import type { Invocation } from "../src/model2/workload/contracts";
import { EventKernel } from "../src/model2/time";
import { dataFixture } from "./dataFixture";

function fixture(policy: "primary-only" | "replica-preferred", sessions = 8) {
  const config = dataFixture({ dbCpu: 100, sessions, activeTransactions: 1 }).resources.find(r => r.kind === "relational") as RelationalConfig;
  config.replication = { version: 1, enabled: true, replicationDelayMs: 2, readPolicy: "primary" };
  Object.assign(config, { readRouting: { version: 1, policy } });
  config.pendingQueries = { ...config.pendingQueries, value: 1 } as typeof config.pendingQueries;
  const clock = new EventKernel(10000), db = relationalDatabase(config, clock);
  const submit = (id: string, operation = "light", epoch?: number) => {
    const work: Invocation = { rootId: id, callId: id, sessionId: id, operation, offeredAt: clock.now, attempt: 0, message: { request: { kind: "query", key: "k0", ...(epoch === undefined ? {} : { writerEpoch: epoch }) } } };
    const receipt = db.accept(work, () => db.closeSession(id));
    return { work, receipt, reply: () => work.message!.response as DataReply };
  };
  return { clock, db, submit, ha: () => db.evidence().databaseReplication!, routing: () => db.evidence().databaseReadRouting! };
}

test("same writes and reads select older replica rows with measured stale age", () => {
  for (const policy of ["primary-only", "replica-preferred"] as const) {
    const f = fixture(policy); f.submit("w", "heavy"); f.clock.advanceTo(200);
    const read = f.submit("r"); f.clock.advanceTo(400);
    expect(read.reply()).toMatchObject({ ok: true, readSource: policy === "primary-only" ? "primary" : "replica", rows: [{ key: "k0", version: policy === "primary-only" ? 2 : 1, bytes: 64 }] });
    expect(f.routing().staleReads).toBe(policy === "primary-only" ? 0 : 1);
    expect(f.routing().maxStaleReadAgeMs).toBe(policy === "primary-only" ? 0 : 0.1);
  }
});

test("read routing relieves primary query slots; replica saturation refuses instead of spilling to primary", () => {
  const proof = [];
  for (const policy of ["primary-only", "replica-preferred"] as const) {
    const f = fixture(policy);
    f.submit("r1"); f.submit("r2"); const third = f.submit("r3"); const write = f.submit("w", "heavy");
    expect(third.receipt.admitted).toBe(false);
    expect(third.reply().reason).toBe("query-queue-full");
    expect(write.receipt.admitted).toBe(policy === "replica-preferred");
    f.clock.advanceTo(1000);
    expect(f.db.evidence().transactions).toMatchObject({ admitted: policy === "primary-only" ? 2 : 3, live: 0, aborted: 0 });
    proof.push({ policy, ...f.routing() });
  }
  console.info("dbroute-query-capacity", JSON.stringify(proof));
});

test("member session limits are independent and bounded", () => {
  for (const policy of ["primary-only", "replica-preferred"] as const) {
    const f = fixture(policy, 1); f.submit("r1");
    expect(f.submit("r2").reply().reason).toBe("session-limit");
    expect(f.submit("w", "heavy").receipt.admitted).toBe(policy === "replica-preferred");
  }
});
