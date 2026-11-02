import { expect, test } from "bun:test";
import { createLiveModel2 } from "../src/model2/product/live";
import { createProductModel2 } from "../src/model2/product/run";
import { observabilityLive } from "../src/model2/product/observabilityLive";
import { bufferSetup } from "./monitoringBuffer.fixture";
import { objectSetup } from "./objectCapacity.fixture";
import { firewallSetup, firewallDesign } from "./firewallCapacity.fixture";
import { prepareSecurity, securityDesign } from "./securityCanvas.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized hashes captured on untouched a6552c36f33d8f4c8d3bbf3856e3346530630c51. Never regenerate.
const pins = [
  ["fbc2a218222e4e0eb9e043e2ce24645ba424653ed3eb4859939c779df0b6fb33", "abe2266e4f1a7446c5300a661f4e7df545bd6b528cc0d9eb1d69106baacb3592", "1201c6616ad7b691e1bd44febf80cf0c515b5d32d9b460e341a16c9c3e26cf20", "0e53863d6436917bad61a1b7b5a1985063c2405e89de04f62d6eadd5c8ca63d0"],
  ["ebb8d4e2ecc8fd8e2fe26dc90829ecceb36db3f6e6a278550a17718294ae2aad", "27a4557949bba8291cd2c560bfd1252dfacc6271a91e28de5f2f26cada6764eb", "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03", "b47cae0b208aa450657349c63f07077a80672e01a15b1e5ffd269ca2c77f32e0"],
  ["a90237f406dd92d3bc5083d346e952c42fb60836d5f210fbaf0d1cd725d94e38", "06d7e401fa280159e0310a53af2ca9b0f00f0003796cc85715bc84cecd6ea887", "18f5710f29ec7a6a4e8049537ae5d067b2e67f1e5868a998823e77c2f227b506", "821a9051f727f11d814b0e614d1505819a5ab79d8359c04e2a3e66d09092ab9a"],
];

test("readout preserves base monitoring, object and firewall contracts, artifacts, assumptions and evidence", () => {
  for (const [i, f] of [bufferSetup(), objectSetup(), firewallSetup()].entries()) {
    f.runtime.advanceTo(1_000_000);
    expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(pins[i]!);
  }
});

function expectReadings(run: ReturnType<typeof createLiveModel2>, official = run.evidence()) {
  const metrics = run.project().metrics;
  for (const row of official.systems.monitors) {
    expect(metrics[row.id]!.monitoring).toEqual({ version: 1, generated: row.generated, collections: row.collections, collectionFailures: row.collectionFailures,
      exported: row.exported, dropped: row.dropped, droppedBeforeExport: row.droppedBeforeExport, discardedUnconfirmed: row.discardedUnconfirmed,
      batches: row.batches, failedBatches: row.failedBatches, bufferedSamples: row.buffered.length, bufferedBytes: row.bufferedBytes,
      inFlightSamples: row.inFlight.reduce((n, batch) => n + batch.rows.length, 0), inFlightBytes: row.inFlightBytes, freshness: row.freshness });
    expect(metrics[row.id]!.objectStorage).toBeUndefined();
  }
  for (const row of official.asynchronous.objects) {
    expect(metrics[row.id]!.objectStorage).toEqual({ version: 1, storedBytes: row.storedBytes, capacityBytes: row.capacityBytes,
      committedPuts: row.committedPuts, replacedObjects: row.replacedObjects, removedObjects: row.removedObjects, deletes: row.deletes,
      "object-capacity": row.service.reasons["object-capacity"] ?? null });
    expect(metrics[row.id]!.monitoring).toBeUndefined();
  }
  for (const row of official.systems.security.policies) {
    const firewall = metrics[row.id]?.security?.firewall;
    if (firewall) expect(firewall).toMatchObject({ occupancy: row.flows.length, admissions: row.opened, policyDenied: row.denied, "flow-capacity": null });
  }
}

test("monitoring and object storage read their resource-owned official evidence at every second", () => {
  for (const f of [bufferSetup("vm", { version: 1, collectionIntervalSeconds: 1, exportIntervalSeconds: 1 }), objectSetup("upload", 1)]) {
    const run = createLiveModel2(f.compiled, f.saved.resources.map(r => r.id));
    for (let second = 0; second < 8; second++) { run.advanceSecond(); expectReadings(run); }
  }
});

