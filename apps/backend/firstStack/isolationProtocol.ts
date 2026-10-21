import { hash } from "./canonical";
import type { ExecutionCut } from "./executionCut";
import { FIRST_STACK_ISOLATION as limits, digestPattern, isolationDigest } from "./isolationPolicy";

export interface IsolatedInput { owner: string; layout: unknown; candidate: unknown; recording: unknown; policy: unknown }
export interface IsolatedCut {
  schema: "first-stack-isolated-cut/1"; source: string; inputHash: string;
  cut: ExecutionCut; fingerprint: string;
}
// Wall-time batching, effective budgets and interruption explanations are not
// deterministic physics. Replay addresses an exact event-count cut, not its
// wall-dependent sequence number or a later timestamp with equal-time work.
export function cutFingerprint(cut: ExecutionCut) {
  return hash({ lock: cut.lock, throughUs: cut.throughUs, timestampComplete: cut.timestampComplete,
    unfinished: cut.unfinished, counts: cut.counts, execution: cut.execution,
    completeness: cut.completeness, distributions: cut.distributions, omissions: cut.omissions,
    ...(cut.reportCapture === undefined ? {} : { reportCapture: cut.reportCapture }) });
}
export function isolatedCut(cut: ExecutionCut, source: string, inputHash: string): IsolatedCut {
  return { schema: "first-stack-isolated-cut/1", source, inputHash, cut, fingerprint: cutFingerprint(cut) };
}
export function readIsolatedCut(value: IsolatedCut, source: string, inputHash: string, previous?: IsolatedCut) {
  if (!value || value.schema !== "first-stack-isolated-cut/1" || value.source !== source || value.inputHash !== inputHash ||
    !digestPattern.test(value.fingerprint) || !value.cut || value.cut.schema !== "first-stack-cut/1" ||
    !Number.isSafeInteger(value.cut.sequence) || value.cut.sequence < 1 ||
    !Number.isSafeInteger(value.cut.execution?.processed) || value.cut.execution.processed < 0 || value.cut.execution.processed > 2_000_000 ||
    !Number.isSafeInteger(value.cut.throughUs) || value.cut.throughUs < 0 || value.cut.throughUs > 300_000_000 ||
    value.fingerprint !== cutFingerprint(value.cut) ||
    previous && (value.cut.sequence !== previous.cut.sequence + 1 || value.cut.throughUs < previous.cut.throughUs ||
      value.cut.execution.processed < previous.cut.execution.processed || hash(value.cut.lock) !== hash(previous.cut.lock))) {
    throw Error("Invalid isolated durable cut identity, sequence or fingerprint");
  }
  return value;
}
export function inputDigest(input: string) {
  if (!input || Buffer.byteLength(input) > limits.inputBytes || /[\r\n]/.test(input)) throw Error("Supply one bounded immutable JSON input line");
  return isolationDigest(input);
}

// Shared by parent and child: limit pending bytes before concatenating or
// parsing. A missing newline cannot allocate an unbounded readline buffer.
export async function* boundedLines(stream: AsyncIterable<Buffer | Uint8Array | string>, lineBytes: number, totalBytes: number, frames: number = limits.frames) {
  let pending = Buffer.alloc(0), total = 0, count = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > totalBytes) throw Error("Isolated output byte budget exceeded");
    let start = 0, end: number;
    while ((end = chunk.indexOf(10, start)) !== -1) {
      if (pending.length + end - start > lineBytes || ++count > frames) throw Error("Isolated line/frame budget exceeded");
      yield Buffer.concat([pending, chunk.subarray(start, end)]).toString("utf8");
      pending = Buffer.alloc(0); start = end + 1;
    }
    if (pending.length + chunk.length - start > lineBytes) throw Error("Isolated line budget exceeded");
    pending = Buffer.concat([pending, chunk.subarray(start)]);
  }
  if (pending.length) throw Error("Incomplete isolated protocol line");
}
