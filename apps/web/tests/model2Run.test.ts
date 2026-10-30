import { expect, test } from "bun:test";
import { DEFAULT_RETRY_SETTINGS, RESOURCE_TYPES as T, DeploymentChaosNames, type Resource } from "@infraforge/domain/resource";
import { resolveWorkload } from "@infraforge/domain/workload";
import { compileScenario, dueScenarioSteps, createModel2Run } from "@infraforge/simulation/model2-run";
import type { ChallengeScenario } from "@infraforge/contracts/challenges";
import { buildModel2Contract, buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { createRunHost } from "../src/features/model2Run/worker/host";
import type { FromWorker, RunStart } from "../src/features/model2Run/protocol";

const at = (id: string, type: Resource["type"], x: number): Resource => ({ id, type, x, y: 0 });
const line = (sourceId: string, targetId: string, sourceType: string, targetType: string) =>
  ({ id: `${sourceId}-${targetId}`, sourceId, targetId, sourceType, targetType, port: 443 });
const start = (overrides: Partial<RunStart> = {}): RunStart => ({
  input: {
    resources: [at("lb", T.LoadBalancer, 0), at("app-1", T.VirtualMachine, 1), at("app-2", T.VirtualMachine, 1), at("db", T.Database, 2)],
    connectionLines: [line("lb", "app-1", T.LoadBalancer, T.VirtualMachine), line("lb", "app-2", T.LoadBalancer, T.VirtualMachine),
      line("app-1", "db", T.VirtualMachine, T.Database), line("app-2", "db", T.VirtualMachine, T.Database)],
    workloadProfile: resolveWorkload({ targetThroughput: 6000, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" }),
    seed: "web-test",
  },
  horizonSeconds: 20, stopAtSecond: 20, speed: 1, ...overrides,
});
// A manual clock: each queued step runs only when the test says so.
function harness(overrides: Partial<RunStart> = {}) {
  const messages: FromWorker[] = [], queue: Array<() => void> = [];
  const host = createRunHost((m) => messages.push(m), { set: (run) => { queue.push(run); return queue.length; }, clear: () => { queue.length = 0; } });
  host.handle({ type: "start", start: start(overrides) });
  const tick = (n = 1) => { for (let i = 0; i < n && queue.length; i++) queue.shift()!(); };
  return { host, messages, tick, seconds: () => messages.filter((m) => m.type === "second") as Array<Extract<FromWorker, { type: "second" }>> };
}

test("the browser run posts the live view every simulated second and stops at its stop second", () => {
  const h = harness({ stopAtSecond: 5 });
  h.tick(10);
  expect(h.seconds().every(second => !Object.hasOwn(second, "applicationFlow"))).toBe(true);
  expect(h.seconds().map((s) => s.view.simulatedSeconds)).toEqual([1, 2, 3, 4, 5]);
  expect(h.seconds().at(-1)!.view.traffic.completedRps).toBeGreaterThan(90);
  expect(h.seconds().at(-1)!.view.metrics.lb!.cpu).toBeNull();
  expect(h.messages.at(-1)).toEqual({ type: "done", submission: { stopAtSecond: 5, actions: [] } });
});

test("accepted actions are recorded with their second for the server replay; refusals are not", () => {
  const h = harness();
  h.tick(3);
  h.host.handle({ type: "action", id: "1", request: { kind: "load", parameters: { targetLoadFraction: 1.5 } } });
  h.host.handle({ type: "action", id: "2", request: { kind: "chaos", parameters: { type: DeploymentChaosNames.MemoryLeak, resourceId: "app-1" } } });
  h.tick(2);
  h.host.handle({ type: "action", id: "3", request: { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "app-2" } } });
  h.host.handle({ type: "stop" });
  const results = h.messages.filter((m) => m.type === "action");
  expect(results.map((m) => [m.id, m.ok])).toEqual([["1", true], ["2", false], ["3", true]]);
  expect(h.messages.at(-1)).toEqual({ type: "done", submission: { stopAtSecond: 5, actions: [
    { atSecond: 3, request: { kind: "load", parameters: { targetLoadFraction: 1.5 } } },
    { atSecond: 5, request: { kind: "chaos", parameters: { type: DeploymentChaosNames.Crash, resourceId: "app-2" } } }] } });
});

test("a challenge's scheduled fault is applied right after its second; speed 0 pauses", () => {
  const h = harness({ experiment: { fault: DeploymentChaosNames.Crash, resourceId: "app-1", atSimulatedSecond: 2 }, stopAtSecond: 8 });
  h.tick(3);
  expect(h.seconds().at(-1)!.view.activeChaos).toEqual([{ chaosType: DeploymentChaosNames.Crash, resourceId: "app-1", durationTicks: 30, remainingTicks: 29 }]);
  h.host.handle({ type: "speed", speed: 0 });
  h.tick(5);
  const paused = h.seconds().length;
  h.tick(5);
  expect(h.seconds().length).toBe(paused);
  h.host.handle({ type: "speed", speed: 10 });
  h.tick(20);
  expect(h.messages.at(-1)!.type).toBe("done"); // the scheduled fault is not a user action: the server inserts it itself
  expect((h.messages.at(-1) as Extract<FromWorker, { type: "done" }>).submission.actions).toEqual([]);
});

for (const historical of [true, false]) test(`worker startup and server replay preserve captured profiles, historical=${historical}`, () => {
  const input = start().input;
  input.resources[0]!.retry = {...DEFAULT_RETRY_SETTINGS, retryOn: ["connectionFailure", "timeout", "backendFailure"]};
  if (!historical) input.adapterProfiles = ["failure-cause/1"];
  const wireInput = JSON.parse(JSON.stringify(input)) as RunStart["input"];
  const h = harness({input: wireInput, horizonSeconds: 5, stopAtSecond: 5});
  const built = buildContractFromRunInputs(wireInput, 5);
  if ("refused" in built) throw Error(JSON.stringify(built));
  expect(built.contract.failureCauseProfile).toBe(historical ? undefined : "failure-cause/1");
  const server = createModel2Run(wireInput, 5, (...args) => {
    const result = buildModel2Contract(...args); expect(result).toEqual(built); return result;
  });
  for (let second = 1; second <= 5; second++) {
    if (second === 3) {
      const request = {kind: "chaos" as const, parameters: {type: DeploymentChaosNames.Crash, resourceId: "app-1"}};
      h.host.handle({type: "action", id: "crash", request}); server.apply(request);
    }
    h.tick(); const logs = server.advance();
    expect(h.seconds().at(-1)!.view).toEqual(server.view());
    const stable = (rows: typeof logs) => rows.map(row => ({...row, timestamp: ""}));
    expect(stable(h.seconds().at(-1)!.logs)).toEqual(stable(logs));
  }
  expect(h.messages.at(-1)!.type).toBe("done");
});

test("versioned worker actions replay in same-second order with identical quantities, every second and final evidence", () => {
  const setup = start({horizonSeconds: 10, stopAtSecond: 10});
  setup.input.resources.push(at("cache", T.Cache, 2));
  setup.input.connectionLines.push(line("app-1", "cache", T.VirtualMachine, T.Cache), line("app-2", "cache", T.VirtualMachine, T.Cache));
  const h = harness(setup), server = createModel2Run(JSON.parse(JSON.stringify(setup.input)), 10);
  const action = (interventionId: string, parameters: Record<string, number>, target: {resourceId: string} | {edgeId: string; direction: "request" | "response" | "both"} = {resourceId: "db"}) => ({kind: "intervention" as const, parameters: {interventionId, revision: 1, target, parameters}});
  const schedule = new Map<number, Array<Parameters<typeof server.apply>[0]>>([
    [0, [action("session-capacity", {sessions: 0, duration: 1}), {kind: "load", parameters: {targetLoadFraction: 1.2}}]],
    [2, [action("cpu-capacity", {cores: 0, duration: 1}), action("flush", {}, {resourceId: "cache"})]],
    [4, [action("delay", {delay: 1000, duration: 1}, {edgeId: "app-1-db", direction: "response"})]],
    [6, [action("partition", {duration: 1}, {edgeId: "app-2-db", direction: "request"})]],
    [8, [action("bandwidth", {bandwidth: 100_000, duration: 1}, {edgeId: "app-1-db", direction: "both"})]],
  ]);
  const submitted: Array<{atSecond: number; request: Parameters<typeof server.apply>[0]}> = [];
  for (let second = 0; second < 10; second++) {
    for (const request of schedule.get(second) ?? []) {
      h.host.handle({type: "action", id: String(submitted.length), request});
      server.apply(request); submitted.push({atSecond: second, request});
    }
    h.tick(); server.advance();
    expect(h.seconds().at(-1)!.view).toEqual(server.view());
    expect(h.host.actions()).toEqual(server.actions);
    if (second === 0) expect(server.view().activeChaos.filter(c => c.resourceId === "db")).toMatchObject([{resourceId: "db", intervention: {label: "Session capacity", parameters: {sessions: 0, duration: 1}, restoreAtUs: 1_000_001}}]);
    if (second === 1) expect(server.view().activeChaos).toEqual([]);
  }
  const done = h.messages.at(-1) as Extract<FromWorker, {type: "done"}>;
  expect(done).toEqual({type: "done", submission: {stopAtSecond: 10, actions: submitted}});
  expect(h.host.evidence()).toEqual(server.evidence());
  // Reconstruct from the serialized submission, as a later server worker does.
  const replay = createModel2Run(setup.input, 10), wire = JSON.parse(JSON.stringify(done.submission)) as typeof done.submission;
  let cursor = 0;
  for (let second = 0; second < 10; second++) {
    while (wire.actions[cursor]?.atSecond === second) replay.apply(wire.actions[cursor++]!.request);
    replay.advance(); expect(replay.view()).toEqual(h.seconds()[second]!.view);
  }
  expect(replay.actions).toEqual(server.actions);
  expect(replay.evidence()).toEqual(h.host.evidence()!);
  expect(replay.evidence().product.interventions).toHaveLength(6);
  expect(h.seconds().some(s => s.logs.some(log => log.message.includes("Flush cache applied at 2000001 us") && log.message.includes("one-shot")))).toBe(true);
});

test("a challenge worker refuses a free intervention before recording or changing its run", () => {
  const h = harness({experiment: {fault: DeploymentChaosNames.Crash, resourceId: "app-1", atSimulatedSecond: 2}});
  const before = h.host.evidence();
  h.host.handle({type: "action", id: "spoof", request: {kind: "intervention", parameters: {interventionId: "session-capacity", revision: 1, target: {resourceId: "db"}, parameters: {sessions: 0, duration: 1}}}});
  expect(h.messages.at(-1)).toMatchObject({type: "action", id: "spoof", ok: false});
  expect(h.host.actions()).toEqual([]); expect(h.host.evidence()).toEqual(before);
});

test("scripted browser steps and official reconstruction have identical per-second and final evidence", () => {
  const scenario: ChallengeScenario = {version: 1, visibility: "revealed", steps: [
    {id: "cpu", atSecond: 2, request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "db"}, parameters: {cores: 0.02, duration: 2}}},
    {id: "sessions", atSecond: 2, request: {interventionId: "session-capacity", revision: 1, target: {resourceId: "db"}, parameters: {sessions: 4, duration: 2}}},
    {id: "edge", atSecond: 5, request: {interventionId: "delay", revision: 1, target: {edgeId: "app-1-db", direction: "request"}, parameters: {delay: 1000, duration: 1}}},
  ]};
  const setup = start({challengeId: "scenario", scenario, horizonSeconds: 7, stopAtSecond: 7, speed: 60});
  const expected = compileScenario(scenario, setup.input, 7), h = harness(setup), server = createModel2Run(structuredClone(setup.input), 7);
  let next = 0;
  for (let second = 1; second <= 7; second++) {
    h.tick(); server.advance();
    for (const step of dueScenarioSteps(scenario, next, second)) {server.apply({kind: "intervention", parameters: step.request}); next++;}
    expect(h.seconds().at(-1)!.view).toEqual(server.view());
    expect(h.host.actions()).toEqual(server.actions);
  }
  expect(h.host.evidence()).toEqual(server.evidence());
  expect(server.evidence().product.interventions?.map(({phase, ...receipt}) => {expect(phase).toBe("completed"); return receipt;})).toEqual(expected);
  expect(h.messages.at(-1)).toEqual({type: "done", submission: {stopAtSecond: 7, actions: []}});
  expect(h.seconds().flatMap(s => s.logs).filter(l => l.message.startsWith("Scenario step applied:")).map(l => l.message)).toEqual([
    "Scenario step applied: cpu at second 2.", "Scenario step applied: sessions at second 2.", "Scenario step applied: edge at second 5.",
  ]);
});

