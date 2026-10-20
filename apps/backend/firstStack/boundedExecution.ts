import { cpuUsage, memoryUsage } from "node:process";
import { freemem } from "node:os";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { FIRST_STACK_ENVELOPE as envelope, boundedJson, firstStackPreflight } from "@infraforge/simulation/internal-first-stack";
import { instantiatePreparedFirstStack, type prepareFirstStackExecution } from "./execution";

type Prepared = ReturnType<typeof prepareFirstStackExecution>;
interface EffectiveLimits { wallMs: number; cpuUs: number; rssBytes: number; frameBytes: number; summaryBytes: number; captureBytes: number }
export interface ExecutionCut {
  schema: "first-stack-cut/1"; sequence: number; throughUs: number;
  envelope: string; effectiveLimits: EffectiveLimits; lock: Prepared["lock"];
  timestampComplete: boolean; unfinished: { notYetOffered: number; callers: number; pendingEvents: number };
  counts: Record<string, number>; execution: { processed: number; pending: number; cancelled: number; peakPending: number };
  completeness: { horizonReached: boolean; allRootsTerminal: boolean; aggregates: "observed-prefix"; usage: "prefix-only"; journalComplete: boolean };
  distributions: unknown; omissions: { raw: number; samples: number; journal: number };
  interruption: { classification: "executor-interrupted"; kind: string; reason: string } | null;
}
export interface BoundedExecutionOptions {
  // Acknowledgement means atomically committed. A failed callback never advances
  // the returned durable prefix. The store must fence ownership outside this API.
  persist?: (frame: string) => Promise<void>;
  cancelled?: () => boolean;
  maxWallMs?: number; maxCpuUs?: number; maxRssBytes?: number;
  maxFrameBytes?: number; maxSummaryBytes?: number; maxCaptureBytes?: number;
}
const lower = (value: number | undefined, ceiling: number) => {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) throw Error("Execution budgets may only lower the qualification ceiling");
  return value;
};

