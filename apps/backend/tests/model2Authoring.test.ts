import { test, expect } from "bun:test";
import { authoredContract, assessDesign, authoringRequest } from "../internalModel2/authoring";
import { compileEnvelope, captureCuts, CompilationRefusal } from "../internalModel2/envelope";
import { instantiate, capture } from "../internalModel2/capture";
import { educationalExample } from "@infraforge/contracts/internal-model2/example";
const layout = { resources: [{ id: "web", type: "Virtual Machine", x: 0, y: 0 }, { id: "store", type: "Object Storage", x: 100, y: 0 }], connectionLines: [{ id: "data", sourceId: "web", targetId: "store", sourceType: "Virtual Machine", targetType: "Object Storage", port: 8080 }] };
const design = assessDesign({ id: "00000000-0000-4000-8000-000000000001", name: "Authored design", updatedAt: new Date("2026-10-16T00:00:00Z"), layout, challengeId: null });
test("guided product authoring compiles the actual saved IDs and educational origin without fixture defaults", () => {
  const draft = educationalExample(), authored = authoredContract(draft, design);
  const input = compileEnvelope("00000000-0000-4000-8000-000000000002", "owner", layout, new Date(design.updatedAt), { infrastructureId: design.id, expectedDesignUpdatedAt: design.updatedAt, idempotencyKey: "authored", workload: authored.workload, contract: authored.contract });
  const runtime = instantiate(input); let evidence: ReturnType<typeof capture> | undefined;
  for (const at of captureCuts(input)) { runtime.advanceTo(at); evidence = capture(runtime, input, (evidence?.sequence ?? 0) + 1, evidence?.checkpoints); }
  expect(evidence!.model.capture.reachedHorizon).toBe(true);
  if (evidence!.schema !== "infraforge-internal-evidence/1") throw Error("Expected v1 authoring evidence");
  expect(evidence!.model.commands.results).toHaveLength(3);
  expect(evidence!.usage.snapshot.complete).toBe(true);
  expect(Object.keys(input.contract.nodes)).toEqual(["store", "web"]);
  expect(input.contract.ledger.every((q) => q.freeMode === "forbidden" && q.provenance.some((p) => p.source === draft.origin))).toBe(true);
});
test("blank numeric fields never become zero; missing/security/unsupported inputs retain field errors", () => {
  try { authoredContract({ ...educationalExample(), values: {} }, design); throw Error("Accepted blank authoring"); } catch (e) { expect(e).toBeInstanceOf(CompilationRefusal); expect((e as CompilationRefusal).diagnostics.some((d) => d.path === "readCpu")).toBe(true); }
  const draft = educationalExample(); draft.values.readCpu = "";
  expect(() => authoredContract(draft, design)).toThrow("refused");
  draft.values.readCpu = "30"; draft.values.magicCapacity = "1";
  expect(() => authoredContract(draft, design)).toThrow("refused");
  expect(authoringRequest.safeParse({ infrastructureId: design.id, expectedDesignUpdatedAt: design.updatedAt, idempotencyKey: "x", authoring: { ...draft, security: "" } }).success).toBe(false);
});
test("saved legacy controls, wrong connection, challenge workspace and incomplete topology are refused without rewriting", () => {
  for (const field of ["skuId", "region", "size", "public", "encryption", "openPorts", "autoscaling"]) {
    const source = structuredClone(layout); Object.assign(source.resources[0]!, { [field]: field === "public" || field === "encryption" ? false : field === "openPorts" ? [] : field === "autoscaling" ? {} : field === "size" ? "small" : "authored" });
    const before = structuredClone(source);
    expect(assessDesign({ ...design, updatedAt: new Date(design.updatedAt), layout: source, challengeId: null }).supported).toBe(false); expect(source).toEqual(before);
  }
  expect(assessDesign({ ...design, updatedAt: new Date(design.updatedAt), layout, challengeId: "challenge" }).supported).toBe(false);
  expect(assessDesign({ ...design, updatedAt: new Date(design.updatedAt), layout: { ...layout, connectionLines: [] }, challengeId: null }).supported).toBe(false);
});
