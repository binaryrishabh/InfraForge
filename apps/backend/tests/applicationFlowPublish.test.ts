import { expect, test } from "bun:test";
import { RESOURCE_PORTS, DEFAULT_ASYNC_QUEUE_SETTINGS, DEFAULT_ASYNC_WORKER_SETTINGS, type Resource } from "@infraforge/domain/resource";
import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { captureSnapshot } from "../simulator/snapshot";
import type { SimulationInstance } from "../simulator/instance";
import { compareInputs } from "../comparison/inputs";
import type { ContractBuilder } from "@infraforge/simulation/internal-product";

function canvas() {
  const types: Record<string, Resource["type"]> = { app: "Virtual Machine", queue: "Message Queue", worker: "Virtual Machine", store: "Object Storage" };
  const resources: Resource[] = Object.entries(types).map(([id, type]) => ({ id, type, x: 0, y: 0 }));
  resources[0]!.applicationFlow = { schema: "application-flow/3", operations: { write: { steps: [{ id: "before", kind: "compute" }, { id: "send", kind: "publish", edge: "e0" }, { id: "after", kind: "compute" }] } } };
  resources.find(r => r.id === "queue")!.asyncQueue = { ...DEFAULT_ASYNC_QUEUE_SETTINGS };
  resources.find(r => r.id === "worker")!.asyncWorker = { ...DEFAULT_ASYNC_WORKER_SETTINGS };
  const connectionLines = [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]].map(([s, t], i) => ({ id: `e${i}`, sourceId: s!, targetId: t!, sourceType: types[s!]!, targetType: types[t!]!, port: RESOURCE_PORTS[types[t!]!] }));
  return { resources, connectionLines };
}
const workload = { targetThroughput: 60, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 0, payloadSize: "light" as const };

test("/3 saves/reloads without defaults and captures its exact required profiles", () => {
  const d = canvas(); expect(validateDeploymentReadiness(d.resources, d.connectionLines).valid).toBe(true);
  for (const schema of [LayoutSchema, LiveTopologySchema]) expect<Resource[]>(schema.parse(JSON.parse(JSON.stringify(d))).resources).toEqual(d.resources);
  const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(d, workload, "publish-parity"))));
  expect(input.adapterProfiles).toEqual(["failure-cause/1", "application-flow/3"]);
  for (const adapterProfiles of [undefined, [], ["failure-cause/1"], ["application-flow/2"]] as const) expect(buildContractFromRunInputs({ ...input, adapterProfiles: adapterProfiles ? [...adapterProfiles] : undefined }, 4)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["application-flow/4"] })).toThrow();
  for (const schema of ["application-flow/1", "application-flow/2"] as const) { const old = structuredClone(d); old.resources[0]!.applicationFlow!.schema = schema; expect(LayoutSchema.safeParse(old).success).toBe(false); }
  const legacy = canvas(); delete legacy.resources[0]!.applicationFlow;
  expect(captureRunInputs(legacy, workload, "old").adapterProfiles).toEqual([]);
});

for (const cause of [false, true]) test(`browser/server publish evidence and serialized terminal capture match, cause=${cause}`, () => {
  const d = canvas(), input = readRunInputs(captureRunInputs(d, workload, "publish-parity"));
  input.adapterProfiles = cause ? ["failure-cause/1", "application-flow/3"] : ["application-flow/3"];
  const browser = createModel2Run(input, 4), server = createModel2Engine(input, 4, buildModel2Contract);
  for (let i = 0; i < 4; i++) { browser.advance(); server.advance(); expect(browser.applicationFlowEvidence()).toEqual(server.applicationFlowEvidence()); expect(browser.evidence()).toEqual(server.evidence()); }
  const instance: SimulationInstance = { model2: server, tickCount: 4, pendingLogs: [], speed: 1, lastCheckpointAt: 0, accumulatedCostUsd: 0, topology: d, topologyRevision: 0, actions: new Map(), acknowledge: null, metricsComputedAt: null, metricsTopologyRevision: 0 };
  const record = JSON.parse(JSON.stringify(captureSnapshot("publish", instance, "terminal"))) as ReturnType<typeof captureSnapshot>;
  expect(record.applicationFlow).toEqual(browser.applicationFlowEvidence());
  expect(record.applicationFlow!.profile).toBe("application-flow/3");
  const rows = record.applicationFlow!.events.filter(e => e.kind === "flow-branch-terminal"); expect(rows).toHaveLength(4);
  expect(rows.every(e => e.detail.stage === "publish" && e.detail.edge === "e0" && e.detail.confirmation === "confirmed")).toBe(true);
});

test("comparison detects effective profile differences and preserves authored edge IDs and row order", () => {
  const a = captureRunInputs(canvas(), workload, "compare");
  for (const adapterProfiles of [undefined, ["application-flow/3"], ["failure-cause/1", "application-flow/2"]] as const) {
    const b = { ...a, adapterProfiles: adapterProfiles ? [...adapterProfiles] : undefined };
    expect(compareInputs(a, b)).toMatchObject({ grade: "side-by-side-only", facets: { adapterProfiles: "different" } });
    expect(compareInputs(a, b).compatibilityReason).toContain("Captured adapter profile selections differ");
  }
  expect(compareInputs(a, { ...a, adapterProfiles: [...a.adapterProfiles!].reverse() }).grade).toBe("same-starting-point");
  const old = { ...a, adapterProfiles: undefined }; expect(compareInputs(old, { ...old, adapterProfiles: [] }).grade).toBe("same-starting-point");
  const renamed = structuredClone(a); renamed.connectionLines[0]!.id = "new-queue-edge";
  expect(compareInputs(a, renamed).grade).toBe("one-change-design");
  const reordered = structuredClone(a); reordered.resources[0]!.applicationFlow!.operations.write!.steps.reverse();
  expect(compareInputs(a, reordered).grade).toBe("one-change-design");
});

test("browser/server slow-worker capacity refusal matches in full evidence and serialized flow cause", () => {
  const d = canvas(); d.resources.find(r => r.id === "worker")!.asyncWorker!.cpuMsPerJob = 1500;
  const input = readRunInputs(captureRunInputs(d, { ...workload, targetThroughput: 480 }, "publish-refusal"));
  const build: ContractBuilder = (...args) => {
    const built = buildModel2Contract(...args); if ("refused" in built) return built;
    const c = built.contract, queue = c.nodes.queue!.resources[0]!.config; if (queue.kind !== "delivery-queue") throw Error("queue");
    const old = c.ledger.find(e => e.id === queue.capacityMessages.provenance[0])!, id = "proof.capacity";
    queue.capacityMessages = { kind: "known", value: 1, unit: "count", provenance: [id] };
    c.ledger.push({ ...old, id, quantity: queue.capacityMessages, formula: "1" }); return built;
  };
  const browser = createModel2Run(input, 4, build), server = createModel2Engine(input, 4, build);
  for (let i = 0; i < 4; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.applicationFlowEvidence()).toEqual(server.applicationFlowEvidence()); }
  const rows = JSON.parse(JSON.stringify(browser.applicationFlowEvidence())) as ReturnType<typeof browser.applicationFlowEvidence>;
  expect(rows!.events.some(e => e.kind === "flow-branch-terminal" && e.detail.replyReason === "broker-capacity" && e.detail.confirmation === "refused" && e.detail.rootReason === null)).toBe(true);
});
