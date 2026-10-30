import { expect, test } from "bun:test";
import { design } from "./asyncCanvas.fixture";
import { quantities } from "./workloadFixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { withRunLength } from "../src/model2/product/runContract";
import { validateDataFlowEffects } from "../src/model2/data/flowEffects";
import { dataAdapter } from "../src/model2/async/validate";
import { asyncAdapter } from "../src/model2/systems/validate";
import type { ProductContract, SavedProductDesign } from "../src/model2/product/contracts";
import { applicationFlowError } from "@infraforge/domain/resource";

function canvas(rps = 1) {
  const d = design(true, rps); d.workload.readWriteRatio = 0;
  d.resources[0]!.applicationFlow = { schema: "application-flow/3", operations: {
    write: { steps: [{ id: "before", kind: "compute" }, { id: "send", kind: "publish", edge: "e0" }, { id: "after", kind: "compute" }] },
  } };
  return d;
}
function compile(d = canvas(), change?: (c: ProductContract) => void) {
  const built = contractFromDesign(d); if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const c = withRunLength(built.contract, 4, "flow-publish"); change?.(c);
  const result = compileProduct(d, c); if (!result.ok) throw Error(JSON.stringify(result.diagnostics)); return result.value;
}
function run(d = canvas(), change?: (c: ProductContract) => void) {
  const compiled = compile(d, change), runtime = createProductModel2(compiled); runtime.advanceTo(4000000);
  return { compiled, runtime, evidence: runtime.evidence() };
}
const terminals = (e: ReturnType<typeof run>["evidence"]) => e.applicationFlow!.events.filter(e => e.kind === "flow-branch-terminal");

test("/3 publishes once at its row, uploads, consumes and acks; reads never publish", () => {
  const { compiled, evidence: e } = run();
  expect(e.counts.completed).toBe(4);
  expect(e.asynchronous.publishers[0]).toMatchObject({ received: 4, uploaded: 4, publishAttempts: 4 });
  expect(e.asynchronous.brokers[0]!.accepted).toBe(4);
  expect(e.asynchronous.workers[0]).toMatchObject({ effects: 4, acknowledged: 4 });
  const app = compiled.input.resources.find(r => r.id === "app");
  expect(app?.kind === "compute" && app.downstream).toBeUndefined();
  expect(e.applicationFlow!.profile).toBe("application-flow/3");
  expect(terminals(e).every(t => t.detail.edge === "e0" && t.detail.stage === "publish" && t.detail.confirmation === "confirmed" && t.detail.ambiguous === false && t.detail.physicalDurability === "Unknown")).toBe(true);
  const again = createProductModel2(compiled); again.advanceTo(4000000); expect(again.evidence()).toEqual(e);
  const d = canvas(); d.workload.readWriteRatio = 1;
  expect(run(d).evidence.asynchronous.publishers[0]!.received).toBe(0);
});

test("broker confirmation delays continuation and holds a producer worker without spending CPU", () => {
  const base = run(), d = canvas();
  const compiled = compile(d, c => {
    const q = quantities(); c.transports.assumed!.links.find(l => l.id === "response")!.propagation = q.q("proof.confirm-delay", 100100, "us"); c.ledger.push(...q.ledger);
  });
  const runtime = createProductModel2(compiled); runtime.advanceTo(200000);
  expect(runtime.inspect("app")!.compute!.workers.blockedDependency).toBe(1);
  expect(runtime.evidence().applicationFlow!.events.some(e => e.kind === "flow-step-start" && e.detail.step === "after")).toBe(false);
  runtime.advanceTo(4000000); const e = runtime.evidence();
  expect(e.results[0]!.responseUs!).toBeGreaterThan(base.evidence.results[0]!.responseUs! + 200000);
  expect(e.resources.find(s => s.id === "app")!.consumedCoreUs).toBe(base.evidence.resources.find(s => s.id === "app")!.consumedCoreUs);
});

