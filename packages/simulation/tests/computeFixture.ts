import { workloadFixture, quantities } from "./workloadFixture";
import type { ComputeInput, ComputeProfile, ComputeResource } from "../src/model2/compute/contracts";

export function computeFixture(options: Parameters<typeof workloadFixture>[0] & { parallelism?: number; wait?: number; requestBytes?: number; activeBytes?: number } = {}): ComputeInput {
  const base = workloadFixture(options), { q, ledger } = quantities("Synthetic M2C compute/memory mechanism verification; no measured/provider validity");
  const profiles: ComputeProfile[] = base.profiles.map(({ io: _io, ...p }) => ({ ...p, schema: "infraforge-compute-demand/1", stage: "compute", blockingWait: q(`${p.id}.blocking`, options.wait ?? 0, "us"), maxCpuParallelism: q(`${p.id}.parallelism`, options.parallelism ?? 1, "cores"),
    residentCoverage: "complete-model", requestResidentBytes: q(`${p.id}.requestBytes`, options.requestBytes ?? 10, "bytes"), activeResidentBytes: q(`${p.id}.activeBytes`, options.activeBytes ?? 20, "bytes") }));
  const resource = base.resources[0]!; if (resource.kind === "router") throw new Error();
  const { concurrency, ...common } = resource;
  const compute: ComputeResource = { ...common, kind: "compute", workers: concurrency, scheduler: "capped-equal-fluid/1", memory: { coverage: "complete-model", baseline: q("memory.baseline", 100, "bytes"), perWorker: q("memory.perWorker", 5, "bytes"), retained: q("memory.retained", 7, "bytes"), policy: "observe" } };
  base.ledger.push(...ledger);
  return { ...base, workloadVersion: "m2c/1", profiles, resources: [compute], interventions: [] };
}
