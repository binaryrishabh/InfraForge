import type { FirstStackSidecarV2 } from "@infraforge/contracts/first-stack";
import { firstStackFixture } from "./firstStackFixture";
import { resolveWorkload } from "../firstStack/workload";
import { canonical, designRevision } from "../firstStack/canonical";
import { inputDigest, isolatedCut } from "../firstStack/isolationProtocol";
import { instantiatePreparedFirstStack, prepareFirstStackExecution } from "../firstStack/execution";
import { captureExecutionCut } from "../firstStack/executionCut";

export async function submissionFixture(owner = "submission-test") {
  const fixture = firstStackFixture(1), old = fixture.sidecar;
  const pool = { reuse: true, establishUs: 2, acquireTimeoutUs: 1000, connectTimeoutUs: 1000,
    responseTimeoutUs: 1000, idleTimeoutUs: null, remoteCancellation: "detach" as const };
  const sidecar: FirstStackSidecarV2 = { ...old, schema: "infraforge-first-stack-sidecar/2", compiler: "first-stack-compiler/2",
    nodes: old.nodes.map(n => ({ ...n, alive: true, ready: true, reservationBytes: n.owner === "load-balancer" ? 0 : 100 })),
    placement: old.placement.map(h => ({ ...h, memoryBytes: 1024 })),
    caller: { ...old.caller, pool }, paths: old.paths.map(p => ({ ...p, pool })), links: [],
    balancer: { ...old.balancer, initial: "ineligible", healthTimeoutUs: 1000, healthKeys: ["cold"] } };
  for (const path of [{ ...sidecar.caller, id: "caller", source: "$caller", target: "lb" }, ...sidecar.paths]) {
    path.requestLink = `${path.id}:req`; path.responseLink = `${path.id}:res`;
    if (path.id === "caller") { sidecar.caller.requestLink = path.requestLink; sidecar.caller.responseLink = path.responseLink; }
    sidecar.links.push({ id: path.requestLink, from: path.source, to: path.target, bytesPerSecond: 1000000000, latencyUs: 1, queueBytes: 100000 },
      { id: path.responseLink, from: path.target, to: path.source, bytesPerSecond: 1000000000, latencyUs: 1, queueBytes: 100000 });
  }
  const header = { schema: "infraforge-first-stack-schedule/1", unit: "us", durationUs: 5000,
    origin: "authored-schedule", provenance: "Submission software fixture; no physical performance evidence" };
  async function* stream() { yield new TextEncoder().encode([header, { id: "request", atUs: 5000, operation: "read" }].map(x => JSON.stringify(x)).join("\n") + "\n"); }
  const schedule = await resolveWorkload(stream(), { owner, sidecar, parameters: { schema: "infraforge-first-stack-parameters/1", rows: [{ id: "request", plan: "read-plan", keys: ["hot"] }] } });
  sidecar.workload = { scheduleHash: schedule.scheduleHash, parametersHash: schedule.parametersHash, resolvedIdentity: schedule.identity, executedScheduleHash: schedule.executedScheduleHash };
  const policy = { seed: "submission-fixture", horizonUs: 90000, sampleIntervalUs: 1000, maxEvents: 100000, maxSamples: 100, maxRawResults: 1 };
  const layout = { ...fixture.layout, firstStack: sidecar };
  const prepared = prepareFirstStackExecution(owner, layout, sidecar, schedule, policy);
  const input = canonical({ owner, layout, candidate: sidecar, recording: prepared.schedule, policy: prepared.policy });
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  const { value } = captureExecutionCut(prepared, runtime, 1, { wallMs: 60000, cpuUs: 20000000, rssBytes: 536870912,
    frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, null);
  const engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` };
  return { owner, layout, input, lock: prepared.lock, engine,
    request: { infrastructureId: "00000000-0000-4000-8000-000000000024", expectedDesignUpdatedAt: "2026-10-21T00:00:00.000Z",
      expectedDesignRevision: designRevision(layout), idempotencyKey: "test-submission", purpose: "shared" as const,
      engine, workload: schedule, policy, browserCut: isolatedCut(value, engine.source, inputDigest(input)) } };
}