test("slow worker and small queue expose broker-capacity refusal; rejected publishes are never retried", () => {
  const d = canvas(8); d.resources.find(r => r.id === "worker")!.asyncWorker!.cpuMsPerJob = 1500;
  const { evidence: e } = run(d, c => {
    const q = quantities(), broker = c.nodes.queue!.resources[0]!.config, worker = c.nodes.worker!.resources[0]!.config;
    if (broker.kind !== "delivery-queue" || worker.kind !== "async-worker") throw Error("async");
    broker.capacityMessages = q.q("proof.queue-capacity", 1, "count"); worker.cpu = q.q("proof.worker-cpu", 1500000, "cpu-us"); c.ledger.push(...q.ledger);
  });
  expect(e.counts.rejected).toBeGreaterThan(0);
  expect(terminals(e).some(t => t.detail.replyReason === "broker-capacity" && t.detail.confirmation === "refused" && t.detail.ambiguous === false && t.detail.rootReason === null)).toBe(true);
  expect(e.asynchronous.publishers[0]!.publishAttempts).toBe(32);
  expect(e.asynchronous.brokers[0]!.accepted).toBeLessThan(32);
  expect(e.asynchronous.workers[0]!.effects).toBeLessThan(e.asynchronous.brokers[0]!.accepted);
});

test("queue command refusal and timeout retain their observed reply reasons without retry", () => {
  for (const reason of ["command-queue-full", "command-timeout"]) {
    const { evidence: e } = run(canvas(20), c => {
      const q = quantities(), queue = c.nodes.queue!.resources[0]!.config; if (queue.kind !== "delivery-queue") throw Error("queue");
      queue.concurrency = q.q("proof.command-concurrency", 1, "count"); queue.pending = q.q("proof.command-pending", 0, "count");
      queue.demands.publish!.wait = q.q("proof.command-wait", 200000, "us");
      if (reason === "command-timeout") queue.timeout = q.q("proof.command-timeout", 1000, "us");
      c.ledger.push(...q.ledger);
    });
    expect(terminals(e).some(t => t.detail.replyReason === reason && t.detail.confirmation === "refused" && t.detail.ambiguous === false)).toBe(true);
    expect(e.asynchronous.publishers[0]!.publishAttempts).toBe(80);
  }
});

test("upload refusal, transport pool overflow and lost confirmation preserve stage, Unknown and observed cause", () => {
  const upload = run(canvas(), c => { const q = quantities(), store = c.nodes.store!.resources[0]!.config; if (store.kind !== "object-store") throw Error("store"); store.capacity = q.q("proof.store-full", 1024, "bytes"); c.ledger.push(...q.ledger); }).evidence;
  expect(upload.asynchronous.publishers[0]).toMatchObject({ uploaded: 0, publishAttempts: 0 });
  expect(terminals(upload).every(t => t.detail.stage === "upload" && t.detail.confirmation === "not-dispatched" && t.detail.replyReason !== null)).toBe(true);
  const overflow = run(canvas(1000), c => {
    const q = quantities(), limited = structuredClone(c.transports.assumed!); limited.pool.maxConnections = q.q("proof.one", 1, "count"); limited.pool.pending = q.q("proof.no-pending", 0, "count"); c.transports.limited = limited; c.edges.e0!.transport = "limited";
    const queue = c.nodes.queue!.resources[0]!.config; if (queue.kind !== "delivery-queue") throw Error("queue"); queue.demands.publish!.wait = q.q("proof.queue-wait", 100000, "us"); c.ledger.push(...q.ledger);
  }).evidence;
  expect(terminals(overflow).some(t => t.detail.rootReason === "pool-overflow")).toBe(true);
  const lost = run(canvas(0.5), c => {
    c.interventions = [{ id: "lose-confirmation", atUs: 7155, request: { interventionId: "partition", revision: 1, target: { edgeId: "e0", direction: "response" }, parameters: { duration: 3 } } }];
    const q = quantities(); c.transports.assumed!.pool.responseTimeout = q.q("proof.short-timeout", 200000, "us"); c.ledger.push(...q.ledger);
  }).evidence;
  expect(lost.asynchronous.brokers[0]!.accepted).toBeGreaterThan(0);
  expect(lost.asynchronous.workers[0]!.effects).toBeGreaterThan(0);
  expect(lost.asynchronous.publishers[0]!.publishAttempts).toBe(2);
  expect(terminals(lost).every(t => t.detail.confirmation === "Unknown" && t.detail.ambiguous === true && t.detail.replyReason === null)).toBe(true);
});

