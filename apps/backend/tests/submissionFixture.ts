import { firstStackCompileFixture } from "../../../scripts/fixtures/first-stack-compile";
import { canonical, designRevision } from "../firstStack/canonical";
import { inputDigest, isolatedCut } from "../firstStack/isolationProtocol";
import { instantiatePreparedFirstStack, prepareFirstStackExecution } from "../firstStack/execution";
import { captureExecutionCut } from "../firstStack/executionCut";

export async function submissionFixture(owner = "submission-test") {
  const fixture = await firstStackCompileFixture(1), layout = { ...fixture.layout, firstStack: fixture.sidecar };
  const prepared = prepareFirstStackExecution(owner, layout, fixture.sidecar, fixture.schedule, fixture.policy);
  const input = canonical({ owner, layout, candidate: fixture.sidecar, recording: prepared.schedule, policy: prepared.policy });
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  const { value } = captureExecutionCut(prepared, runtime, 1, { wallMs: 60000, cpuUs: 20000000, rssBytes: 536870912,
    frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, null);
  const engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` };
  return { owner, layout, input, lock: prepared.lock, engine,
    request: { infrastructureId: "00000000-0000-4000-8000-000000000024", expectedDesignUpdatedAt: "2026-10-21T00:00:00.000Z",
      expectedDesignRevision: designRevision(layout), idempotencyKey: "test-submission", purpose: "shared" as const,
      engine, workload: fixture.schedule, policy: fixture.policy, browserCut: isolatedCut(value, engine.source, inputDigest(input)) } };
}