// Cooperative, internal qualification only. RSS/CPU observations cannot contain
// an OS kill; slice 10b must isolate this runner before public execution/replay.
export async function executeFirstStackBounded(prepared: Prepared, options: BoundedExecutionOptions = {}) {
  const wall = lower(options.maxWallMs, envelope.wallMs), cpu = lower(options.maxCpuUs, envelope.cpuUs), rss = lower(options.maxRssBytes, envelope.rssTargetBytes);
  const frameLimit = lower(options.maxFrameBytes, envelope.frameBytes), summaryLimit = lower(options.maxSummaryBytes, envelope.summaryBytes), captureLimit = lower(options.maxCaptureBytes, envelope.captureBytes);
  const effectiveLimits = { wallMs: wall, cpuUs: cpu, rssBytes: rss, frameBytes: frameLimit, summaryBytes: summaryLimit, captureBytes: captureLimit };
  const start = performance.now(), startCpu = cpuUsage();
  const preflight = firstStackPreflight(prepared.sidecar, prepared.schedule, prepared.policy);
  let durable: ExecutionCut | null = null, latest: ExecutionCut | null = null, storedBytes = 0, sequence = 0;
  let interruption: ExecutionCut["interruption"] = null;
  const interrupt = (kind: string, reason: string) => { interruption ??= { classification: "executor-interrupted", kind, reason }; };
  const budget = () => {
    if (options.cancelled?.()) interrupt("cancelled", "Execution cancelled; unfinished modeled work is right-censored");
    if (performance.now() - start >= wall) interrupt("wall", "Executor wall-time budget exhausted");
    const usage = cpuUsage(startCpu);
    if (usage.user + usage.system >= cpu) interrupt("cpu", "Executor CPU-time budget exhausted");
    if (memoryUsage().rss >= rss) interrupt("rss", "Executor RSS budget exhausted");
    return interruption !== null;
  };
  // Headroom is an observation, not a reservation or qualification certificate.
  if (freemem() < envelope.rssHardBytes) interrupt("headroom", "Host lacks the proposed worker memory headroom; no execution started");
  if (budget()) return { status: "interrupted" as const, interruption, durablePrefix: durable, observedPrefix: latest, storedBytes, preflight, effectiveLimits, summary: null, journal: null };
  let runtime: ReturnType<typeof instantiatePreparedFirstStack>;
  try { runtime = instantiatePreparedFirstStack(prepared); }
  catch (error) {
    interrupt("setup", error instanceof Error ? error.message : "Executor setup interrupted");
    return { status: "interrupted" as const, interruption, durablePrefix: durable, observedPrefix: latest, storedBytes, preflight, effectiveLimits, summary: null, journal: null };
  }
  let evidence: ReturnType<typeof runtime.evidence> | null = null;
  async function cut() {
    const e = runtime.evidence(), journal = runtime.journal.measure();
    const value: ExecutionCut = { schema: "first-stack-cut/1", sequence: sequence + 1, throughUs: e.capture.throughUs,
      envelope: envelope.revision, effectiveLimits, lock: prepared.lock, timestampComplete: e.capture.timestampComplete ?? true,
      unfinished: { notYetOffered: prepared.schedule.rows.length - e.counts.offered, callers: e.counts.inFlight, pendingEvents: e.execution.pending }, counts: e.counts, execution: e.execution,
      completeness: { horizonReached: e.capture.reachedHorizon, allRootsTerminal: e.counts.offered === prepared.schedule.rows.length && e.counts.inFlight === 0,
        aggregates: "observed-prefix", usage: "prefix-only", journalComplete: journal.complete },
      distributions: e.distributions, omissions: { raw: e.resultRetention.omitted, samples: e.sampleRetention?.omitted ?? 0, journal: journal.omitted }, interruption };
    const frame = boundedJson(value, frameLimit), bytes = Buffer.byteLength(frame);
    if (storedBytes + bytes > captureLimit) throw Error("Executor total capture byte budget exhausted");
    latest = value; evidence = e;
    if (options.persist) { await options.persist(frame); durable = value; storedBytes += bytes; }
    sequence++;
    return e;
  }
  try {
    evidence = await cut();
    let done = false;
    while (!done && !budget()) {
      const sliceStart = performance.now();
      do {
        done = runtime.advanceSlice(runtime.horizon, envelope.sliceEvents);
      } while (!done && performance.now() - sliceStart < envelope.sliceWallMs && !budget());
      budget();
      evidence = await cut();
      await setImmediate();
    }
    if (interruption) evidence = await cut();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Executor interrupted";
    interrupt(/byte|serializ/i.test(reason) ? "output" : /budget/i.test(reason) ? "execution-budget" : "execution-or-persistence", reason);
    // A callback may fail after virtual state changed. Do not retry that write,
    // invent a final snapshot or claim the uncommitted work was durable.
  }
  let summary: string | null = null, journal: string | null = null;
  if (evidence) {
    try {
      summary = boundedJson({ schema: "first-stack-summary/1", envelope, effectiveLimits, preflight, prefix: latest, durablePrefix: durable, interruption,
        scope: "Prefix observations; completed-only latency with right-censored unfinished callers", evidence }, summaryLimit);
      const content = runtime.journal.content();
      if (Buffer.byteLength(summary) + Buffer.byteLength(content) + storedBytes > captureLimit) throw Error("Executor retained-output byte budget exhausted");
      journal = content;
    } catch (error) { summary = null; interrupt("output", error instanceof Error ? error.message : "Output budget exhausted"); }
  }
  // A time/RSS overrun during reduction/serialization invalidates publication
  // of that summary, while already acknowledged cuts remain readable.
  if (budget()) summary = null;
  return { status: interruption ? "interrupted" as const : "completed" as const, interruption,
    durablePrefix: durable, observedPrefix: latest, storedBytes, preflight, effectiveLimits, summary, journal };
}
