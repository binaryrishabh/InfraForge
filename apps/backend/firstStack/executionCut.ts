import { FIRST_STACK_ENVELOPE as envelope } from "@infraforge/simulation/internal-first-stack";
import type { instantiatePreparedFirstStack, prepareFirstStackExecution } from "./execution";
import type { FirstStackReportCapture } from "@infraforge/contracts/reports";
import { captureReport } from "./reportCapture";
interface EffectiveLimits { wallMs: number; cpuUs: number; rssBytes: number; frameBytes: number; summaryBytes: number; captureBytes: number }
export interface ExecutionCut {
  schema: "first-stack-cut/1"; sequence: number; throughUs: number;
  envelope: string; effectiveLimits: EffectiveLimits; lock: ReturnType<typeof prepareFirstStackExecution>["lock"];
  timestampComplete: boolean; unfinished: { notYetOffered: number; callers: number; pendingEvents: number };
  counts: Record<string, number>; execution: { processed: number; pending: number; cancelled: number; peakPending: number };
  completeness: { horizonReached: boolean; allRootsTerminal: boolean; aggregates: "observed-prefix"; usage: "prefix-only"; journalComplete: boolean };
  distributions: unknown; omissions: { raw: number; samples: number; journal: number };
  reportCapture?: FirstStackReportCapture;
  interruption: { classification: "executor-interrupted"; kind: string; reason: string } | null;
}

export function captureExecutionCut(prepared: ReturnType<typeof prepareFirstStackExecution>,
  runtime: ReturnType<typeof instantiatePreparedFirstStack>, sequence: number,
  effectiveLimits: ExecutionCut["effectiveLimits"], interruption: ExecutionCut["interruption"]) {
  const e = runtime.evidence(), journal = runtime.journal.measure();
  const value: ExecutionCut = { schema: "first-stack-cut/1", sequence, throughUs: e.capture.throughUs,
    envelope: envelope.revision, effectiveLimits, lock: prepared.lock, timestampComplete: e.capture.timestampComplete ?? true,
    unfinished: { notYetOffered: prepared.schedule.rows.length - e.counts.offered, callers: e.counts.inFlight, pendingEvents: e.execution.pending }, counts: e.counts, execution: e.execution,
    completeness: { horizonReached: e.capture.reachedHorizon, allRootsTerminal: e.counts.offered === prepared.schedule.rows.length && e.counts.inFlight === 0,
      aggregates: "observed-prefix", usage: "prefix-only", journalComplete: journal.complete },
    distributions: e.distributions, omissions: { raw: e.resultRetention.omitted, samples: e.sampleRetention?.omitted ?? 0, journal: journal.omitted },
    reportCapture: captureReport(runtime, e), interruption };
  return { value, evidence: e };
}
