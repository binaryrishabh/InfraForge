// Isolated process: module doubles must never replace real integration dependencies.
import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";

const events: string[] = [], connections: FakeRedis[] = [];
let starts = 0, failDelete = false, probe!: () => Promise<{ success: boolean }>;
let finish!: () => void, healthy = true, cacheInvalidations = 0;
const job = new Promise<void>(resolve => { finish = resolve; });
class FakeRedis extends EventEmitter {
  status = "ready";
  constructor(..._args: unknown[]) { super(); connections.push(this); }
  async ping() { return "PONG"; }
  async set() { events.push("publish"); }
  async del() { events.push("delete"); if (failDelete) throw Error("Redis unavailable"); }
  disconnect() { events.push("disconnect"); }
}
class FakePool extends EventEmitter {
  async query() { return { rows: [] }; }
  async end() { events.push("pool-end"); }
}
mock.module("ioredis", () => ({ default: FakeRedis }));
mock.module("pg", () => ({ Pool: FakePool }));
mock.module("../infra/workerConnection", () => ({
  workerDatabaseUrl: () => "fixture", verifyWorkerSession: async () => {},
}));
mock.module("../release/migrations", () => ({ checkHistory: async () => {}, checkSchemaGuards: async () => {} }));
mock.module("../firstStack/isolationConnection", () => ({ IsolationConnection: {
  open: async () => ({ close: async () => { events.push("control-close"); } }),
} }));
mock.module("../firstStack/verifierQualification", () => ({
  readProtectedJson: async () => ({}),
  refreshVerifierQualification: async (configuration: any) => {
    configuration.qualification = { expiresAt: new Date(Date.now() + 60000).toISOString() };
  },
}));
mock.module("../firstStack/submissionQueue", () => ({ startSubmissionQueue: async () => {
  starts++;
  return {
    health: async () => { if (!healthy) throw Error("Queue unavailable"); },
    close: async () => { events.push("stop-claims"); await job; events.push("drained"); },
  };
} }));
mock.module("../health/readinessCache", () => ({ createReadinessCache: (check: typeof probe) => {
  probe = check;
  let success = false;
  return {
    started: check().then(value => { success = value.success; }),
    invalidate: () => { success = false; cacheInvalidations++; },
    check: () => ({ success }), close: async () => { events.push("cache-close"); },
  };
} }));

const { createVerifierLifecycle } = await import("../firstStack/verifierLifecycle");
const lifecycle = createVerifierLifecycle({ enabled: true, image: `sha256:${"b".repeat(64)}`,
  endpoint: "fixture", qualification: "fixture" }, "a".repeat(64), {});
const first = lifecycle.start();
assert.equal(first, lifecycle.start());
const verifier = await first;
assert.equal(starts, 1);
assert.equal(verifier.availability().available, true);
assert.equal(connections.length, 2);
connections[1]!.emit("close");
assert.equal(verifier.availability().available, false);
assert.ok(cacheInvalidations > 0);
healthy = false;
assert.equal((await probe()).success, false);
healthy = true;
assert.equal((await probe()).success, true);

// Redis loss must not defer stopping claims or abandon a still-running scored job.
failDelete = true;
events.length = 0;
const closing = verifier.close();
assert.equal(closing, verifier.close());
assert.equal(events[0], "stop-claims");
assert.equal(verifier.availability().available, false);
await Bun.sleep(5);
assert.ok(!events.includes("drained"));
assert.ok(!events.includes("disconnect"));
finish();
await closing;
assert.ok(events.indexOf("drained") < events.indexOf("disconnect"));
assert.equal(events.filter(e => e === "stop-claims").length, 1);
assert.equal(events.filter(e => e === "disconnect").length, 2);
assert.equal(events.at(-1), "pool-end");
console.log("Verifier lifecycle ordering and dependency invalidation passed");
