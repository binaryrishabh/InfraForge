import { readFileSync, writeFileSync } from "node:fs";
import { firstStackFaultFixture } from "../fixtures/first-stack-faults";
import { runFirstStackQualification } from "../../apps/backend/firstStack/execution";
import { hash } from "../../apps/backend/firstStack/canonical";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { faultHostPaths, beforeFaultHost } from "../stage2-fault-host";
import { verifyCompositionHost } from "./composition-host-proof";
import type { CausalEvent } from "../../packages/simulation/src/model2/workload/causal";

const artifact = "docs/reality/first-stack-fault-proof.json";
export async function faultProof(write = false) {
  for (const path of faultHostPaths) beforeFaultHost(path, readFileSync(path, "utf8"));
  const runs = [];
  for (const mode of ["crash", "shared-crash", "partition", "delay", "write-crash"] as const) {
    const f = await firstStackFaultFixture({ shared: mode === "shared-crash", write: mode === "write-crash" });
    if (mode === "partition") f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "request-loss", kind: "directed-partition", target: f.sidecar.paths[0]!.requestLink, atUs: 5000, durationUs: 1500 }];
    if (mode === "delay") f.sidecar.faults = [{ schema: "first-stack-fault/1", id: "response-delay", kind: "directed-delay", target: f.sidecar.paths[0]!.responseLink, atUs: 5000, durationUs: 1500, delayUs: 1000 }];
    const prepared = f.prepare(), events: CausalEvent[] = [];
    const result = runFirstStackQualification(prepared, event => events.push(event));
    if (hash(result) !== hash(runFirstStackQualification(prepared)) || hash(result) !== hash(runFirstStackQualification(prepared))) throw Error("Fault observer/repeat equality failed");
    const e = result.evidence, lb = e.network.loadBalancers[0]!;
    if (lb.attempts > 2 * e.counts.offered || (mode === "write-crash" && lb.retries !== 0)) throw Error("Retry conservation failed");
    runs.push({ mode, lock: result.lock, scenario: f.sidecar.faults, retry: f.sidecar.retry ?? null, evidence: hash(e), journal: hash(events),
      counts: e.counts, attempts: lb.attempts, retries: lb.retries, lifecycle: e.composition.lifecycle,
      transactions: e.data.databases[0]!.transactions, cpu: e.composition.cpu, memory: e.composition.memory,
      observerEqual: true, repeatedBytesEqual: true });
  }
  const paths = [...faultHostPaths, "packages/contracts/src/first-stack/index.ts", "apps/backend/firstStack/authoring.ts", "packages/simulation/src/firstStack/compiler.ts", "packages/simulation/src/firstStack/run.ts", "packages/simulation/src/firstStack/faults.ts", "packages/simulation/src/firstStack/bounds.ts", "scripts/fixtures/first-stack-faults.ts", "scripts/tests/first-stack-faults.test.ts", "scripts/stage2-fault-host.ts", "scripts/reality/first-stack-fault-proof.ts"];
  const current = { schema: "first-stack-fault-proof/1", scope: "Non-cache finite logical scenarios only. Model 1 active; timing assumption-only; full memory/cost Unknown; no host or cloud calibration claim.",
    hostReconstruction: verifyCompositionHost(), sources: paths.map(path => ({ path, hash: sourceHash(readFileSync(path, "utf8")) })), runs };
  if (write) writeFileSync(artifact, JSON.stringify(current, null, 2) + "\n");
  if (hash(current) !== hash(JSON.parse(readFileSync(artifact, "utf8")))) throw Error("Fault proof requires reviewed regeneration with --write");
  return { cases: runs.length, observerEqual: true, repeatedBytesEqual: true };
}
if (import.meta.main) console.info(JSON.stringify(await faultProof(process.argv.includes("--write"))));
