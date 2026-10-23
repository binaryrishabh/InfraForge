// Isolated process: module doubles must never replace real integration dependencies.
import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";

const events: string[] = [], connections: FakeRedis[] = [];
let starts = 0, failDelete = false, probe!: () => Promise<{ success: boolean }>;
let finish!: () => void, healthy = true, cacheInvalidations = 0;
let renewalDue = false, renewals = 0, executionHealthy: (() => boolean) | undefined;
let finishRenewal!: () => void;
const renewalJob = new Promise<void>(resolve => { finishRenewal = resolve; });
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
  createLiveQualification: (configuration: any) => {
    const refresh = async () => {
    configuration.qualification = { expiresAt: new Date(Date.now() + 60000).toISOString() };
    };
    return { refresh, renew: async () => { renewals++; renewalDue = false; await refresh(); }, revoke() {}, due: () => renewalDue };
  },
}));
mock.module("../firstStack/qualificationFingerprint", () => ({
  createHostFingerprintReader: () => async () => ({}), assertLiveHeadroom() {},
}));
mock.module("../firstStack/verifierOwnership", () => ({ acquireVerifierOwnership: async () => ({
  assertHeld: async () => {}, close: async () => {},
}) }));
mock.module("../firstStack/isolationOwnership", () => ({ withFirstStackOwnership: async () => {} }));
mock.module("../firstStack/isolationRunner", () => ({ checkFirstStackCanary: async () => {} }));
mock.module("../firstStack/submissionQueue", () => ({ startSubmissionQueue: async (...args: any[]) => {
  starts++;
  executionHealthy = args[4].healthy;
  return {
    queue: { pause: async () => { events.push("renewal-pause"); },
      getActiveCount: async () => { await renewalJob; return 0; },
      resume: async () => { events.push("renewal-resume"); } },
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

renewalDue = true;
assert.equal((await probe()).success, false);
assert.equal(verifier.availability().available, false);
assert.equal(executionHealthy!(), true); // Existing scored job keeps its lease.
assert.equal(renewals, 1); // Startup only until the whole active job completes.
assert.ok(events.includes("renewal-pause"));
assert.equal((await probe()).success, false);
finishRenewal(); await Bun.sleep(5);
assert.equal(renewals, 2);
assert.equal(events.at(-1), "renewal-resume");
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
