import type { FirstStackSidecarV2, ResolvedSchedule } from "@infraforge/contracts/first-stack";
import { compileFirstStack, type FirstStackExecutionPolicy } from "./compiler";
import { validateFiniteIo, type FiniteIoProfile } from "../model2/data/io-contract";
import { canonical } from "../model2/product/provenance";

// A separate internal compiler revision. The public V2 sidecar remains unchanged
// and cannot opt into storage through an ignored field or a legacy profile.
export function compileFirstStackIo(sidecar: FirstStackSidecarV2, schedule: ResolvedSchedule, policy: FirstStackExecutionPolicy, storage: FiniteIoProfile) {
  const compiled = compileFirstStack(sidecar, schedule, policy);
  if (storage.identity.workload !== schedule.identity) throw Error("IO workload identity mismatch");
  compiled.input.workloadVersion = "m2e-pg/1";
  for (const r of compiled.input.resources) if (r.kind === "relational") r.semantics = "postgresql-keyed/1";
  validateFiniteIo(storage, compiled.input, compiled.composition);
  const db = sidecar.nodes.find(n => n.owner === "relational")!.id;
  for (const row of [...schedule.rows, { operation: sidecar.balancer.healthOperation, keys: sidecar.balancer.healthKeys }]) {
    if (!storage.bindings.some(b => b.role === db && b.operation === row.operation && JSON.stringify(b.keys) === JSON.stringify(row.keys))) throw Error("Missing recorded/health IO key binding");
  }
  // Retain full canonical content in the compile lock/run evidence. Quantities,
  // page mappings, schedule and omissions all participate in replay identity.
  compiled.composition.storage = canonical(JSON.parse(JSON.stringify(storage))) as FiniteIoProfile;
  return { ...compiled, revision: "first-stack-io-composition/1", compiler: "first-stack-io-compiler/1" };
}
