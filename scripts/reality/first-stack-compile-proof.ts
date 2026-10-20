import { readFileSync, writeFileSync } from "node:fs";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { runFirstStackQualification } from "../../apps/backend/firstStack/execution";
import { hash } from "../../apps/backend/firstStack/canonical";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { verifyCompositionHost } from "./composition-host-proof";

const artifact = "docs/reality/first-stack-compile-proof.json";
export async function firstStackCompileProof() {
  const runs = [];
  for (const apps of [1, 2, 4, 8]) {
    const fixture = await firstStackCompileFixture(apps), prepared = fixture.prepare();
    const off = runFirstStackQualification(prepared), on = runFirstStackQualification(prepared, () => {}), repeated = runFirstStackQualification(prepared);
    if (JSON.stringify(off) !== JSON.stringify(on) || JSON.stringify(off) !== JSON.stringify(repeated)) throw Error("Observer/repetition changed first-stack evidence");
    const e = off.evidence, db = e.data.databases[0]!;
    runs.push({ apps, compiledHash: prepared.compiledHash, evidenceHash: hash(e),
      workload: prepared.schedule.executedScheduleHash, offered: e.counts.offered, completed: e.counts.completed,
      selectedPerApp: e.network.loadBalancers[0]!.backends.map(b => ({ id: b.id, selected: b.selected })),
      healthCommits: db.queryClasses.health!.committed, foregroundCommits: db.queryClasses.read!.committed,
      maximumResponseUs: Math.max(...e.results.map(r => r.responseUs)),
      appUnsatisfiedParallelismUs: e.composition.cpu.filter(h => h.id.startsWith("host-app")).reduce((s, h) => s + h.unsatisfiedParallelismUs, 0),
      dbUnsatisfiedParallelismUs: db.cpu.unsatisfiedParallelismUs,
      observerEqual: true, repeatedBytesEqual: true });
  }
  const shared = await firstStackCompileFixture(4, { shared: true }), sharedEvidence = runFirstStackQualification(shared.prepare()).evidence;
  return { schema: "infraforge-first-stack-compile-proof/2", compiler: "first-stack-compiler/2", composition: "first-stack-composition/2",
    scope: "Internal conditional logical software proof; no physical calibration, public admission or Model 2 activation",
    unchangedHostAndPeerFiles: verifyCompositionHost(),
    preservedCompositionHashes: JSON.parse(readFileSync("docs/reality/stage1-composition-hashes.json", "utf8")),
    sources: ["packages/contracts/src/first-stack/index.ts", "apps/backend/firstStack/authoring.ts", "apps/backend/firstStack/workload.ts", "apps/backend/firstStack/execution.ts", "packages/simulation/src/internalFirstStack.ts", "packages/simulation/src/firstStack/compiler.ts", "packages/simulation/src/firstStack/run.ts", "scripts/fixtures/first-stack-compile.ts", "scripts/tests/first-stack-compile.test.ts"].map(path => ({ path, hash: sourceHash(readFileSync(path, "utf8")) })),
    runs, sharedHost: { evidenceHash: hash(sharedEvidence), cpu: sharedEvidence.composition.cpu.find(h => h.id === "shared-apps"), memory: sharedEvidence.composition.memory.find(h => h.id === "shared-apps") } };
}
export async function verifyFirstStackCompileProof(write = false) {
  const current = await firstStackCompileProof();
  if (write) writeFileSync(artifact, JSON.stringify(current, null, 2) + "\n");
  if (hash(current) !== hash(JSON.parse(readFileSync(artifact, "utf8")))) throw Error("First-stack V2 proof changed; review and run its producer with --write");
  return { cases: current.runs.length, unchangedHostAndPeerFiles: current.unchangedHostAndPeerFiles, observerEqual: true, repeatBytesEqual: true };
}
if (import.meta.main) console.info(JSON.stringify(await verifyFirstStackCompileProof(process.argv.includes("--write"))));
