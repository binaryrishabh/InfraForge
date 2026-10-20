import { expect, test } from "bun:test";
import { firstStackIoFixture } from "../fixtures/first-stack-io";
import { compileFirstStackIo } from "../../packages/simulation/src/firstStack/io";
import { createFirstStackRuntime } from "../../packages/simulation/src/firstStack/run";
import { hash } from "../../apps/backend/firstStack/canonical";
import { verifyFiniteIoProof } from "../reality/finite-io-proof";

test("first-stack IO compiler pins workload/profile content and refuses missing exact keys", async () => {
  const f = await firstStackIoFixture();
  const compiled = compileFirstStackIo(f.sidecar, f.schedule, f.policy, f.profile);
  expect(compiled.revision).toBe("first-stack-io-composition/1");
  const changed = structuredClone(f.profile); changed.buffers[0]!.initialPages = ["page-hot"];
  expect(hash(compileFirstStackIo(f.sidecar, f.schedule, f.policy, changed))).not.toBe(hash(compiled));
  changed.identity.workload = "wrong";
  expect(() => compileFirstStackIo(f.sidecar, f.schedule, f.policy, changed)).toThrow("identity");
  f.profile.bindings.pop(); expect(() => compileFirstStackIo(f.sidecar, f.schedule, f.policy, f.profile)).toThrow();
});
test("cached and IO paths differ on the composed clock while counting stays supported-logical", async () => {
  const outputs = [];
  for (const warm of [false, true]) {
    const f = await firstStackIoFixture(warm), runtime = createFirstStackRuntime(f.sidecar, f.schedule, f.policy, undefined, f.profile);
    runtime.advanceTo(runtime.horizon); const e = runtime.evidence(); outputs.push(e);
    expect(e.counts.completed).toBe(24); expect(e.firstStack).toMatchObject({ timing: "assumption-only", activeEngine: "1", composition: "first-stack-io-composition/1" });
    expect(e.composition.memory.find(m => m.id === "host-db")!.reservedBytes).toBe(228);
  }
  expect(outputs[0]!.composition.storage!.devices[0]!.completed.operations).toBe(2);
  expect(outputs[1]!.composition.storage!.devices[0]!.completed.operations).toBe(0);
  expect(outputs[0]!.results[0]!.responseUs).toBeGreaterThan(outputs[1]!.results[0]!.responseUs);
});
test("finite IO retained proof matches current sources and preserves eight historical hashes", async () => {
  expect(await verifyFiniteIoProof()).toMatchObject({ cases: 2, historicalCompositions: 8 });
});
