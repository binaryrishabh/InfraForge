import type { Quantity, Unit } from "../src/reality/quantity";
import type { RealityEntry } from "../src/reality/ledger";
import type { ProductContract, CompiledProduct, SavedProductDesign } from "../src/model2/product/contracts";
import { numericOrigins } from "../src/model2/product/origins";

export type SlowStudyFailure = "slow-sustained" | "slow-transient" | "slow-control" | "slow-response" | "slow-response-control";
export const isSlowStudy = (failure: string): failure is SlowStudyFailure => failure.startsWith("slow-");
export const isResponseStudy = (failure: SlowStudyFailure) => failure.startsWith("slow-response");

/** Explicit synthetic inputs, never a provider claim or a new canvas setting. */
function authored<U extends Unit>(ledger: RealityEntry[], id: string, value: number, unit: U): Quantity<U> {
  const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [id] };
  ledger.push({ id, concept: id, modelVersion: "2", scope: "Authored timeout retry experiment", validityDomain: "Synthetic experiment only; no physical calibration",
    quantity, formula: String(value), classification: "user-input", confidence: "conditional",
    provenance: [{ source: "packages/simulation/tests/retrySlowStudy.ts", supports: "implementation", detail: "Labelled analytical query cost/deadline or existing CPU-capacity fault input" }],
    assumptions: ["20 ms foreground statement CPU; capacity reduced to 0.1 cores only during the authored fault"], researchedOn: "2026-10-29", freeMode: "forbidden", replacement: "Measure application query demand before physical claims" });
  return quantity;
}
export function configureSlowDesign(design: SavedProductDesign, failure: SlowStudyFailure) {
  design.resources.find((r) => r.id === "db")!.skuId = "db.m5.xlarge"; // Four cores, 1,360 sessions: no session gate bottleneck.
  design.workload.targetThroughput = (isResponseStudy(failure) ? 20 : 100) * 60;
}
export function authorSlowQueries(contract: ProductContract, failure: SlowStudyFailure) {
  const db = contract.nodes.db!.resources.find((r) => r.config.kind === "relational")!.config;
  if (db.kind !== "relational") throw Error("Slow study requires the canvas relational database");
  for (const [operation, plan] of Object.entries(db.plans)) {
    if (operation !== "health") plan.statements[0]!.cpu = authored(contract.ledger, `study.${operation}.cpu`, 20000, "cpu-us");
    if (isResponseStudy(failure)) {
      plan.statementTimeout = authored(contract.ledger, `study.${operation}.statementTimeout`, 8000000, "us");
      plan.transactionTimeout = authored(contract.ledger, `study.${operation}.transactionTimeout`, 10000000, "us");
    }
  }
}
export function installSlowFault(compiled: CompiledProduct, contract: ProductContract, failure: SlowStudyFailure) {
  if (failure.endsWith("control")) return;
  // ProductContract/live actions cannot express a DB CPU fault. Use the EXISTING data-intervention input after compilation,
  // and retain its quantities/origins. This is a labelled test-only fault, not a supported canvas action.
  const input = compiled.input;
  input.dataInterventions.push({ id: "study-slow-db", kind: "cpu-capacity", target: "db",
    at: authored(input.ledger, "study.slow.at", 1000000, "us"),
    duration: authored(input.ledger, "study.slow.duration", failure === "slow-transient" ? 1200000 : 9000000, "us"),
    cores: authored(input.ledger, "study.slow.cores", 0.1, "cores") });
  compiled.semantic.numericOrigins = numericOrigins(input, compiled.pools, contract, compiled.crashes);
}
