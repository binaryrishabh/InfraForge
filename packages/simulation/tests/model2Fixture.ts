import type { Model2Input } from "../src/model2/contracts";
import type { RealityEntry } from "../src/reality/ledger";
import type { Quantity, Unit } from "../src/reality/quantity";

// Synthetic inputs chosen for analytical checks, not benchmark calibration.
export function proofInput(): Model2Input {
  const ledger: RealityEntry[] = [];
  const q = <U extends Unit>(concept: string, value: number, unit: U): Quantity<U> => {
    const id = `proof.${concept}`;
    ledger.push({ id, concept, modelVersion: "2", scope: "Internal synthetic service-station proof", quantity: { kind: "known", value, unit, provenance: [id] },
      formula: String(value), classification: "educational-assumption", confidence: "conditional",
      provenance: [{ source: "packages/simulation/tests/model2Fixture.ts", supports: "implementation", detail: "Explicit synthetic input; no provider/application benchmark claim." }],
      assumptions: ["Deterministic arrivals, reserved equal worker CPU shares, serial CPU then I/O, synchronous dependency."],
      researchedOn: "2026-10-15", freeMode: "forbidden", replacement: "M2B: measured service-demand profiles with calibration/error bounds." });
    return { kind: "known", value, unit, provenance: [id] };
  };
  return { modelVersion: "2", seed: "m2a-proof", ledger, resources: [
    { id: "edge", kind: "router", backends: ["app"] },
    { id: "app", kind: "compute", cores: q("app.cores", 2, "cores"), concurrency: q("app.workers", 4, "count"), queueCapacity: q("app.queue", 16, "count"), downstream: "db",
      demand: { read: { cpu: q("app.cpu", 2000, "cpu-us"), io: q("app.io", 0, "us") } } },
    { id: "db", kind: "database", cores: q("db.cores", 1, "cores"), concurrency: q("db.connections", 2, "count"), queueCapacity: q("db.queue", 4, "count"),
      demand: { read: { cpu: q("db.cpu", 5000, "cpu-us"), io: q("db.io", 10000, "us") } } },
  ], workload: [{ id: "read", entry: "edge", count: q("requests", 100, "count"), interval: q("interval", 10000, "us"), start: q("start", 0, "us"), timeout: q("timeout", 500000, "us") }],
    faults: [{ id: "db-pause", target: "db", kind: "pause-service", at: q("fault.at", 200000, "us"), duration: q("fault.duration", 300000, "us") }],
    horizon: q("horizon", 2000000, "us"), sampleInterval: q("sample", 50000, "us"), limits: { maxEvents: 100000, maxSamples: 121, maxRequests: 10000 } };
}
export function setProofValue(input: Model2Input, id: string, value: number) {
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.kind === "known" && Array.isArray(o.provenance) && o.provenance.includes(id)) o.value = value;
    for (const child of Object.values(o)) if (child && typeof child === "object") visit(child);
  };
  visit(input);
}
