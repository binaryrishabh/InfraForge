import { expect, test } from "bun:test";
import { createInitialState, tick } from "../src/engine";
import type { Resource } from "@infraforge/domain/resource";

const resources: Resource[] = ["a", "b", "c"].map((id) => ({ id, type: "DNS", x: 0, y: 0 }));
function series(order: Resource[]) {
  let state = createInitialState("jitter-proof", order, [], { targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "medium" }, 123);
  // Zero slider load isolates random consumption from changed traffic distribution.
  state.loadFraction = 0; state.targetLoadFraction = 0;
  const values: Record<string, string[]> = {};
  for (let i = 0; i < 20; i++) { state = tick(state, {}).state;
    for (const [id, m] of Object.entries(state.metrics)) (values[id] ??= []).push(JSON.stringify([m.cpu, m.memory])); }
  return values;
}
test("model 1 preserves shared starting jitter positions when appending and shifts only displaced resources", () => {
  const base = series(resources);
  const append = series([...resources, { id: "d", type: "DNS", x: 0, y: 0 }]);
  for (const id of ["a", "b", "c"]) expect(append[id]).toEqual(base[id]);
  const remove = series([resources[0]!, resources[2]!]);
  expect(remove.a).toEqual(base.a); expect(remove.c).not.toEqual(base.c);
  const reorder = series([resources[2]!, resources[1]!, resources[0]!]);
  expect(reorder.b).toEqual(base.b); expect(reorder.a).not.toEqual(base.a); expect(reorder.c).not.toEqual(base.c);
  const insert = series([resources[0]!, { id: "d", type: "DNS", x: 0, y: 0 }, ...resources.slice(1)]);
  expect(insert.a).toEqual(base.a); expect(insert.b).not.toEqual(base.b); expect(insert.c).not.toEqual(base.c);
});

test("model 1 connection order selects the autoscaling template despite aligned starting-resource jitter", () => {
  const nodes: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 3, targetCpu: 5 } },
    { id: "a", type: "Virtual Machine", skuId: "m5.large", x: 0, y: 0 },
    { id: "b", type: "Virtual Machine", skuId: "m5.xlarge", x: 0, y: 0 },
  ];
  const connections = ["a", "b"].map((id) => ({ id: `lb-${id}`, sourceId: "lb", targetId: id, sourceType: "Load Balancer" as const, targetType: "Virtual Machine" as const, port: 80 }));
  const simulate = (reverse: boolean) => {
    let state = createInitialState("connection-order-proof", nodes, reverse ? [...connections].reverse() : connections,
      { targetThroughput: 600000, throughputUnit: "per-minute", trafficShape: "steady", payloadSize: "medium" }, 123);
    for (let i = 0; i < 120; i++) state = tick(state, {}).state;
    return state;
  };
  const a = simulate(false), b = simulate(true);
  expect(a.pools.lb!.baseVmIds).toEqual(["a", "b"]);
  expect(b.pools.lb!.baseVmIds).toEqual(["b", "a"]);
  expect(a.resourceSkus["a-asg-1"]?.skuId).toBe("m5.large");
  expect(b.resourceSkus["b-asg-1"]?.skuId).toBe("m5.xlarge");
});
