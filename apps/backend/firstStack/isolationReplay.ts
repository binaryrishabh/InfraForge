import { setImmediate } from "node:timers/promises";
import { instantiatePreparedFirstStack, type prepareFirstStackExecution } from "./execution";
import { captureExecutionCut } from "./executionCut";
import { cutFingerprint, readIsolatedCut, type IsolatedCut } from "./isolationProtocol";
import { hash } from "./canonical";

// Only the contained child calls this function. The parent never imports an
// engine at runtime and cannot accidentally perform synchronous replay.
export async function replayFirstStackPrefix(prepared: ReturnType<typeof prepareFirstStackExecution>, expected: IsolatedCut, source: string, inputHash: string) {
  readIsolatedCut(expected, source, inputHash);
  if (hash(prepared.lock) !== hash(expected.cut.lock)) throw Error("Historical compile lock unavailable; no latest-input replay");
  const runtime = instantiatePreparedFirstStack(prepared), target = expected.cut.execution.processed;
  let processed = 0;
  while (processed < target) {
    runtime.advanceSlice(runtime.horizon, Math.min(128, target - processed));
    const next = runtime.evidence().execution.processed;
    if (next <= processed) throw Error("Recorded event prefix is unavailable");
    processed = next;
    await setImmediate();
  }
  const { value } = captureExecutionCut(prepared, runtime, expected.cut.sequence, expected.cut.effectiveLimits, expected.cut.interruption);
  const actual = cutFingerprint(value);
  return { kind: actual === expected.fingerprint ? "MatchesRecordedPrefix" as const : "Mismatch" as const,
    inputHash, expected: expected.fingerprint, actual, throughUs: value.throughUs, processed,
    complete: value.completeness.horizonReached, mutation: "None" as const };
}
