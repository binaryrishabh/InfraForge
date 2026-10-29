import { createHash } from "node:crypto";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import { buildModel2Contract, compileProduct, createProductModel2, createLiveModel2, requireKnown, withTimeline, type SavedProductDesign } from "@infraforge/simulation/internal-product";
import { challengeSeed } from "../challenges/registry";
import { recordedExperiment } from "../challenges/experiment";

// Direct engine evidence supplements the API report: snapshots do not retain DB queues.
// Use the same saved design, seed, fault microsecond boundary and restart as live runs.
export function cacheReturnEvidence(d: ChallengeDefinition, layout: ChallengeStarter, horizon = d.evaluationSeconds + 20, outage = true) {
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: layout.resources, connections: layout.connectionLines, workload: d.workload };
  const built = buildModel2Contract(design, horizon, challengeSeed(d));
  if ("refused" in built) throw Error(built.refused.join("; "));
  const plan = recordedExperiment(d)!;
  const contract = withTimeline({ ...built.contract, arrival: { ...built.contract.arrival, generated: true } }, outage ? [{ id: "a1", kind: "crash", node: plan.targetResourceId,
    atUs: plan.atSimulatedSecond * 1_000_000 + 1, durationUs: plan.durationSimulatedSeconds * 1_000_000, restartUs: 1_000_000 }] : []);
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw Error(compiled.diagnostics.map(e => e.message).join("; "));
  const run = createProductModel2(compiled.value);
  const live = createLiveModel2(compiled.value, design.resources.map(r => r.id));
  const rows = [];
  let firstRefusalSecond: number | null = null;
  for (let second = 1; second <= horizon; second++) {
    run.advanceTo(second * 1_000_000);
    live.advanceSecond();
    const projection = live.project();
    const counters = run.inspect("db") as { sessionRefused: number };
    if (counters.sessionRefused > 0 && firstRefusalSecond === null) firstRefusalSecond = second;
    if (second !== 100 && second < 120) continue;
    const evidence = run.evidence(), db = evidence.data.databases.find(db => db.id === "db")!;
    const paths = evidence.network.paths.filter(path => path.target === "db");
    rows.push({ second, cacheHealth: projection.metrics.cache!.health, dbHealth: projection.metrics.db!.health, health: projection.overallHealth, cpu: projection.metrics.db!.cpu, live: db.transactions.live, queued: db.queued, active: db.transactions.live - db.queued,
      poolWaiters: paths.reduce((sum, path) => sum + path.pool.pending, 0), orphans: db.sessions.orphaned!,
      sessions: db.sessions.total, limit: db.sessions.limit, refusals: db.sessionEvents!.refused,
      replicas: run.pools().find(pool => pool.id === "app")!.ready });
  }
  const evidence = run.evidence();
  return { rows, firstRefusalSecond, connectionsPerPool: requireKnown(contract.transports.database!.pool.maxConnections, "count"),
    controller: evidence.product.controllers.find(c => c.id === "app")!,
    evidenceHash: createHash("sha256").update(JSON.stringify(evidence).replaceAll("\r\n", "\n")).digest("hex") };
}
