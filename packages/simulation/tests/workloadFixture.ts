import type { RealityEntry } from "../src/reality/ledger";
import type { Quantity, Unit } from "../src/reality/quantity";
import type { WorkloadInput } from "../src/model2/workload/contracts";
import type { DemandProfile } from "../src/model2/workload/profiles";

export function quantities(scope = "Synthetic M2B verification; no external validity") {
  const ledger: RealityEntry[] = [];
  const q = <U extends Unit>(id: string, value: number, unit: U): Quantity<U> => {
    ledger.push({ id, concept: id, modelVersion: "2", scope, validityDomain: scope, quantity: { kind: "known", value, unit, provenance: [id] }, formula: String(value),
      classification: "educational-assumption", confidence: "conditional", provenance: [{ source: "packages/simulation/tests/workloadFixture.ts", supports: "implementation", detail: scope }],
      assumptions: [scope], researchedOn: "2026-10-15", freeMode: "forbidden", replacement: "Only measured workload-specific calibration can support physical applicability" });
    return { kind: "known", value, unit, provenance: [id] };
  };
  return { q, ledger };
}

export function workloadFixture(options: { cpu?: number; heavy?: number; count?: number; interval?: number; timeout?: number; horizon?: number; queue?: number; slots?: number; cores?: number; sample?: number; raw?: number; cancellation?: "cooperative" | "unsupported" } = {}): WorkloadInput {
  const { q, ledger } = quantities();
  const profiles: DemandProfile[] = ["light", "heavy"].map((operation) => ({
    schema: "infraforge-demand/1", id: `synthetic.${operation}`, version: "1", application: "analytical-fixture", operation, stage: "compute", method: "synthetic",
    cpu: q(`${operation}.cpu`, operation === "light" ? options.cpu ?? 100 : options.heavy ?? 800, "cpu-us"), io: q(`${operation}.io`, 0, "us"),
    obtainedBy: "Authored analytical inputs", evidence: ["packages/simulation/tests/workloadFixture.ts"], date: "2026-10-15",
    validity: { exact: { software: "synthetic", environment: "verification-only" }, ranges: {} }, uncertainty: ["Verifies software only"], freeMode: "forbidden",
  }));
  return { modelVersion: "2", workloadVersion: "m2b/1", seed: "workload-proof", ledger, profiles,
    resources: [{ id: "app", kind: "compute", cores: q("cores", options.cores ?? 1, "cores"), concurrency: q("slots", options.slots ?? 1, "count"), queueCapacity: q("queue", options.queue ?? 100, "count"),
      cancellation: options.cancellation ?? "unsupported", profiles: { light: "synthetic.light", heavy: "synthetic.heavy" }, context: { labels: { software: "synthetic", environment: "verification-only" }, quantities: {} } }],
    operations: ["light", "heavy"].map((id) => ({ id, entry: "app", callerTimeout: q(`${id}.timeout`, options.timeout ?? 100000, "us"), onCallerStop: "detach", idempotency: "read-only" })),
    arrivals: [{ id: "load", kind: "periodic", operation: "light", start: q("start", 0, "us"), count: q("count", options.count ?? 10, "count"), interval: q("interval", options.interval ?? 200, "us") }],
    faults: [], horizon: q("horizon", options.horizon ?? 10000, "us"), sampleInterval: q("sample", options.sample ?? 1000, "us"),
    limits: { maxEvents: 1000000, maxSamples: 10000, maxRequests: Math.max(1000, options.count ?? 10), maxRawResults: options.raw ?? Math.max(1000, options.count ?? 10), maxTraceRows: 100000 } };
}
