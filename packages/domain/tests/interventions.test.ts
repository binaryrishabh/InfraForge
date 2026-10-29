import { expect, test } from "bun:test";
import { INTERVENTIONS, interventionError } from "../src/resource";
const request = { interventionId: "session-capacity", revision: 1, target: { resourceId: "db" }, parameters: { sessions: 0, duration: 1 } };
test("capabilities round-trip as data and enforce product policy at contextual boundaries", () => {
  expect(JSON.parse(JSON.stringify(INTERVENTIONS))).toEqual(INTERVENTIONS);
  expect(INTERVENTIONS.map(d => d.id)).toEqual(["session-capacity", "cpu-capacity", "flush", "delay", "partition"]);
  expect(interventionError(request, { remainingSeconds: 1 })).toBeNull();
  for (const parameters of [{sessions: -1, duration: 1}, {sessions: 513, duration: 1}, {sessions: 0.5, duration: 1}, {sessions: Infinity, duration: 1}, {sessions: 0, duration: 301}, {sessions: 0}, {sessions: 0, duration: 1, extra: true}])
    expect(interventionError({...request, parameters})).toContain("INTERVENTION_");
  expect(interventionError(request, {remainingSeconds: 0})).toContain("BOUNDS");
  expect(interventionError({...request, revision: 2})).toContain("REVISION");
  expect(interventionError({...request, target: {edgeId: "edge", direction: "both"}})).toContain("TARGET");
  const cpu = {...request, interventionId: "cpu-capacity", parameters: {cores: 2, duration: 1}};
  expect(interventionError(cpu, {authoredBaseline: 1})).toContain("BOUNDS");
  expect(interventionError(cpu, {authoredBaseline: 2})).toBeNull();
  expect(interventionError({interventionId: "flush", revision: 1, target: {resourceId: "cache"}, parameters: {}})).toBeNull();
});
