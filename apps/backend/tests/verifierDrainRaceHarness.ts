// Separate process so these dependency doubles cannot affect real service tests.
import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";

const stage = process.argv[2];
assert.ok(stage === "ownership" || stage === "outbox");
let probe!: () => Promise<{ success: boolean }>, configuration: any;
let invalidations = 0, paused = false, running = false, hold = false;
let ownsLifecycle = false;
let entered!: () => void, release!: () => void, finish!: () => void;
const waiting = new Promise<void>(resolve => { entered = resolve; });
const gate = new Promise<void>(resolve => { release = resolve; });
const job = new Promise<void>(resolve => { finish = resolve; });
const blocking = Object.assign(new EventEmitter(), { status: "ready" });
const client = Object.assign(new EventEmitter(), { status: "ready" });
const backend = { client: Promise.resolve(client), blockingClient: Promise.resolve(blocking) };
class Redis extends EventEmitter {
  status = "ready";
  async ping() { return "PONG"; }
  async set() {}
  async del() {}
  disconnect() {}
}
class Pool extends EventEmitter {
  async query(sql: string) {
    if (sql.includes("AS stale")) {
      if (hold && stage === "outbox") { hold = false; entered(); await gate; return { rows: [{ stale: true }] }; }
      return { rows: [{ stale: false }] };
    }
    return { rows: [] };
  }
  async end() {}
}
class Queue extends EventEmitter {
  getBackend() { return backend; }
  async setGlobalConcurrency() {}
  // Startup retention pruning and operation counts; this race has no retained jobs.
  async clean() { return []; }
  async getJobs() { return []; }
  async getJobCounts() { return {}; }
  async add() {}
  async close() {}
}
class Worker extends EventEmitter {
  getBackend() { return backend; }
  async waitUntilReady() {}
  async run() { running = true; await job; running = false; }
  isRunning() { return running; }
  isPaused() { return paused; }
  async pause() { paused = true; }
  async close() {}
}
mock.module("ioredis", () => ({ default: Redis }));
mock.module("pg", () => ({ Pool }));
mock.module("bullmq", () => ({ Queue, Worker }));
mock.module("../infra/workerConnection", () => ({
  workerDatabaseUrl: () => "fixture", verifyWorkerSession: async () => {},
}));
const checkSchema = async () => {
  assert.equal(ownsLifecycle, true, "Startup schema checks must be protected from a concurrent release");
};
mock.module("../release/migrations", () => ({ checkHistory: checkSchema, checkSchemaGuards: checkSchema }));
mock.module("../firstStack/isolationConnection", () => ({ IsolationConnection: {
  open: async () => ({ close: async () => {} }),
} }));
mock.module("../firstStack/verifierQualification", () => ({
  readProtectedJson: async () => ({}),
  refreshVerifierQualification: async (value: any) => {
    value.qualification = { expiresAt: new Date(Date.now() + 60000).toISOString() };
  },
}));
mock.module("../firstStack/verifierOwnership", () => ({ acquireVerifierOwnership: async () => {
  ownsLifecycle = true;
  return {
  held: true,
  assertHeld: async () => {
    if (hold && stage === "ownership") { hold = false; entered(); await gate; }
  },
  close: async () => { ownsLifecycle = false; },
}; } }));
mock.module("../firstStack/submissionWorker", () => ({
  markSubmissionRecovery: async () => {}, verifySubmission: async () => {},
  verifierExecutionAllowed: () => true,
}));
mock.module("../firstStack/historicalReplay", () => ({
  historicalReplayTarget: () => {}, ownedReplayRow: async () => {}, replayHistoricalSubmission: async () => {},
}));
mock.module("../firstStack/admission", () => ({ submissionTransaction: () => {}, submissionEnvelope: {} }));
mock.module("../capabilities/policy", () => ({ requireCapability: () => {} }));
mock.module("../health/readinessCache", () => ({ createReadinessCache: (check: typeof probe) => {
  probe = check;
  let success = false;
  return { started: check().then(value => { success = value.success; }),
    invalidate: () => { success = false; invalidations++; },
    check: () => ({ success }), close: async () => {},
  };
} }));

// Capture the actual configuration at the factory boundary, keeping the real queue implementation.
const { startSubmissionQueue } = await import("../firstStack/submissionQueue");
mock.module("../firstStack/submissionQueue", () => ({
  startSubmissionQueue: (...args: Parameters<typeof startSubmissionQueue>) => {
    configuration = args[4]; return startSubmissionQueue(...args);
  },
}));
const { createVerifierLifecycle } = await import("../firstStack/verifierLifecycle");
const verifier = await createVerifierLifecycle({ enabled: true, image: `sha256:${"b".repeat(64)}`,
  endpoint: "fixture", qualification: "fixture" }, "a".repeat(64), {}).start();
let closing: Promise<void> | undefined;
try {
  assert.equal(verifier.availability().available, true);
  assert.equal(configuration.healthy(), true);
  hold = true;
  const pending = probe();
  await waiting;
  closing = verifier.close();
  const afterClose = invalidations;
  assert.equal(paused, true);
  release();
  assert.equal((await pending).success, false); // Admission stays closed throughout drain.
  assert.equal(invalidations, afterClose, "An intentional drain must not invalidate active execution");
  assert.equal(configuration.healthy(), true, "Active scored work retains execution authority");
  assert.equal(verifier.availability().available, false);
  // Genuine dependency loss must still revoke execution during the same drain.
  blocking.status = "end";
  assert.equal((await probe()).success, false);
  assert.equal(configuration.healthy(), false);
  assert.ok(invalidations > afterClose);
} finally {
  release(); finish(); await (closing ?? verifier.close());
}
console.log(`Drain race ${stage} passed`);