test("design-only challenges also refuse ad-hoc actions and invalid scripts fail before the first tick", () => {
  const h = harness({challengeId: "design-only"});
  h.host.handle({type: "action", id: "ad-hoc", request: {kind: "load", parameters: {targetLoadFraction: 2}}});
  expect(h.messages.at(-1)).toMatchObject({type: "action", id: "ad-hoc", ok: false});
  expect(h.host.actions()).toEqual([]);
  const invalid = harness({scenario: {version: 1, visibility: "revealed", steps: [{id: "missing", atSecond: 2,
    request: {interventionId: "cpu-capacity", revision: 1, target: {resourceId: "missing"}, parameters: {cores: 0.01, duration: 1}}}]}});
  invalid.tick(5);
  expect(invalid.messages.at(-1)?.type).toBe("error"); expect(invalid.seconds()).toEqual([]);
});

test("versioned same-second ordering survives the tenth accepted action", () => {
  const h = harness({horizonSeconds: 4, stopAtSecond: 4}), server = createModel2Run(start().input, 4);
  const first = {kind: "intervention" as const, parameters: {interventionId: "session-capacity", revision: 1, target: {resourceId: "db"}, parameters: {sessions: 0, duration: 1}}};
  h.host.handle({type: "action", id: "first", request: first}); server.apply(first);
  for (let n = 1; n <= 11; n++) {
    const request = {kind: "load" as const, parameters: {targetLoadFraction: n / 10}};
    h.host.handle({type: "action", id: String(n), request}); server.apply(request);
  }
  h.tick(4); for (let n = 0; n < 4; n++) server.advance();
  expect(h.host.actions()).toEqual(server.actions);
  expect(h.host.evidence()).toEqual(server.evidence());
  const changes = server.evidence().provenance.ledger.filter(r => r.concept.includes("live action load fraction"));
  expect(changes.map(r => r.quantity.kind === "known" ? r.quantity.value : null)).toHaveLength(11);
  expect(server.evidence().counts.offered).toBeGreaterThan(400);
  expect(server.evidence().counts.offered).toBeLessThan(450); // Final target 1.1, never lexical a9's 0.8.
});