test("two agents, two object stores and two firewalls in one design keep distinct evidence", () => {
  const saved = securityDesign({ lb: "Load Balancer", app: "Virtual Machine", app2: "Virtual Machine", store: "Object Storage", store2: "Object Storage", monitor: "Monitoring Agent", monitor2: "Monitoring Agent", firewall: "Firewall", second: "Firewall" },
    [["lb", "app"], ["lb", "app2"], ["app", "store"], ["app2", "store2"], ["monitor", "app"], ["monitor2", "app2"], ["firewall", "lb"], ["second", "app2"]]);
  for (const id of ["firewall", "second"]) saved.resources.find(r => r.id === id)!.firewallSettings = { version: 1, default: "allow", rules: [] };
  saved.resources.find(r => r.id === "monitor")!.monitoringPolicy = { version: 1, collectionIntervalSeconds: 1 };
  saved.resources.find(r => r.id === "monitor2")!.monitoringPolicy = { version: 1, collectionIntervalSeconds: 2 };
  saved.resources.find(r => r.id === "store")!.objectStoragePolicy = { version: 1, capacityMiB: 1 };
  saved.resources.find(r => r.id === "store2")!.objectStoragePolicy = { version: 1, capacityMiB: 2 };
  const f = prepareSecurity(saved), run = createLiveModel2(f.compiled, saved.resources.map(r => r.id)), official = createProductModel2(f.compiled);
  for (let second = 0; second < 4; second++) run.advanceSecond();
  official.advanceTo(4_000_000); expectReadings(run, official.evidence());
  const metrics = run.project().metrics;
  expect(metrics.monitor!.monitoring!.generated).toBeGreaterThan(metrics.monitor2!.monitoring!.generated!);
  expect(metrics.store!.objectStorage!.capacityBytes).not.toBe(metrics.store2!.objectStorage!.capacityBytes);
  expect(metrics.firewall!.security!.firewall!.admissions).not.toBe(metrics.second!.security!.firewall!.admissions);
  expect(metrics.app!.monitoring).toBeUndefined(); expect(metrics.app!.objectStorage).toBeUndefined();
});

test("one-shot and stepped advancement produce identical observability views and official evidence", () => {
  for (const f of [bufferSetup("vm", { version: 1, collectionIntervalSeconds: 1 }), objectSetup("upload", 1), firewallSetup("front", 1)]) {
    const ids = f.saved.resources.map(r => r.id), stepped = createLiveModel2(f.compiled, ids), oneShot = createLiveModel2(f.compiled, ids);
    let view;
    for (let second = 0; second < 4; second++) { stepped.advanceSecond(); view = stepped.project(); }
    if (!view) throw Error("Expected four projected seconds");
    oneShot.catchUp(3, 3); oneShot.advanceSecond(); expect(oneShot.project()).toEqual(view);
    f.runtime.advanceTo(4_000_000);
    expect(stepped.evidence()).toEqual(f.runtime.evidence()); expect(oneShot.evidence()).toEqual(f.runtime.evidence());
  }
});

test("missing resource evidence and missing fields stay Unknown", () => {
  const missing = { inspectMonitor: () => undefined, inspectObject: () => undefined };
  for (const f of [bufferSetup(), objectSetup()]) for (const resource of f.compiled.input.resources.filter(r => r.kind === "monitor" || r.kind === "object-store")) {
    const block = observabilityLive(resource, missing);
    for (const [key, value] of Object.entries(block.monitoring ?? block.objectStorage!)) expect(value).toBe(key === "version" ? 1 : null);
  }
  const f = bufferSetup(), row = f.runtime.evidence().systems.monitors[0]!;
  Reflect.deleteProperty(row, "generated"); Reflect.deleteProperty(row, "buffered"); Reflect.deleteProperty(row, "inFlight"); Reflect.deleteProperty(row, "freshness");
  const resource = f.compiled.input.resources.find(r => r.kind === "monitor")!;
  expect(observabilityLive(resource, { ...missing, inspectMonitor: () => row }).monitoring).toMatchObject({ generated: null, bufferedSamples: null, inFlightSamples: null, freshness: null });
});

test("ambiguous backend arrival never becomes a confirmed export", () => {
  const f = bufferSetup("slow-export", { version: 2, bufferSamples: 8, batchSamples: 4, collectionIntervalSeconds: 1, exportIntervalSeconds: 1, exportAttempts: 1 });
  const run = createLiveModel2(f.compiled, f.saved.resources.map(r => r.id));
  for (let second = 0; second < 12; second++) run.advanceSecond();
  expectReadings(run);
  const row = run.project().metrics.monitor!.monitoring!, backend = run.evidence().systems.backends[0]!;
  expect(backend.received).toBeGreaterThan(0); expect(row.discardedUnconfirmed).toBeGreaterThan(0); expect(row.exported).toBe(0);
});

for (const scenario of ["capacity", "policy", "listener", "tls"] as const) test(`firewall ${scenario} keeps refusal reasons separate`, () => {
  const saved = firewallDesign("front", scenario === "capacity" ? 1 : 10000);
  saved.workload.targetThroughput = 60000;
  const f = prepareSecurity(saved), input = f.compiled.input;
  for (const path of input.paths) path.pool.reuse = false;
  // Exercise the existing gates directly without changing their evidence or adding counters.
  if (scenario === "policy") input.systems.firewalls[0]!.default = "deny";
  if (scenario === "listener") input.systems.listeners = input.systems.listeners.filter(l => l.resource !== "lb");
  if (scenario === "tls") input.systems.listeners.find(l => l.resource === "lb")!.tls = "required";
  const run = createLiveModel2(f.compiled, saved.resources.map(r => r.id));
  for (let second = 0; second < 3; second++) run.advanceSecond();
  const evidence = run.evidence().systems.security, block = run.project().metrics.firewall!.security!.firewall!;
  const prefix = scenario === "capacity" ? "flow-capacity:" : scenario === "policy" ? "policy-denied:" : scenario === "listener" ? "no-listener" : "tls-required";
  expect(evidence.events.rows.some(e => e.detail.startsWith(prefix))).toBe(true);
  expect(block.policyDenied).toBe(evidence.policies[0]!.denied); expect(block["flow-capacity"]).toBeNull();
  if (scenario !== "policy") expect(block.policyDenied).toBe(0);
  if (scenario === "policy") expect(block.policyDenied).toBeGreaterThan(0);
});
