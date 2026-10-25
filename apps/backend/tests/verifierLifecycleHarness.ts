// Isolated process: module doubles must never replace real integration dependencies.
import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";

const events: string[] = [], connections: FakeRedis[] = [];
let starts = 0, failDelete = false, probe!: () => Promise<{ success: boolean }>;
let finish!: () => void, healthy = true, cacheInvalidations = 0;
let renewalDue = false, renewals = 0, executionHealthy: (() => boolean) | undefined;
let lifecycleHeld = false, executorHeld = false, canaries = 0, fingerprints = 0, headrooms = 0, healthProbes = 0;
const scenario = process.argv[2];
const failure = scenario === "unfinished-renewal" ? undefined : scenario;
let ownershipLost = false;
// A failed renewal can leave the global queue paused across a process restart.
let paused = true;
let pausedAtReadiness: boolean | undefined;
let startupEvents: string[] = [];
let enterCanary!: () => void, finishCanary!: () => void;
const canaryEntered = new Promise<void>(resolve => { enterCanary = resolve; });
const canaryPending = new Promise<void>(resolve => { finishCanary = resolve; });
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
  readProtectedJson: async (path: string) => ({ path }),
  createLiveQualification: (configuration: any, _control: unknown, callbacks: any) => {
    const refresh = async () => {
      assert.equal((await callbacks.load()).path, "fixture");
      assert.equal(await callbacks.fingerprint(), "fingerprint");
      await callbacks.headroom();
      configuration.qualification = { expiresAt: new Date(Date.now() + 60000).toISOString() };
    };
    return { refresh, renew: async () => { renewals++; renewalDue = false; await refresh(); await callbacks.canary({ baseline: true }); }, revoke() {}, due: () => renewalDue };
  },
}));
mock.module("../firstStack/qualificationFingerprint", () => ({
  createHostFingerprintReader: () => async () => { fingerprints++; if (failure === "fingerprint") throw Error("injected fingerprint"); return { fingerprint: "fingerprint" }; },
  assertLiveHeadroom() { headrooms++; if (failure === "headroom") throw Error("injected headroom"); },
}));
mock.module("../firstStack/verifierProductionProbe", () => ({ assertVerifierProductionResponsive: async () => { healthProbes++; } }));
mock.module("../firstStack/verifierOwnership", () => ({ acquireVerifierOwnership: async () => {
  assert.equal(lifecycleHeld, false); lifecycleHeld = true;
  return { assertHeld: async () => {
    assert.equal(lifecycleHeld, true);
    if (ownershipLost) throw Error("injected ownership");
  }, close: async () => { lifecycleHeld = false; events.push("startup-release"); } };
} }));
const authority = { assertHeld: async () => { assert.equal(executorHeld, true); } }, signal = new AbortController().signal;
mock.module("../firstStack/isolationOwnership", () => ({ withFirstStackOwnership: async (_url: string, hooks: any, work: any) => {
  assert.equal(lifecycleHeld, true); assert.equal(executorHeld, false); executorHeld = true;
  try {
    await hooks.check({ query: async (sql: string) => { assert.equal(sql, "SELECT 1"); } });
    await assert.rejects(hooks.commit(), /never persist/);
    return await work(authority, signal);
  } finally { executorHeld = false; }
} }));
mock.module("../firstStack/isolationRunner", () => ({ checkFirstStackCanary: async (_control: unknown, baseline: any, fingerprint: string, canary: any, held: unknown, abort: unknown) => {
  assert.equal(lifecycleHeld, true); assert.equal(executorHeld, true);
  assert.equal(held, authority); assert.equal(abort, signal); assert.deepEqual(baseline, { baseline: true });
  assert.equal(fingerprint, "fingerprint"); assert.equal(canary.path, "/etc/infraforge/verifier/canary.json");
  canaries++; if (failure === "canary") throw Error("injected canary");
  if (failure === "ownership") ownershipLost = true;
  if (canaries === 2 && scenario === "unfinished-renewal") {
    events.push("canary-pending"); enterCanary(); await canaryPending;
  }
  events.push("canary-complete");
} }));
mock.module("../firstStack/submissionQueue", () => ({ startSubmissionQueue: async (...args: any[]) => {
  starts++;
  events.push("queue-start");
  assert.equal(lifecycleHeld, false); lifecycleHeld = true; // Queue takes lifecycle ownership after startup releases it.
  executionHealthy = args[4].healthy;
  return {
    queue: { pause: async () => { paused = true; events.push("renewal-pause"); },
      getActiveCount: async () => { await renewalJob; return 0; },
      resume: async () => { paused = false; events.push("renewal-resume"); } },
    health: async () => { if (!healthy) throw Error("Queue unavailable"); },
    close: async () => { events.push("stop-claims"); await job; events.push("drained"); },
  };
} }));
mock.module("../health/readinessCache", () => ({ createReadinessCache: (check: typeof probe) => {
  pausedAtReadiness = paused;
  startupEvents = [...events];
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
if (failure) {
  await assert.rejects(first, new RegExp(`injected ${failure}`));
  assert.equal(starts, 0); assert.equal(lifecycleHeld, false); assert.equal(executorHeld, false);
  if (failure === "canary") assert.equal(canaries, 1);
  if (failure === "ownership") {
    assert.equal(canaries, 1); assert.equal(ownershipLost, true);
    assert.equal(events.filter(event => event === "startup-release").length, 1);
  }
  assert.ok(!events.includes("renewal-resume"));
  console.log("Verifier callback failure closes startup"); process.exit(0);
}
const verifier = await first;
assert.equal(pausedAtReadiness, false, "startup must resume the paused queue before readiness");
assert.equal(paused, false);
assert.equal(startupEvents.filter(event => event === "renewal-resume").length, 1);
assert.deepEqual(startupEvents.filter(event => ["canary-complete", "startup-release", "queue-start", "renewal-resume"].includes(event)),
  ["canary-complete", "startup-release", "queue-start", "renewal-resume"]);
assert.equal(canaries, 1); assert.ok(fingerprints >= 2); assert.ok(headrooms > 0); assert.ok(healthProbes > 0);
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

if (scenario === "unfinished-renewal") {
  renewalDue = true;
  assert.equal((await probe()).success, false);
  finishRenewal(); await canaryEntered;
  assert.equal(renewals, 2); assert.equal(executorHeld, true);
  events.length = 0;
  let closed = false;
  const closing = verifier.close().then(() => { closed = true; });
  finish();
  // Let the completed ordinary drain and all its continuations run while the canary is held.
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.ok(events.includes("drained"));
  assert.equal(closed, false, "shutdown must await the unfinished renewal");
  for (const event of ["cache-close", "control-close", "disconnect", "pool-end"])
    assert.ok(!events.includes(event), `${event} must wait for renewal`);
  assert.equal(executorHeld, true);
  finishCanary(); await closing;
  assert.equal(closed, true); assert.equal(executorHeld, false);
  assert.ok(events.indexOf("canary-complete") < events.indexOf("control-close"));
  assert.equal(events.filter(event => event === "disconnect").length, 2);
  assert.equal(events.at(-1), "pool-end");
  assert.ok(!events.includes("renewal-resume"));
  console.log("Shutdown keeps dependencies open until renewal settles"); process.exit(0);
}

renewalDue = true;
assert.equal((await probe()).success, false);
assert.equal(verifier.availability().available, false);
assert.equal(executionHealthy!(), true); // Existing scored job keeps its lease.
assert.equal(renewals, 1); // Startup only until the whole active job completes.
assert.ok(events.includes("renewal-pause"));
assert.equal((await probe()).success, false);
finishRenewal(); await Bun.sleep(5);
assert.equal(renewals, 2);
assert.equal(canaries, 2); assert.equal(executorHeld, false);
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
