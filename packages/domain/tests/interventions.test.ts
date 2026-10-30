import { expect, test } from "bun:test";
import { INTERVENTIONS, interventionError } from "../src/resource";
const request = { interventionId: "session-capacity", revision: 1, target: { resourceId: "db" }, parameters: { sessions: 0, duration: 1 } };
test("consumer outage is duration-only, timed and reversible for a background worker", () => {
  expect(INTERVENTIONS.find(d => d.id === "consumer-outage")).toMatchObject({revision: 1, targetKind: "Virtual Machine", mechanism: "async-worker", reversible: true, endPolicy: "timed"});
  const request = {interventionId: "consumer-outage", revision: 1, target: {resourceId: "worker"}, parameters: {duration: 1}};
  expect(interventionError(request)).toBeNull();
  expect(interventionError({...request, parameters: {duration: 300}}, {remainingSeconds: 300})).toBeNull();
  for (const duration of [0, -1, 0.5, 301, Infinity]) expect(interventionError({...request, parameters: {duration}})).toContain("BOUNDS");
  expect(interventionError(request, {remainingSeconds: 0})).toContain("BOUNDS");
  expect(interventionError({...request, parameters: {duration: 2}}, {remainingSeconds: 1})).toContain("BOUNDS");
  expect(interventionError({...request, revision: 2})).toContain("REVISION");
  expect(interventionError({...request, parameters: {duration: 1, available: true}})).toContain("PARAMETERS");
  expect(interventionError({...request, target: {edgeId: "poll", direction: "both"}})).toContain("TARGET");
});
test("capabilities round-trip as data and enforce product policy at contextual boundaries", () => {
  expect(JSON.parse(JSON.stringify(INTERVENTIONS))).toEqual(INTERVENTIONS);
  expect(INTERVENTIONS.map(d => d.id)).toEqual(["consumer-outage", "pool-reset", "deny-port", "session-capacity", "cpu-capacity", "flush", "delay", "bandwidth", "partition"]);
  expect(interventionError(request, { remainingSeconds: 1 })).toBeNull();
  for (const parameters of [{sessions: -1, duration: 1}, {sessions: 513, duration: 1}, {sessions: 0.5, duration: 1}, {sessions: Infinity, duration: 1}, {sessions: 0, duration: 301}, {sessions: 0}, {sessions: 0, duration: 1, extra: true}])
    expect(interventionError({...request, parameters}, {authoredBaseline: 512})).toContain("INTERVENTION_");
  expect(interventionError(request, {remainingSeconds: 0})).toContain("BOUNDS");
  expect(interventionError({...request, revision: 2})).toContain("REVISION");
  expect(interventionError({...request, target: {edgeId: "edge", direction: "both"}})).toContain("TARGET");
  // Session capacity can only be lowered from the authored limit: a real database needs a restart to raise max_connections.
  const sessions = (n: number) => ({...request, parameters: {sessions: n, duration: 1}});
  expect(interventionError(sessions(101), {authoredBaseline: 100, remainingSeconds: 10})).toContain("BOUNDS");
  expect(interventionError(sessions(100), {authoredBaseline: 100, remainingSeconds: 10})).toBeNull();
  expect(interventionError(sessions(0), {authoredBaseline: 100, remainingSeconds: 10})).toBeNull();
  const cpu = {...request, interventionId: "cpu-capacity", parameters: {cores: 2, duration: 1}};
  expect(interventionError(cpu, {authoredBaseline: 1})).toContain("BOUNDS");
  expect(interventionError(cpu, {authoredBaseline: 2})).toBeNull();
  expect(interventionError({interventionId: "flush", revision: 1, target: {resourceId: "cache"}, parameters: {}})).toBeNull();
});

test("deny-port policy declares one bounded TCP port and timed restore", () => {
  const d = INTERVENTIONS.find(d => d.id === "deny-port")!;
  expect(d).toMatchObject({revision: 1, targetKind: "Firewall", mechanism: "firewall", endPolicy: "timed"});
  const request = {interventionId: d.id, revision: 1, target: {resourceId: "firewall"}, parameters: {port: 1, duration: 1}};
  expect(interventionError(request)).toBeNull();
  expect(interventionError({...request, parameters: {port: 65535, duration: 300}})).toBeNull();
  for (const port of [0, 65536, 1.1, Infinity]) expect(interventionError({...request, parameters: {port, duration: 1}})).toContain("BOUNDS");
});

test("bandwidth has bounded bytes/s and revision refusal in the capability table", () => {
  const request = {interventionId: "bandwidth", revision: 1, target: {edgeId: "a", direction: "both"}, parameters: {bandwidth: 1, duration: 1}};
  expect(interventionError(request)).toBeNull();
  expect(interventionError({...request, parameters: {bandwidth: 1_000_000_000, duration: 1}})).toBeNull();
  for (const bandwidth of [0, -1, 1.5, 1_000_000_001, Infinity]) expect(interventionError({...request, parameters: {bandwidth, duration: 1}})).toContain("BOUNDS");
  expect(interventionError({...request, revision: 2})).toContain("REVISION");
});

test("pool reset is one-shot, parameterless and owns both pool directions", () => {
  const d = INTERVENTIONS.find(d => d.id === "pool-reset")!;
  expect(d).toMatchObject({revision: 1, targetKind: "edge", reversible: false, endPolicy: "one-shot", parameters: [], directions: ["both"]});
  const request = {interventionId: d.id, revision: 1, target: {edgeId: "edge", direction: "both"}, parameters: {}};
  expect(interventionError(request)).toBeNull();
  for (const direction of ["request", "response"]) expect(interventionError({...request, target: {...request.target, direction}})).toContain("TARGET");
  expect(interventionError({...request, parameters: {duration: 1}})).toContain("PARAMETERS");
  expect(interventionError({...request, revision: 2})).toContain("REVISION");
});
