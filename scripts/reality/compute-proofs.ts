import { writeFileSync } from "node:fs";
import { computeFixture } from "../../packages/simulation/tests/computeFixture";
import { quantities } from "../../packages/simulation/tests/workloadFixture";
import { createComputeModel2 } from "../../packages/simulation/src/model2/compute/run";
const cases = [
  { name: "A-unused-cpu", cores: 4, slots: 8, count: 1 },
  { name: "B-contention", cores: 2, slots: 16, count: 100 },
  { name: "C-blocked", cores: 4, slots: 8, count: 50, wait: 5000 },
  { name: "D-workers-one", cores: 2, slots: 1, count: 100 },
  { name: "D-workers-eight", cores: 2, slots: 8, count: 100 },
  { name: "E-control", cores: 2, slots: 2, count: 100 },
  { name: "E-competition", cores: 2, slots: 2, count: 100 },
  { name: "F-memory-small", cores: 2, slots: 8, count: 100, requestBytes: 100, activeBytes: 200 },
  { name: "F-memory-large", cores: 2, slots: 8, count: 100, requestBytes: 10000, activeBytes: 20000 },
  { name: "pause-retention", cores: 2, slots: 8, count: 100 },
];
export function computeProofs() {
  return cases.map(({ name, ...options }) => {
    const input = computeFixture({ ...options, cpu: 1000, interval: 100, timeout: 5000, horizon: 200000, sample: 1000, queue: 1000 }), q = quantities("Authored synthetic M2C teaching proof; no host/provider calibration claim");
    if (name === "E-competition") input.interventions = [{ id: "cpu-competitor", kind: "competitor", target: "app", at: q.q("proof.comp.at", 1000, "us"), duration: q.q("proof.comp.duration", 10000, "us"), demand: q.q("proof.comp.cpu", 20000, "cpu-us"), parallelism: q.q("proof.comp.cap", 2, "cores") }];
    if (name === "pause-retention") input.faults = [{ id: "pause", kind: "pause-service", target: "app", at: q.q("proof.pause.at", 2000, "us"), duration: q.q("proof.pause.duration", 5000, "us") }];
    input.ledger.push(...q.ledger); const model = createComputeModel2(input); model.advanceTo(model.horizon); const e = model.evidence();
    return { name, provenance: "All physics inputs are explicit synthetic fixtures registered in their generated input ledger", counts: e.counts,
      resources: e.resources.map((r) => ({ ...r, compute: r.compute ? { ...r.compute, cpu: { ...r.compute.cpu, allocations: undefined } } : undefined })),
      phases: e.samples.filter((s) => [1000, 5000, 10000, 20000].includes(s.at)).map((s) => ({ ...s, resources: s.resources.map((r) => ({ ...r, compute: r.compute ? { ...r.compute, cpu: { ...r.compute.cpu, allocations: undefined } } : undefined })) })),
      execution: e.execution, interventions: e.interventions };
  });
}
if (import.meta.main) { const proofs = computeProofs(); if (process.argv.includes("--write")) writeFileSync(new URL("../../docs/reality/m2c-proofs.json", import.meta.url), JSON.stringify(proofs, null, 2) + "\n"); console.log(JSON.stringify(proofs)); }