test("saved publish rejects old schema, read, second publish, arbitrary fields, parallel, missing edge/store and LB entry", () => {
  const changes: Array<(d: SavedProductDesign) => void> = [
    d => { d.resources[0]!.applicationFlow!.schema = "application-flow/2"; },
    d => { const f = d.resources[0]!.applicationFlow!; f.operations.read = f.operations.write; delete f.operations.write; },
    d => { d.resources[0]!.applicationFlow!.operations.write!.steps.push({ id: "twice", kind: "publish", edge: "e0" }); },
    d => { Object.assign(d.resources[0]!.applicationFlow!.operations.write!.steps[1]!, { retry: 2 }); },
    d => { d.resources[0]!.applicationFlow!.operations.write!.steps = [{ id: "p", kind: "parallel", wait: "all", branches: [{ id: "send", kind: "publish", edge: "e0" }] as never }]; },
    d => { const s = d.resources[0]!.applicationFlow!.operations.write!.steps[1]!; if (s.kind === "publish") s.edge = "e1"; },
    d => { d.connections = d.connections.filter(e => e.id !== "e1"); },
    d => { d.resources.push({ id: "lb", type: "Load Balancer", x: 0, y: 0 }); d.connections.push({ id: "lb-app", sourceId: "lb", targetId: "app", sourceType: "Load Balancer", targetType: "Virtual Machine", port: 80 }); },
  ];
  for (const change of changes) { const d = canvas(); change(d); expect(contractFromDesign(d)).toHaveProperty("refused"); }
  const d = canvas(), built = contractFromDesign(d); if ("refused" in built) throw Error("build");
  built.contract.application!.operations.find(o => o.id === "write")!.idempotency = "idempotent";
  expect(compileProduct(d, built.contract).ok).toBe(false);
  expect(applicationFlowError("Virtual Machine", canvas().resources[0]!.applicationFlow)).toBeUndefined();
});

test("mixed /1-/2-/3 parallel service and LB branches cannot hide publish, even with a falsely safe operation", () => {
  for (const schema of ["application-flow/1", "application-flow/2", "application-flow/3"] as const) for (const wait of [1, "all"] as const) for (const lb of [false, true]) {
    const input = dataAdapter(asyncAdapter(compile().input)), producer = input.resources.find(r => r.id === "app"); if (producer?.kind !== "compute") throw Error("app");
    input.operations.find(o => o.id === "write")!.idempotency = "idempotent";
    input.resources.push({ ...structuredClone(producer), id: "parent", applicationFlow: { schema, operations: { write: { steps: [{ id: "fan", kind: "parallel", wait, branches: [{ id: "producer", kind: "call", target: lb ? "lb" : "app" }, { id: "leaf", kind: "call", target: "leaf" }] }] } } } }, { ...structuredClone(producer), id: "leaf", applicationFlow: undefined });
    if (lb) input.resources.push({ id: "lb", kind: "load-balancer", backends: ["app"] } as never);
    expect(() => validateDataFlowEffects(input)).toThrow("publish");
  }
});

