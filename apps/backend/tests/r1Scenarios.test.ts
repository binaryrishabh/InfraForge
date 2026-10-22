import { expect, test } from "bun:test";
import { challengeDefinition, publicChallenge, admitScoredChallenge } from "../firstStack/scoredChallenges/definition";
import { challengeFence, executeScoredChallenge } from "../firstStack/scoredChallenges/execution";
import { canonical, designRevision, hash } from "../firstStack/canonical";
import { inputDigest, isolatedCut } from "../firstStack/isolationProtocol";
import { instantiatePreparedFirstStack, prepareFirstStackExecution } from "../firstStack/execution";
import { captureExecutionCut } from "../firstStack/executionCut";

const scenarios = ["url-redirect", "catalogue-api", "reviews-api", "small-paste-api", "preloaded-news-api"];
const owner = "r1-qualification", engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` };
const limits = { wallMs: 60000, cpuUs: 20000000, rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 };
// Real first-stack simulation; synthetic receipts qualify software only.
function execute(input: string) {
  const saved = JSON.parse(input), prepared = prepareFirstStackExecution(saved.owner, saved.layout, saved.candidate, saved.recording, saved.policy);
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  return { status: "completed", durablePrefix: isolatedCut(captureExecutionCut(prepared, runtime, 1, limits, null).value, engine.source, inputDigest(input)),
    receipt: { cleanup: "removed", fixture: "in-process software qualification only" }, summary: "{}", journal: "", interruption: null } as any;
}
async function attempt(id: string, cores: number, workers: number, queue: number) {
  const sample = await publicChallenge(owner, id, "1");
  for (const node of sample.layout.firstStack.nodes.filter(n => n.owner === "compute")) {
    node.cores = cores; node.workers = workers; node.queue = queue;
    sample.layout.firstStack.placement.find(h => h.id === node.host)!.cores = cores;
  }
  const admitted = await admitScoredChallenge(owner, sample.layout, { id, version: "1" }, sample.workload, sample.policy);
  const input = canonical({ owner, layout: sample.layout, candidate: admitted.prepared.sidecar, recording: sample.workload, policy: sample.policy });
  const result = execute(input), run = { purpose: "scored", ownerId: owner, engine, input, inputHash: inputDigest(input), lock: admitted.prepared.lock,
    browserCut: result.durablePrefix, workload: { challenge: admitted.reference }, lineage: { designRevision: designRevision(sample.layout) } };
  const fence = challengeFence({ async check() {}, async commit() { throw Error("Hidden evidence entered visible storage"); } }, engine.source);
  const authority = { token: "qualification", async assertHeld(signal: AbortSignal) { signal.throwIfAborted(); }, async commit() {} };
  const score = await executeScoredChallenge(run, result, authority, new AbortController().signal, fence.select, async (hidden, _authority, signal) => {
    const result = execute(hidden); signal.throwIfAborted(); await fence.commit({} as any, result.durablePrefix); return result;
  });
  return { sample, score: score! };
}
for (const id of scenarios) {
  test(`${id}/1: two capacity choices pass every held-out workload with deterministic verified outcomes`, async () => {
    for (const [cores, workers, queue] of [[4, 8, 32], [4, 16, 64]]) {
      const first = await attempt(id, cores!, workers!, queue!), replay = await attempt(id, cores!, workers!, queue!);
      expect(first.score).toEqual(replay.score);
      expect(first.score.systemPassed).toBe(true);
      expect(first.score.workloads).toHaveLength(2);
      for (const w of first.score.workloads) {
        expect(w.outcomes.filter(o => o.required).every(o => o.outcome === "pass")).toBe(true);
        expect(w.outcomes.find(o => o.id === "cost-subtotal")).toMatchObject({ outcome: "Unknown", measured: null, support: "Unknown" });
        expect(w.evidence!.cut.counts.completed).toBe(JSON.parse(w.input).recording.rows.length);
        expect(w.evidence!.cut.completeness.horizonReached).toBe(true);
      }
      const definition = challengeDefinition(id, "1"), visible = JSON.stringify(first.sample);
      for (const hidden of definition.hidden) {
        expect(visible).not.toContain(hidden.id);
        const fault = hidden.faults[0]!;
        expect(hidden.observation.fromUs).toBeGreaterThanOrEqual(fault.atUs);
        expect(hidden.observation.toUs).toBeLessThanOrEqual(fault.atUs + (fault.kind === "app-process-crash" ? fault.downtimeUs : 0));
      }
      expect(visible).not.toContain('"rubric":'); expect(visible).not.toContain('"hidden":');
      expect(first.score.challenge.definitionHash).toBe(hash(definition));
    }
  });
  test(`${id}/1: weak capacity fails delivered and fault goals, without rewarding a healthy label`, async () => {
    const { score } = await attempt(id, 1, 1, 0);
    expect(score.systemPassed).toBe(false);
    expect(score.workloads.some(w => w.outcomes.some(o => o.id === "delivered" && o.outcome === "fail"))).toBe(true);
    expect(score.workloads.some(w => w.outcomes.some(o => o.id === "fault-survival" && o.outcome === "fail"))).toBe(true);
  });
}



