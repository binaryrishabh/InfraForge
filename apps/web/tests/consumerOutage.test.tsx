import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RESOURCE_PORTS, type Resource } from "@infraforge/domain/resource";
import { resolveWorkload } from "@infraforge/domain/workload";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import type { ActionRequest, RunAction } from "@infraforge/contracts/actions";
import { createRunHost } from "../src/features/model2Run/worker/host";
import type { FromWorker, RunStart } from "../src/features/model2Run/protocol";
import { ActionTimeline } from "../src/features/reports/components/ActionTimeline";
import { NodeLive } from "../src/features/live/NodeLive";
import { NodeCard } from "../src/features/canvas/components/node/NodeCard";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useSimulationStore } from "../src/features/monitoring/store/simulationStore";

const request: ActionRequest = {kind: "intervention", parameters: {interventionId: "consumer-outage", revision: 1, target: {resourceId: "worker"}, parameters: {duration: 5}}};
function input(): RunStart["input"] {
  const resources: Resource[] = [{id: "app", type: "Virtual Machine", x: 0, y: 0}, {id: "queue", type: "Message Queue", x: 1, y: 0, asyncQueue: {enabled: true, visibilityTimeoutSeconds: 30, maxReceives: 3, retentionSeconds: 300}},
    {id: "worker", type: "Virtual Machine", x: 2, y: 0, asyncWorker: {enabled: true, concurrency: 1, prefetch: 1, cpuMsPerJob: 250}}, {id: "store", type: "Object Storage", x: 3, y: 0}];
  const connectionLines = [["app", "queue"], ["app", "store"], ["queue", "worker"], ["worker", "store"]].map(([s, t], i) => {
    const source = resources.find(r => r.id === s)!, target = resources.find(r => r.id === t)!;
    return {id: `e${i}`, sourceId: source.id, targetId: target.id, sourceType: source.type, targetType: target.type, port: RESOURCE_PORTS[target.type]};
  });
  return {resources, connectionLines, workloadProfile: resolveWorkload({targetThroughput: 210, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light"}), seed: "async-proof"};
}

for (const stop of [3, 70]) test(`browser consumer outage matches serialized replay including stop at second ${stop}`, () => {
  const captured = input(), messages: FromWorker[] = [], queue: Array<() => void> = [];
  const host = createRunHost(m => messages.push(structuredClone(m)), {set: run => {queue.push(run); return run;}, clear: () => {queue.length = 0;}});
  host.handle({type: "start", start: {input: captured, horizonSeconds: 70, stopAtSecond: stop, speed: 1}});
  for (let second = 0; second < stop; second++) {
    if (second === 1) {
      host.handle({type: "action", id: "outage", request});
      const before = host.evidence(), actions = host.actions();
      for (const bad of [{...request, parameters: {...request.parameters, revision: 2}}, request, {...request, parameters: {...request.parameters, target: {resourceId: "app"}}}]) {
        host.handle({type: "action", id: "refused", request: bad as ActionRequest});
        expect(messages.at(-1)).toMatchObject({type: "action", ok: false});
        expect(host.actions()).toEqual(actions); expect(host.evidence()).toEqual(before);
      }
    }
    if (second === 10) host.handle({type: "action", id: "stop-load", request: {kind: "load", parameters: {targetLoadFraction: 0}}});
    queue.shift()!();
  }
  const done = messages.at(-1) as Extract<FromWorker, {type: "done"}>;
  expect(done.type).toBe("done"); expect(messages.filter(m => m.type === "error")).toEqual([]);
  const wire = JSON.parse(JSON.stringify(done.submission)) as typeof done.submission;
  const seconds = messages.filter((m): m is Extract<FromWorker, {type: "second"}> => m.type === "second");
  const server = createModel2Run(JSON.parse(JSON.stringify(captured)), 70);
  let cursor = 0;
  for (let second = 0; second < stop; second++) {
    while (wire.actions[cursor]?.atSecond === second) server.apply(wire.actions[cursor++]!.request);
    const logs = server.advance(), stable = (rows: typeof logs) => rows.map(row => ({...row, timestamp: ""}));
    expect(server.view()).toEqual(seconds[second]!.view);
    expect(stable(logs)).toEqual(stable(seconds[second]!.logs));
  }
  expect(server.actions).toEqual(host.actions()!); expect(server.evidence()).toEqual(host.evidence()!);
  const e = server.evidence();
  expect(e.product.interventions![0]!.phase).toBe(stop === 3 ? "active" : "completed");
  if (stop === 70) expect(e.asynchronous.brokers[0]).toMatchObject({accepted: 36, acknowledged: 36, ready: 0, inFlight: 0, redelivered: 1});
  const action = messages.find((m): m is Extract<FromWorker, {type: "action"}> => m.type === "action" && m.ok)!;
  expect(action.ok).toBe(true);
  if (!action.ok) throw Error("outage refused");
  expect(new TextEncoder().encode(JSON.stringify(action.outcome)).length).toBeLessThan(24 * 1024);
  expect(seconds[1]!.view.activeChaos).toMatchObject([{resourceId: "worker", intervention: {label: "Consumer outage", restoreAtUs: 6_000_001}}]);
  if (stop === 70) expect(seconds[6]!.view.activeChaos).toEqual([]);
});

test("consumer outage live node, card and report describe the active window and baseline restore", () => {
  const run = createModel2Run(input(), 70); run.advance(); const result = run.apply(request); run.advance();
  const sim = useSimulationStore.getInitialState(), canvas = useCanvasStore.getInitialState();
  const oldChaos = sim.activeChaos, oldMode = canvas.liveMode;
  const worker = input().resources.find(r => r.id === "worker")!;
  try {
    sim.activeChaos = run.view().activeChaos; canvas.liveMode = true;
    for (const html of [renderToStaticMarkup(<NodeLive deploymentId="run" resource={worker} resources={input().resources} controls={false} />), renderToStaticMarkup(<NodeCard resource={worker} mode="live" />)]) {
      expect(html).toContain("Consumer outage"); expect(html).toContain("6000001 us");
    }
  } finally {sim.activeChaos = oldChaos; canvas.liveMode = oldMode;}
  const row: RunAction = {id: "durable", deploymentId: "run", sequence: 1, ...request, status: "running", requestedAt: "2026-10-30T00:00:00Z", appliedAt: "2026-10-30T00:00:00Z", completedAt: null,
    appliedSimulatedSeconds: 1, completedSimulatedSeconds: null, outcome: result.outcome, failureReason: null};
  const html = renderToStaticMarkup(<ActionTimeline actions={[row]} />);
  for (const text of ["Consumer outage v1 on worker", "duration 5 s", "baseline restore at 6000001 us", "Completion has not been recorded"]) expect(html).toContain(text);
});