for (const port of [443, 5432]) test(`deny-port worker messages and serialized replay retain port-specific active state and complete evidence, port=${port}`, () => {
  const setup = start({horizonSeconds: 6, stopAtSecond: 6});
  setup.input.resources.push(at("firewall", T.Firewall, 2));
  setup.input.connectionLines.push(line("firewall", "db", T.Firewall, T.Database));
  for (const edge of setup.input.connectionLines) if (edge.targetId === "db") edge.port = 5432;
  const h = harness(setup);
  h.tick();
  const request = {kind: "intervention" as const, parameters: {interventionId: "deny-port", revision: 1, target: {resourceId: "firewall"}, parameters: {port, duration: 2}}};
  for (const parameters of [{port: 0, duration: 2}, {port: 65536, duration: 2}, {port: 1.5, duration: 2}]) {
    h.host.handle({type: "action", id: "bad", request: {...request, parameters: {...request.parameters, parameters}}});
    expect(h.messages.at(-1)).toMatchObject({type: "action", ok: false});
  }
  h.host.handle({type: "action", id: "revision", request: {...request, parameters: {...request.parameters, revision: 2}}});
  expect(h.messages.at(-1)).toMatchObject({type: "action", ok: false});
  h.host.handle({type: "action", id: "deny", request});
  expect(h.messages.at(-1)).toMatchObject({type: "action", ok: true});
  h.tick(5);
  const seconds = h.seconds();
  expect(seconds[1]!.view.activeChaos.find(c => c.resourceId === "firewall")!.intervention).toMatchObject({label: "Deny TCP port", parameters: {port, duration: 2}, restoreAtUs: 3_000_001});
  expect(seconds[2]!.view.activeChaos.length).toBeGreaterThan(0);
  const active = seconds[1]!.view.activeChaos;
  expect(active.map(c => c.resourceId).sort()).toEqual(port === 5432 ? ["app-1", "app-2", "db", "firewall"] : ["firewall"]);
  expect(active.flatMap(c => c.intervention?.edgeIds ?? [])).toEqual(port === 5432 ? Array.from({length: 4}, () => ["app-1-db", "app-2-db"]).flat() : []);
  expect(h.host.evidence()!.product.interventions![0]!.affectedPaths).toEqual(port === 5432 ? ["app-1-db:app-1:db", "app-2-db:app-2:db"] : []);
  expect(seconds[3]!.view.activeChaos).toEqual([]);
  const done = h.messages.at(-1) as Extract<FromWorker, {type: "done"}>;
  const wire = JSON.parse(JSON.stringify(done.submission)) as typeof done.submission;
  expect(wire.actions).toEqual([{atSecond: 1, request}]);
  const replay = createModel2Run(JSON.parse(JSON.stringify(setup.input)), 6);
  for (let second = 0; second < 6; second++) {
    for (const action of wire.actions.filter(a => a.atSecond === second)) replay.apply(action.request);
    replay.advance(); expect(replay.view()).toEqual(seconds[second]!.view);
  }
  expect(replay.evidence()).toEqual(h.host.evidence()!);
});

