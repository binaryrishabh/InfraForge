import { interventionError, type InterventionRequest } from "@infraforge/domain/resource";
import type { RealityEntry } from "../../reality/ledger";
import type { Quantity, Unit } from "../../reality/quantity";
import type { ProductContract } from "./contracts";

// What a person did during a live run, each at the simulated microsecond it was applied.
// A live run is its design plus this timeline: rebuilding it with a new action at time T
// leaves everything before T exactly as it was, because Model 2 is deterministic.
export type TimedAction = { id: string; atUs: number } & (
  | { kind: "intervention"; request: InterventionRequest }
  | { kind: "load"; fraction: number }
  | { kind: "crash"; node: string; durationUs: number; restartUs: number }
  | { kind: "cpu-spike"; node: string; durationUs: number; coreUs: number; cores: number }
  | { kind: "network-delay"; links: string[]; durationUs: number; delayUs: number }
  | { kind: "replicas"; node: string; desired: number });

export function withTimeline(base: ProductContract, actions: TimedAction[]): ProductContract {
  const contract = JSON.parse(JSON.stringify(base)) as ProductContract;
  const ids = new Set<string>();
  const known = <U extends Unit>(action: TimedAction, name: string, value: number, unit: U): Quantity<U> => {
    const id = `action.${action.id}.${name}`;
    contract.ledger.push({ id, concept: `live action ${action.kind} ${name}`, modelVersion: "2", scope: "One live run", validityDomain: "This run only",
      quantity: { kind: "known", value, unit, provenance: [id] }, formula: String(value), classification: "user-input", confidence: "high",
      provenance: [{ source: `run action ${action.id}`, supports: "exact", detail: `Applied by the person at ${action.atUs} us` }],
      assumptions: ["The person applied this action during the run"], researchedOn: "2026-10-28", freeMode: "allowed", replacement: "None: the person chose this action" } satisfies RealityEntry);
    return { kind: "known", value, unit, provenance: [id] };
  };
  for (const action of [...actions].sort((a, b) => a.atUs - b.atUs || (a.id < b.id ? -1 : 1))) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(action.id) || ids.has(action.id) || !Number.isSafeInteger(action.atUs) || action.atUs < 0) throw Error("Each action needs a unique simple id and a whole-microsecond time");
    ids.add(action.id);
    const at = known(action, "at", action.atUs, "us");
    if (action.kind === "intervention") {
      const error = interventionError(action.request);
      if (error) throw Error(error);
      (contract.interventions ??= []).push({id: action.id, atUs: action.atUs, request: action.request});
    }
    else if (action.kind === "load") (contract.arrival.changes ??= []).push({ at, fraction: known(action, "fraction", action.fraction, "ratio") });
    else if (action.kind === "crash") contract.faults.push({ id: action.id, kind: "Crash", target: action.node, at, duration: known(action, "duration", action.durationUs, "us"),
      restart: known(action, "restart", action.restartUs, "us"), profile: "retain-logical-state/1" });
    else if (action.kind === "cpu-spike") contract.faults.push({ id: action.id, kind: "CpuSpike", target: action.node, at, duration: known(action, "duration", action.durationUs, "us"),
      cpu: known(action, "cpu", action.coreUs, "cpu-us"), parallelism: known(action, "parallelism", action.cores, "cores") });
    else if (action.kind === "network-delay") contract.faults.push({ id: action.id, kind: "NetworkDelay", target: action.links[0] ?? "", scope: action.links, at,
      duration: known(action, "duration", action.durationUs, "us"), delay: known(action, "delay", action.delayUs, "us") });
    else {
      const controller = contract.nodes[action.node]?.controller;
      if (!controller) throw Error(`${action.node} has no replica pool to scale`);
      controller.manual.push({ id: action.id, at, desired: known(action, "desired", action.desired, "count") });
    }
  }
  return contract;
}
