import { expect, test } from "bun:test";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { compareInputs } from "../comparison/inputs";
import { configuration } from "../comparison/design";
import { capacityLayout, capacityWorkload as workload } from "./queueCapacity.fixture";

function layout(delay?: number) {
  const saved = capacityLayout();
  if (delay !== undefined) saved.resources.find(r => r.id === "worker")!.asyncWorker!.acknowledgementDelayMs = delay;
  return saved;
}

test("layout, live, saved capture and comparison preserve explicit delay without upgrading old inputs", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) for (const delay of [undefined, 0, 2000, 60000]) {
    const saved = JSON.parse(JSON.stringify(schema.parse(layout(delay))));
    const input = readRunInputs(captureRunInputs(saved, workload, "queue-depth"));
    expect(input.resources.find(r => r.id === "worker")!.asyncWorker!.acknowledgementDelayMs).toBe(delay);
    expect(input.adapterProfiles).toEqual([...(delay === undefined ? [] : ["queue-ack-delay/1"]), "traffic-evidence/2"]);
    const built = buildContractFromRunInputs(input, 15); if ("refused" in built) throw Error(JSON.stringify(built));
    expect(built.contract.nodes.worker!.resources[0]!.config).toHaveProperty("ackDelay.value", (delay ?? 0) * 1000);
    if (delay === undefined) expect(configuration(input.resources.find(r => r.id === "worker")!).asyncWorker).not.toHaveProperty("acknowledgementDelayMs");
  }
  const old = captureRunInputs(layout(), workload, "queue-depth"), delayed = captureRunInputs(layout(2000), workload, "queue-depth");
  expect(compareInputs(old, delayed)).toMatchObject({ grade: "side-by-side-only", design: { reconfigured: [{ id: "worker", fields: [{ field: "asyncWorker" }] }] } });
  for (const adapterProfiles of [undefined, [], ["queue-capacity/1" as const]]) expect(buildContractFromRunInputs({ ...delayed, adapterProfiles }, 15)).toHaveProperty("refused");
  expect(buildContractFromRunInputs({ ...old, adapterProfiles: delayed.adapterProfiles }, 15)).toHaveProperty("refused");
  expect(() => readRunInputs({ ...delayed, adapterProfiles: ["queue-ack-delay/1", "queue-ack-delay/1"] })).toThrow();
});

test("layout and live refuse invalid delay, wrong ownership and unknown worker settings", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const enabled of [true, false]) for (const acknowledgementDelayMs of [null, -1, 0.5, 60001, "2000", true, {}, []]) {
      const saved = layout(); Object.assign(saved.resources.find(r => r.id === "worker")!.asyncWorker!, { enabled, acknowledgementDelayMs });
      expect(schema.safeParse(saved).success).toBe(false);
    }
    const saved = layout(2000); saved.resources.find(r => r.id === "worker")!.type = "Message Queue";
    expect(schema.safeParse(saved).success).toBe(false);
    const unknown = layout(); Object.assign(unknown.resources.find(r => r.id === "worker")!.asyncWorker!, { ackDelay: 2000 });
    expect(schema.safeParse(unknown).success).toBe(false);
  }
});
