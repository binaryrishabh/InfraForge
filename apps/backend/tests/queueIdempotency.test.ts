import { expect, test } from "bun:test";
import type { Resource } from "@infraforge/domain/resource";
import { buildContractFromRunInputs, compileProduct, contractFromDesign } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";
import { configuration } from "../comparison/design";
import { idempotencyLayout, idempotencyWorkload as workload } from "./queueIdempotency.fixture";

test("idempotent result intent survives save/reload and new captures select only explicit true", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) for (const value of [undefined, false, true]) {
    const saved = JSON.parse(JSON.stringify(schema.parse(idempotencyLayout(value))));
    const input = readRunInputs(captureRunInputs(saved, workload, "idempotency"));
    expect(input.resources.find(r => r.id === "worker")!.asyncWorker!.idempotentResults).toBe(value);
    expect(input.adapterProfiles).toEqual([...(value === true ? ["queue-idempotency/1"] : []), "traffic-evidence/2"]);
    const built = buildContractFromRunInputs(input, 3);
    if ("refused" in built) throw Error(JSON.stringify(built));
    expect(built.contract.nodes.worker!.resources[0]!.config).toHaveProperty("idempotency", value ? "object-if-absent" : "none");
    if (value === undefined) expect(configuration(input.resources.find(r => r.id === "worker")!).asyncWorker).not.toHaveProperty("idempotentResults");
  }
});

test("captured replay refuses missing, mismatched and duplicate profiles and composes stacked intent", () => {
  const input = captureRunInputs(idempotencyLayout(true), workload, "idempotency"), old = captureRunInputs(idempotencyLayout(), workload, "idempotency");
  for (const adapterProfiles of [undefined, [], ["queue-capacity/1" as const]]) expect(buildContractFromRunInputs({ ...input, adapterProfiles }, 3)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: input.adapterProfiles }, 3)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...input, adapterProfiles: ["queue-idempotency/1", "queue-idempotency/1"] })).toThrow();
  const combined = captureRunInputs(idempotencyLayout(true, true, 3), workload, "idempotency");
  expect(combined.adapterProfiles).toEqual(["failure-cause/1", "application-flow/3", "queue-capacity/1", "queue-idempotency/1", "traffic-evidence/2"]);
  expect(buildContractFromRunInputs(combined, 3)).toHaveProperty("contract");
  expect(compareInputs(old, input)).toMatchObject({ grade: "side-by-side-only", design: { reconfigured: [{ id: "worker", fields: [{ field: "asyncWorker" }] }] } });
});

test("layout/live validation strictly bounds the boolean and refuses wrong owners and worker databases", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const idempotentResults of [null, 0, 1, "true", {}, []]) {
      const d = idempotencyLayout(); Object.assign(d.resources.find(r => r.id === "worker")!.asyncWorker!, { idempotentResults });
      expect(schema.safeParse(d).success).toBe(false);
    }
    for (const type of ["Message Queue", "Database", "Object Storage"] as Resource["type"][]) {
      const d = idempotencyLayout(true); d.resources.find(r => r.id === "worker")!.type = type;
      expect(schema.safeParse(d).success).toBe(false);
    }
    const d = idempotencyLayout(true);
    d.resources.push({ id: "db", type: "Database", x: 3, y: 0 });
    d.connectionLines.push({ id: "worker-db", sourceId: "worker", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432 });
    expect(schema.safeParse(d).success).toBe(false);
    const saved = { schema: "infraforge-saved-design/1" as const, resources: d.resources, connections: d.connectionLines, workload };
    expect(contractFromDesign(saved)).toHaveProperty("refused");
    const valid = buildContractFromRunInputs(captureRunInputs(idempotencyLayout(true), workload, "idempotency"), 3);
    if ("refused" in valid) throw Error(JSON.stringify(valid));
    expect(compileProduct(saved, valid.contract).ok).toBe(false);
  }
});
