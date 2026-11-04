import { expect, test } from "bun:test";
import { RESOURCE_PORTS } from "@infraforge/domain/resource";
import { eventBusDesign } from "./eventBus.fixture";
import { prepare } from "./asyncCanvas.fixture";
import { currentAdapterProfiles, contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { withRunLength } from "../src/model2/product/runContract";
import { createProductModel2 } from "../src/model2/product/run";

test("regression: policy and monitoring edges preserve the single app publisher requirement", () => {
  const saved = eventBusDesign(), port = RESOURCE_PORTS["Event Bus"];
  saved.resources.push({ id: "policy", type: "Firewall", x: 0, y: 0 }, { id: "monitor", type: "Monitoring Agent", x: 0, y: 0 });
  saved.connections.push({ id: "policy-bus", sourceId: "policy", targetId: "bus", sourceType: "Firewall", targetType: "Event Bus", port },
    { id: "monitor-bus", sourceId: "monitor", targetId: "bus", sourceType: "Monitoring Agent", targetType: "Event Bus", port });
  expect(contractFromDesign(saved)).not.toHaveProperty("refused");
  saved.resources.push({ id: "second-app", type: "Virtual Machine", x: 0, y: 0 });
  saved.connections.push({ id: "second-publisher", sourceId: "second-app", targetId: "bus", sourceType: "Virtual Machine", targetType: "Event Bus", port });
  const result = contractFromDesign(saved);
  expect(result).toHaveProperty("refused");
  if (!("refused" in result)) throw Error("Expected multiple publishers to refuse");
  expect(result.refused).toContainEqual(expect.objectContaining({ path: "resources.bus", message: "Connect one app publisher to Event Bus and 1 to 16 enabled queues to workers." }));
});

test("ordinary saved event bus design fans out to two workers with measured downstream effects", () => {
  const saved = eventBusDesign(), f = prepare(saved), contract = withRunLength(f.contract, 2, "bus-proof");
  const c = compileProduct(saved, contract); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  const e = runtime.evidence().asynchronous;
  expect(e.eventBuses![0]!.accepted).toBe(4);
  expect(e.eventBuses![0]!.subscriptions.map(s => s.delivered)).toEqual([4, 4]);
  expect(e.workers.map(w => w.effects)).toEqual([4, 4]);
});
test("event bus capture and compiler refuse absent, duplicate or mismatched intent", () => {
  const d = eventBusDesign(); expect(currentAdapterProfiles(d.resources)).toContain("event-bus/1");
  for (const adapterProfiles of [[], ["event-bus/1", "event-bus/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
  const f = prepare(d), config = f.contract.nodes.bus!.resources[0]!.config;
  if (config.kind !== "event-bus") throw Error("missing bus");
  config.subscriptions[0]!.target = "$queue2";
  expect(compileProduct(d, f.contract).ok).toBe(false);
});
test("a failed subscriber transport leaves the other worker receiving its events", () => {
  const saved = eventBusDesign(); saved.resources.find(r => r.id === "queue")!.listenerSettings = { version: 1, ports: [] };
  const f = prepare(saved), c = compileProduct(saved, withRunLength(f.contract, 2, "bus-proof")); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  const e = runtime.evidence().asynchronous;
  expect(e.eventBuses![0]!.subscriptions[0]).toMatchObject({ delivered: 0, retried: 8, deadLettered: 4, pending: 0 });
  expect(e.eventBuses![0]!.subscriptions[1]).toMatchObject({ delivered: 4, retried: 0, pending: 0 });
  expect(e.workers.map(w => w.effects)).toEqual([0, 4]);
});
test("saved subscription filters survive canonical capture and change only their own downstream effect", () => {
  const saved = eventBusDesign(); saved.resources.find(r => r.id === "bus")!.eventBus!.subscriptions = [{ id: "first", edge: "e2", filter: { keyPrefix: "never-matches" } }, { id: "second", edge: "e3" }];
  const f = prepare(saved), c = compileProduct(saved, withRunLength(f.contract, 2, "bus-proof")); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(2_000_000);
  expect(runtime.evidence().asynchronous.workers.map(w => w.effects)).toEqual([0, 4]);
  expect(runtime.evidence().asynchronous.eventBuses![0]!.subscriptions[0]).toMatchObject({ accepted: 0, filtered: 4, pending: 0 });
});