test("captured /3 selection is authoritative and /2 is only selected for actual /2 owners", () => {
  const d = canvas(); expect(currentAdapterProfiles(d.resources)).toEqual(["failure-cause/1", "application-flow/3"]);
  expect(contractFromDesign(d, { adapterProfiles: [] })).toHaveProperty("refused");
  expect(contractFromDesign(d, { adapterProfiles: ["application-flow/2"] })).toHaveProperty("refused");
  d.resources.push({ id: "service", type: "Virtual Machine", x: 0, y: 0, applicationFlow: { schema: "application-flow/2", operations: { read: { steps: [{ id: "c", kind: "compute" }] } } } });
  d.connections.push({ id: "app-service", sourceId: "app", targetId: "service", sourceType: "Virtual Machine", targetType: "Virtual Machine", port: 80 });
  d.resources[0]!.applicationFlow!.operations.write!.steps.unshift({ id: "call-service", kind: "call", edge: "app-service", operation: "read" });
  expect(currentAdapterProfiles(d.resources)).toEqual(["failure-cause/1", "application-flow/2", "application-flow/3"]);
  expect(run(d).evidence.counts.completed).toBe(4);
});

test("caller cancellation before dispatch and during upload/confirmation freezes the flow without rolling back accepted work", () => {
  for (const timeout of [100, 6500, 7200]) {
    const { evidence: e } = run(canvas(), c => {
      const q = quantities(); c.application!.operations.find(o => o.id === "write")!.callerTimeout = q.q("proof.caller-stop", timeout, "us"); c.ledger.push(...q.ledger);
    });
    expect(e.counts.completed).toBe(0);
    expect(e.results).toHaveLength(4);
    expect(e.applicationFlow!.events.some(e => e.kind === "flow-step-start" && e.detail.step === "after" && e.work?.offeredAt === 0)).toBe(false);
    expect(terminals(e).length).toBeLessThanOrEqual(4);
    if (timeout === 100) expect(e.asynchronous.publishers[0]!.publishAttempts).toBe(0);
    else {
      expect(e.asynchronous.publishers[0]!.publishAttempts).toBe(4);
      expect(e.asynchronous.brokers[0]!.accepted).toBe(4);
      expect(e.asynchronous.workers[0]!.effects).toBe(4);
      expect(terminals(e).find(t => t.work?.offeredAt === 0)!.detail).toMatchObject({ outcome: "cancelled-after-stop", confirmation: "Unknown", ambiguous: true });
    }
  }
});

test("pause parks the publish continuation; /3 evidence and child budgets stay bounded", () => {
  const compiled = compile(), q = quantities();
  compiled.input.faults.push({ id: "pause-confirm", target: "app", kind: "pause-service", at: q.q("proof.pause-at", 7000, "us"), duration: q.q("proof.pause-duration", 10000, "us") }); compiled.input.ledger.push(...q.ledger);
  const runtime = createProductModel2(compiled); runtime.advanceTo(16000);
  expect(runtime.evidence().applicationFlow!.events.some(e => e.kind === "flow-step-start" && e.detail.step === "after")).toBe(false);
  runtime.advanceTo(4000000); const e = runtime.evidence();
  expect(e.applicationFlow!.events.find(e => e.kind === "flow-step-start" && e.detail.step === "after")!.atUs).toBe(17000);
  expect(compiled.input.limits.maxLiveCalls).toBe(600000); // owner + two CPU rows + helper/upload/publish
  expect(compiled.input.limits.maxEvents).toBe(6000000);
  expect(e.capture.failure).toBeNull();
  expect(new TextEncoder().encode(JSON.stringify(e.applicationFlow)).length).toBeLessThanOrEqual(1024 * 1024);
  const bounded = compile(canvas(100)); bounded.input.limits.maxRawResults = 10;
  const limited = createProductModel2(bounded); limited.advanceTo(4000000); const flow = limited.evidence().applicationFlow!;
  expect(flow.retained).toBe(10); expect(flow.omitted).toBeGreaterThan(0);
  expect(Object.values(flow.totals).reduce((n, v) => n + v, 0)).toBe(flow.retained + flow.omitted);
});
