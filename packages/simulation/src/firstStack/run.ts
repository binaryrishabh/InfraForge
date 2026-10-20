import type { FirstStackSidecarV2, ResolvedSchedule } from "@infraforge/contracts/first-stack";
import { createStackComposition } from "../model2/composition/run";
import { manifest } from "../model2/composition/registry";
import type { CausalObserver } from "../model2/workload/causal";
import { diagnosticJournal } from "./journal";
import { FIRST_STACK_ENVELOPE } from "./bounds";
import { compileFirstStack, refuse, type FirstStackExecutionPolicy } from "./compiler";

// Internal in-process qualification path only. No product dispatcher or HTTP
// executor uses this runner; public isolation/admission are separate stages.
export function createFirstStackRuntime(sidecar: FirstStackSidecarV2, schedule: ResolvedSchedule, policy: FirstStackExecutionPolicy, causal?: CausalObserver) {
  const compiled = compileFirstStack(sidecar, schedule, policy);
  const journal = diagnosticJournal();
  const observer: CausalObserver = event => { journal.record(event); causal?.(event); };
  const rows = new Map(schedule.rows.map(r => [r.id, r]));
  const lb = sidecar.caller.entry, apps = new Set(sidecar.nodes.filter(n => n.owner === "compute").map(n => n.id));
  const db = sidecar.nodes.find(n => n.owner === "relational")!.id;
  const runtime = createStackComposition(compiled.input, { ...compiled.composition, causal: observer, plugins: [{
    manifest: manifest("first-stack-recorded-input", "first-stack-recorded-input/2"),
    validate() { if (rows.size !== schedule.rows.length) refuse("rows", "Duplicate recorded row IDs."); },
    instantiate() {
      return {
        receive(target, work, _done, next) {
          if (target === lb || apps.has(target)) {
            const identity: unknown = JSON.parse(work.rootId);
            if (!Array.isArray(identity)) refuse("work.rootId", "Malformed identified work.");
            if (identity[0] === "root" && identity[1] === "recorded") {
              const row = rows.get(identity[2]);
              if (!row || row.operation !== work.operation) refuse("work.rootId", "No exact recorded row/operation binding; key fallback is forbidden.");
              if (target === lb) work.message = { request: { kind: "first-stack-keyed/2", plan: row.plan, keys: [...row.keys], ...(row.keys.length === 1 ? { key: row.keys[0] } : {}) } };
              else if (!work.message) refuse("application", "Recorded input was lost between entry and application; child transport must preserve the exact message.");
            } else if (identity[0] === "health" && work.operation === sidecar.balancer.healthOperation) {
              work.message = { request: { kind: "first-stack-keyed/2", keys: [...sidecar.balancer.healthKeys],
                ...(sidecar.balancer.healthKeys.length === 1 ? { key: sidecar.balancer.healthKeys[0] } : {}) } };
            } else refuse("work.rootId", "Unsupported work origin; supply recorded foreground or explicit DB-backed health work.");
          }
          if (target === db && !work.message) refuse("database", "Missing exact application input; no cycle/uniform fallback.");
          return next();
        },
        measure: () => ({ revision: "first-stack-recorded-input/2", rows: rows.size, health: "explicit DB-backed read" }),
      };
    },
  }] });
  return { horizon: runtime.horizon, advanceTo: runtime.advanceTo, advanceSlice: runtime.advanceSlice, journal, evidence() {
    return { ...runtime.evidence(), firstStack: { envelope: FIRST_STACK_ENVELOPE.revision, compiler: sidecar.compiler, composition: compiled.revision,
      workload: schedule.identity, executedSchedule: schedule.executedScheduleHash, profile: schedule.profileHash,
      recordingOrigin: schedule.header.origin, demand: schedule.application,
      timing: "assumption-only", counting: "supported-logical", fullMemory: "Unknown", fullCost: "Unknown", activeEngine: "1" } };
  } };
}