test("worker refuses unsupported bandwidth bounds and revisions before recording", () => {
  const h = harness();
  const parameters = {interventionId: "bandwidth", revision: 1, target: {edgeId: "app-1-db", direction: "both" as const}, parameters: {bandwidth: 0, duration: 1}};
  const before = h.host.evidence();
  for (const value of [parameters, {...parameters, revision: 2, parameters: {bandwidth: 1000, duration: 1}}]) {
    h.host.handle({type: "action", id: "bad", request: {kind: "intervention", parameters: value}});
    expect(h.messages.at(-1)).toMatchObject({type: "action", ok: false});
  }
  expect(h.host.actions()).toEqual([]); expect(h.host.evidence()).toEqual(before);
});

test("pool-reset worker refuses invalid intent and matches complete serialized server evidence", () => {
  const setup = start({horizonSeconds: 4, stopAtSecond: 4}), h = harness(setup);
  h.tick();
  const request = {kind: "intervention" as const, parameters: {interventionId: "pool-reset", revision: 1, target: {edgeId: "app-1-db", direction: "both" as const}, parameters: {}}};
  const before = h.host.evidence();
  for (const parameters of [{...request.parameters, revision: 2}, {...request.parameters, parameters: {duration: 1}}, {...request.parameters, target: {edgeId: "app-1-db", direction: "request" as const}}]) {
    h.host.handle({type: "action", id: "bad", request: {...request, parameters}});
    expect(h.messages.at(-1)).toMatchObject({type: "action", ok: false});
  }
  expect(h.host.actions()).toEqual([]); expect(h.host.evidence()).toEqual(before);
  h.host.handle({type: "action", id: "reset", request});
  expect(h.messages.at(-1)).toMatchObject({type: "action", ok: true, outcome: {intervention: {endUs: null}}});
  h.tick(3);
  const done = h.messages.at(-1) as Extract<FromWorker, {type: "done"}>;
  const wire = JSON.parse(JSON.stringify(done.submission)) as typeof done.submission;
  expect(wire.actions).toEqual([{atSecond: 1, request}]);
  const replay = createModel2Run(JSON.parse(JSON.stringify(setup.input)), 4);
  for (let second = 0; second < 4; second++) {
    for (const action of wire.actions.filter(a => a.atSecond === second)) replay.apply(action.request);
    replay.advance(); expect(replay.view()).toEqual(h.seconds()[second]!.view);
    expect(replay.view().activeChaos).toEqual([]);
  }
  expect(replay.evidence()).toEqual(h.host.evidence()!);
  expect(replay.evidence().network.poolResets!.rows[0]).toMatchObject({actionId: "a1", pathId: "app-1-db:app-1:db", closedConnections: 1, freshOpens: {opened: 1, pending: 0}});
  expect(h.seconds()[1]!.logs.some(l => l.message.includes("Reset connection pool applied") && l.message.includes("one-shot"))).toBe(true);
});
