import { expect, test } from "bun:test";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { resolveWorkload } from "@infraforge/domain/workload";
import type { ActionRequest } from "@infraforge/contracts/actions";
import type { Resource } from "@infraforge/domain/resource";
import type { RunAction as StoredAction } from "../lib/generated/prisma/client";
import type { SimulationInstance } from "../simulator/instance";
import { applyAction } from "../simulator/actionApplication";
import { actionCompletion } from "../simulator/actionCompletion";
import { actionDto } from "../actions/contract";

const engine = () => createModel2Run({resources: [{id: "app", type: "Virtual Machine", x: 0, y: 0}, {id: "db", type: "Database", x: 1, y: 0}, {id: "cache", type: "Cache", x: 1, y: 1}, {id: "firewall", type: "Firewall", x: 2, y: 0}] as Resource[],
  connectionLines: [{id: "db-edge", sourceId: "app", targetId: "db", sourceType: "Virtual Machine", targetType: "Database", port: 5432}, {id: "cache-edge", sourceId: "app", targetId: "cache", sourceType: "Virtual Machine", targetType: "Cache", port: 6379}, {id: "policy", sourceId: "firewall", targetId: "db", sourceType: "Firewall", targetType: "Database", port: 5432}],
  workloadProfile: resolveWorkload({targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 1, payloadSize: "light"}), seed: "action-proof"}, 6);

for (const kind of ["session-capacity", "flush", "deny-port", "pool-reset"]) test(`intervention completion DTO correlates exact timing and real engine effect, kind=${kind}`, () => {
  const flush = kind === "flush", reset = kind === "pool-reset", oneShot = flush || reset;
  const model2 = engine(), instance = {model2, actions: new Map(), pendingLogs: []} as unknown as SimulationInstance;
  const request: ActionRequest = {kind: "intervention" as const, parameters: {interventionId: kind, revision: 1, target: reset ? {edgeId: "db-edge", direction: "both"} : {resourceId: flush ? "cache" : kind === "deny-port" ? "firewall" : "db"}, parameters: oneShot ? {} : kind === "deny-port" ? {port: 5432, duration: 2} : {sessions: 0, duration: 2}}};
  const applied = applyAction(instance, "durable-1", request);
  expect(applied.status).toBe("running");
  const running = instance.actions.get("durable-1")!;
  expect(actionCompletion(instance, running)).toBeNull();
  if (!oneShot) { model2.advance(); model2.advance(); expect(actionCompletion(instance, running)).toBeNull(); }
  model2.advance();
  const done = actionCompletion(instance, running)!;
  expect(done).toMatchObject({status: "completed", outcome: {interventionEnded: true}});
  expect(model2.evidence().product.interventions![0]!.phase).toBe("completed");
  if (flush) expect(model2.evidence().data.caches[0]!.epoch).toBe(1);
  else if (reset) { expect(model2.view().activeChaos).toEqual([]); expect(model2.evidence().network.poolResets!.rows).toHaveLength(1); }
  else if (kind === "deny-port") expect(model2.evidence().systems.security.policies[0]!.generation).toBe(3);
  else expect(model2.evidence().data.databases[0]!.sessions.limit).toBe(100);
  const at = new Date(), row = {id: "durable-1", deploymentId: "run", sequence: 1, ...request, status: "completed", requestedAt: at, appliedAt: at, completedAt: at,
    appliedSimulatedSeconds: 0, completedSimulatedSeconds: model2.simulatedSeconds, outcome: done.outcome, failureReason: null} as unknown as StoredAction;
  expect(actionDto(row).outcome?.intervention).toEqual(applied.outcome.intervention);
  expect(() => actionDto({...row, completedSimulatedSeconds: 0})).toThrow("precedes");
  expect(() => actionDto({...row, outcome: {...done.outcome, intervention: {...done.outcome.intervention!, revision: 2}}} as unknown as StoredAction)).toThrow();
});
