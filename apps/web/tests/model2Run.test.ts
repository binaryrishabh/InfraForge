import { expect, test } from "bun:test";
import { DEFAULT_RETRY_SETTINGS, RESOURCE_TYPES as T, DeploymentChaosNames, type Resource } from "@infraforge/domain/resource";
import { resolveWorkload } from "@infraforge/domain/workload";
import { createModel2Run } from "@infraforge/simulation/model2-run";
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
    const stable = (rows: typeof logs) => rows.map(({timestamp: _clock, ...row}) => row);
    expect(stable(h.seconds().at(-1)!.logs)).toEqual(stable(logs));
  }
  expect(h.messages.at(-1)!.type).toBe("done");
});
