import { dataFixture } from "./dataFixture";
import { quantities } from "./workloadFixture";
import type { RelationalConfig } from "../src/model2/data/contracts";
import type { FiniteIoProfile, IoEvidence, IoQuantity } from "../src/model2/data/io-contract";
import type { StackComposition } from "../src/model2/composition/run";
import type { Invocation } from "../src/model2/workload/contracts";

export const ioEvidence: IoEvidence = { kind: "authored", source: "finite-io-conservation-fixture", revision: "1", domain: "finite logical keyed work only", label: "assumption-only" };
export const iq = <U extends string>(value: number, unit: U): IoQuantity<U> => ({ value, unit, evidence: { ...ioEvidence } });
export function finiteIoFixture() {
  const input = dataFixture({ dbCpu: 1 }), q = quantities("Authored finite IO proof; no physical calibration");
  input.workloadVersion = "m2e-pg/1";
  const config = input.resources.find(r => r.kind === "relational") as RelationalConfig;
  config.semantics = "postgresql-keyed/1";
  for (const [op, plan] of Object.entries(config.plans)) {
    for (const field of ["statementTimeout", "transactionTimeout", "lockTimeout"] as const) plan[field] = q.q(`${op}.${field}`, 0, "us");
    if (op === "heavy") plan.durability = "authored-log-ack";
  }
  input.ledger.push(...q.ledger);
  const composition: StackComposition = { hosts: [{ id: "host", cores: q.q("host.cores", 1, "cores"), memory: q.q("host.memory", 4096, "bytes") }],
    bindings: ["app", "db", "cache"].map(resource => ({ resource, host: "host", reservedMemory: q.q(`${resource}.memory`, 256, "bytes") })) };
  const profile: FiniteIoProfile = { schema: "postgresql-keyed-io/1", identity: { profile: "finite-io-proof", revision: "1", workload: "authored-keys/1", evidence: { ...ioEvidence } },
    devices: [{ id: "disk", generation: 1, policy: "fifo-max-operation-byte-service/1", queueOperations: iq(8, "count"), queueBytes: iq(512, "bytes"), serviceConcurrency: iq(1, "count"), iops: iq(10000, "operations/s"), bytesPerSecond: iq(640000, "bytes/s"), flushServiceUs: iq(10, "us") }],
    buffers: [{ owner: "buffer", host: "host", device: "disk", pageBytes: iq(64, "bytes"), capacityBytes: iq(64, "bytes"), initialPages: [], policy: "declared-clean-page-lru/1", singleFlight: "coalesced/1" }],
    bindings: input.operations.flatMap(op => config.keys.map(key => ({ role: "db", operation: op.id, keys: [key], buffer: "buffer", statementPages: [[`page-${key}`]],
      walBytes: iq(op.id === "heavy" ? 64 : 0, "bytes"), walOperations: iq(op.id === "heavy" ? 1 : 0, "count"), commitAck: op.id === "heavy" ? "declared-local-wal-flush" as const : "read-only" as const }))),
    background: { policy: "excluded-unknown", schedule: [] }, limits: { maxPages: 100, maxReceipts: 100, maxScheduledBackgroundOperations: 10, maxScheduledBackgroundBytes: 1024 } };
  return { input, config, composition, profile, q };
}
export const ioInvocation = (id: string, operation = "light", key = "k0"): Invocation => ({ rootId: id, callId: id, sessionId: id, operation, offeredAt: 0, attempt: 0, message: { request: { kind: "query", key } } });
