import { expect, test } from "bun:test";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { instantiatePreparedFirstStack } from "../../apps/backend/firstStack/execution";
import { captureExecutionCut } from "../../apps/backend/firstStack/executionCut";
import { isolatedCut } from "../../apps/backend/firstStack/isolationProtocol";
import { replayFirstStackPrefix } from "../../apps/backend/firstStack/isolationReplay";

test("replay verifies zero, partial equal-time and horizon event prefixes with original lock", async () => {
  const f = await firstStackCompileFixture(), prepared = f.prepare(), source = "a".repeat(64), inputHash = "b".repeat(64);
  const limits = { wallMs: 60000, cpuUs: 30000000, rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 };
  for (const events of [0, 1, 128, 100000]) {
    const runtime = instantiatePreparedFirstStack(prepared);
    if (events) runtime.advanceSlice(runtime.horizon, events);
    const { value } = captureExecutionCut(prepared, runtime, 7, limits, null);
    const expected = isolatedCut(value, source, inputHash);
    expect((await replayFirstStackPrefix(prepared, expected, source, inputHash)).kind).toBe("MatchesRecordedPrefix");
    const wrong = structuredClone(expected); wrong.cut.counts.completed = 900;
    const changed = isolatedCut(wrong.cut, source, inputHash);
    expect((await replayFirstStackPrefix(prepared, changed, source, inputHash)).kind).toBe("Mismatch");
    await expect(replayFirstStackPrefix(prepared, expected, "c".repeat(64), inputHash)).rejects.toThrow("identity");
  }
});
