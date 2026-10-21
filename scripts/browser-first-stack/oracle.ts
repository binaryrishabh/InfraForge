// Expectations are computed only by the current server execution/capture path.
// This module intentionally has no browser worker or browser hashing imports.
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { firstStackCacheFixture } from "../fixtures/first-stack-cache";
import { firstStackFaultFixture } from "../fixtures/first-stack-faults";
import { canonical, hash } from "../../apps/backend/firstStack/canonical";
import { instantiatePreparedFirstStack } from "../../apps/backend/firstStack/execution";
import { captureExecutionCut } from "../../apps/backend/firstStack/executionCut";
import { cutFingerprint, inputDigest } from "../../apps/backend/firstStack/isolationProtocol";

export async function serverCases() {
  const fixtures = [
    ["shared-contention", () => firstStackCompileFixture(2, { shared: true })],
    ["hot-writes", () => firstStackCompileFixture(2, { write: true })],
    ["range-read", () => firstStackCompileFixture(1, { range: true })],
    ["fault-retry", () => firstStackFaultFixture()],
    ["cache-miss-coalescing", () => firstStackCacheFixture()],
    ["cache-ttl-eviction", () => firstStackCacheFixture({ warm: true, capacityBytes: 3, ttlUs: 100,
      rows: [{ id: "z", atUs: 5000, key: "hot" }, { id: "a", atUs: 5000, key: "cold" }, { id: "é", atUs: 9000, key: "hot" }] })],
  ] as const;
  const cases = [];
  for (const [name, make] of fixtures) for (const seed of ["browser-0", "browser-1", "种子-🧪"]) {
    const f = await make(); f.policy.seed = seed;
    const prepared = f.prepare(), runtime = instantiatePreparedFirstStack(prepared);
    runtime.advanceTo(runtime.horizon);
    const cut = captureExecutionCut(prepared, runtime, 1, { wallMs: 60000, cpuUs: 30000000, rssBytes: 536870912,
      frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 }, null).value;
    // Host-specific effective budgets are metadata, excluded by server hashing.
    // All other cut fields (including reportCapture) must match byte for byte.
    const canonicalCut = canonical({ ...cut, effectiveLimits: null });
    const expected = { canonical: canonical({ lock: prepared.lock, evidence: runtime.evidence(), journal: runtime.journal.content() }),
      canonicalCut, fingerprint: cutFingerprint(cut) };
    const input = { sidecar: f.sidecar, schedule: f.schedule, policy: f.policy };
    const workerInput = { owner: "qualification", layout: { ...f.layout, firstStack: f.sidecar }, candidate: f.sidecar, recording: f.schedule, policy: f.policy };
    cases.push({ name, seed, input, expected, workerInput, inputHash: inputDigest(canonical(workerInput)) });
  }
  return cases;
}
export function fixtureRows(cases: Awaited<ReturnType<typeof serverCases>>) {
  return cases.map(c => ({ name: c.name, seed: c.seed, canonicalHash: hash(c.expected.canonical),
    canonicalCutHash: hash(c.expected.canonicalCut), fingerprint: c.expected.fingerprint }));
}
if (import.meta.main) {
  const value = { schema: "first-stack-browser-server-fixtures/1", cases: fixtureRows(await serverCases()) };
  const path = "scripts/fixtures/browser-server-results.json", text = JSON.stringify(value, null, 2) + "\n";
  if (process.argv.includes("--write")) await Bun.write(path, text);
  else if ((await Bun.file(path).text()).replaceAll("\r\n", "\n") !== text) throw Error("Server browser-fixture drift; regenerate using the server oracle --write");
  console.log(`Server oracle: ${value.cases.length} canonical cuts and fingerprints`);
}
