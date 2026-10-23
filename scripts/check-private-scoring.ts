import { publicChallenge, admitScoredChallenge, serverChallenges } from "../apps/backend/firstStack/scoredChallenges/definition";
import { challengeFence, executeScoredChallenge } from "../apps/backend/firstStack/scoredChallenges/execution";
import { canonical, designRevision } from "../apps/backend/firstStack/canonical";
import { inputDigest, isolatedCut } from "../apps/backend/firstStack/isolationProtocol";
import { instantiatePreparedFirstStack, prepareFirstStackExecution } from "../apps/backend/firstStack/execution";
import { captureExecutionCut } from "../apps/backend/firstStack/executionCut";

const ids = ["lose-an-app-server", "url-redirect", "catalogue-api", "reviews-api", "small-paste-api", "preloaded-news-api", "price-history-api"];
const engine = { source: "a".repeat(64), image: `sha256:${"b".repeat(64)}` }, owner = "private-qualification";
const limits = { wallMs: 60000, cpuUs: 20000000, rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 };
// Operator-only in-process software qualification. No host or Linux proof claim.
function execute(input: string) {
  const saved = JSON.parse(input), prepared = prepareFirstStackExecution(saved.owner, saved.layout, saved.candidate, saved.recording, saved.policy);
  const runtime = instantiatePreparedFirstStack(prepared); runtime.advanceTo(runtime.horizon);
  return { status: "completed", durablePrefix: isolatedCut(captureExecutionCut(prepared, runtime, 1, limits, null).value, engine.source, inputDigest(input)),
    receipt: { cleanup: "removed", fixture: "synthetic software qualification only" }, summary: "{}", journal: "", interruption: null } as any;
}
async function qualify(id: string, capacity: number[]) {
  const sample = await publicChallenge(owner, id, "2");
  for (const node of sample.layout.firstStack.nodes.filter(n => n.owner === "compute")) {
    [node.cores, node.workers, node.queue] = capacity as [number, number, number];
    sample.layout.firstStack.placement.find(h => h.id === node.host)!.cores = node.cores;
  }
  const admitted = await admitScoredChallenge(owner, sample.layout, { id, version: "2" }, sample.workload, sample.policy);
  const input = canonical({ owner, layout: sample.layout, candidate: admitted.prepared.sidecar, recording: sample.workload, policy: sample.policy });
  const result = execute(input), run = { purpose: "scored", ownerId: owner, engine, input, inputHash: inputDigest(input), lock: admitted.prepared.lock,
    browserCut: result.durablePrefix, workload: { challenge: admitted.reference }, lineage: { designRevision: designRevision(sample.layout) } };
  const fence = challengeFence({ async check() {}, async commit() { throw Error(); } }, engine.source);
  const authority = { token: "qualification", async assertHeld(signal: AbortSignal) { signal.throwIfAborted(); }, async commit() {} };
  const score = await executeScoredChallenge(run, result, authority, new AbortController().signal, fence.select, async hidden => {
    const result = execute(hidden); await fence.commit({} as any, result.durablePrefix); return result;
  }, serverChallenges);
  if (!score || !("workloads" in score)) throw Error();
  const strong = capacity[0] === 4;
  if (strong ? !score.systemPassed || score.workloads.some(w => w.outcomes.some(o => o.required && o.outcome !== "pass")) :
    score.systemPassed || !score.workloads.some(w => w.outcomes.some(o => o.id === "delivered" && o.outcome === "fail")) ||
    !score.workloads.some(w => w.outcomes.some(o => o.id === "fault-survival" && o.outcome === "fail"))) throw Error();
  return strong ? "pass" : "fail (expected)";
}
try {
  for (const id of ids) {
    const capacities = id === "lose-an-app-server" ? [[4, 8, 64], [4, 16, 32], [1, 1, 0]] : [[4, 8, 32], [4, 16, 64], [1, 1, 0]];
    const outcomes = [];
    for (const capacity of capacities) outcomes.push(await qualify(id, capacity));
    console.info(`${id}/2: ${outcomes.join("; ")}`);
  }
  console.info("21 capacity checks passed across 7 scenarios; 14 private workloads verified. Cost remains Unknown.");
} catch {
  // Never print private executions, measurements, workload IDs or raw errors.
  console.error("Private scoring qualification failed; inspect securely on the scoring host.");
  process.exitCode = 1;
}
