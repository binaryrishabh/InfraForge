import type { RealityEntry } from "../reality/ledger";

function unknown(id: string, concept: string, unit: "bytes" | "USD", reason: string): RealityEntry {
  return { id, concept, modelVersion: "2", scope: "M2A internal proof", quantity: { kind: "unknown", unit, provenance: [id], reason },
    formula: "Unknown; no substitution with zero", classification: "unknown", confidence: "unknown",
    provenance: [{ source: "packages/simulation/src/model2/provenance.ts", supports: "implementation", detail: reason }],
    assumptions: ["This mechanism is outside the implemented proof."], researchedOn: "2026-10-15", freeMode: "forbidden",
    replacement: unit === "bytes" ? "Explicit allocations, working sets and lifecycle model" : "Dated provider/service/region tariff and complete usage dimensions" };
}
export const FOUNDATION_LEDGER = [
  unknown("m2.unmodeled-memory", "Working-set/allocation usage", "bytes", "No memory mechanism implemented"),
  unknown("m2.unpriced", "Complete monetary cost", "USD", "No provider tariff supplied"),
];
export const METRIC_DEFINITIONS = {
  at: { unit: "us", formula: "Scheduled observation boundary in integer virtual time" },
  queued: { unit: "count", formula: "FIFO waiting calls, excluding active calls" },
  active: { unit: "count", formula: "Admitted calls holding a configured worker/connection slot" },
  waitingOnDependency: { unit: "count", formula: "Active calls whose own service finished and whose child has not returned" },
  connections: { unit: "count", formula: "Database station active calls; other resource kinds return null (not modeled)" },
  cpuConsumedUs: { unit: "cpu-us", formula: "Integrated running CPU core share, capped by each call's configured CPU demand; excludes I/O/dependency/pause time" },
  completed: { unit: "count", formula: "Successful returns recorded through this boundary" },
  rejected: { unit: "count", formula: "Local rejection, failed dependency returns or cancelled admitted/waiting calls" },
  latencyUs: { unit: "us", formula: "Terminal outcome time minus external arrival time; model-specific, not production latency" },
  status: { unit: "categorical", formula: "Unavailable while paused; backpressured with queued work; otherwise Healthy for this station only" },
} as const;
