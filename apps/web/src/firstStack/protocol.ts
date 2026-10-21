import type { FirstStackExecutable, ResolvedSchedule } from "@infraforge/contracts/first-stack";
import type { FirstStackReportCapture } from "@infraforge/contracts/reports";

const MiB = 1024 * 1024;
export const browserLimits = Object.freeze({ revision: "first-stack-browser/1", inputBytes: 4 * MiB,
  horizonUs: 60_000_000, roots: 5000, events: 250_000, wallMs: 15_000, heapBytes: 128 * MiB,
  frameBytes: MiB, sliceEvents: 128, sliceWallMs: 8 });
export interface BrowserPolicy { seed: string; horizonUs: number; sampleIntervalUs: number; maxEvents: number; maxSamples: number; maxRawResults: number }
export interface BrowserEngine { source: string; image: string }
export interface BrowserInput {
  owner: string; layout: Record<string, unknown>; candidate: FirstStackExecutable; recording: ResolvedSchedule; policy: BrowserPolicy;
}
export interface BrowserRequest { input: BrowserInput; engine: BrowserEngine; wallMs?: number }
export interface CompileLock {
  schema: string; compiler: string; composition: string; designRevision: string; sidecarHash: string;
  workloadIdentity: string; executedScheduleHash: string; profileHash: string; compiledHash: string;
}
export interface BrowserCut {
  schema: "first-stack-cut/1"; sequence: number; throughUs: number; envelope: string;
  effectiveLimits: { wallMs: number; cpuUs: "Unknown"; rssBytes: "Unknown"; heapBytes: number; frameBytes: number; summaryBytes: number; captureBytes: number };
  lock: CompileLock; timestampComplete: boolean;
  unfinished: { notYetOffered: number; callers: number; pendingEvents: number };
  counts: Record<string, number>; execution: { processed: number; pending: number; cancelled: number; peakPending: number };
  completeness: { horizonReached: boolean; allRootsTerminal: boolean; aggregates: "observed-prefix"; usage: "prefix-only"; journalComplete: boolean };
  distributions: unknown; omissions: { raw: number; samples: number; journal: number };
  reportCapture: FirstStackReportCapture;
  interruption: { classification: "executor-interrupted"; kind: string; reason: string } | null;
}
export interface BrowserEvidence { schema: "first-stack-isolated-cut/1"; source: string; inputHash: string; cut: BrowserCut; fingerprint: string }
export interface BrowserResult {
  status: "completed" | "interrupted"; reason: string | null; evidence: BrowserEvidence | null;
  memory: { observedHeapBytes: number | "Unknown"; enforcement: "observed-heap" | "logical-limits-only" };
}
export type WorkerReply = { kind: "result"; value: BrowserResult } | { kind: "error"; message: string };
export const digestPattern = /^[a-f0-9]{64}$/;

// Finite JSON only; bound bytes/depth while traversing, before retaining or cloning
// a complete request. Data strings (including CR/LF and Unicode keys) stay exact.
export function canonical(value: unknown, limit = browserLimits.inputBytes): string {
  const encoder = new TextEncoder(), parents = new Set<object>(); let bytes = 0;
  const charge = (text: string) => {
    if (text.length > limit || (bytes += encoder.encode(text).length) > limit) throw Error("Browser JSON byte budget exceeded");
    return text;
  };
  const visit = (item: unknown, depth: number): string => {
    if (depth > 64) throw Error("Browser JSON depth budget exceeded");
    if (typeof item === "string") {
      if (item.length > limit) throw Error("Browser JSON byte budget exceeded");
      return charge(JSON.stringify(item));
    }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return charge(JSON.stringify(item));
    if (typeof item !== "object" || parents.has(item)) throw Error("Supply finite acyclic JSON data");
    parents.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (item.length > 100_000) throw Error("Browser JSON collection budget exceeded");
      const parts = [charge("[")];
      for (let i = 0; i < item.length; i++) parts.push((i ? charge(",") : "") + visit(item[i], depth + 1));
      parts.push(charge("]")); result = parts.join("");
    }
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw Error("Supply plain JSON objects");
      const keys = Object.keys(item).sort();
      if (keys.length > 100_000) throw Error("Browser JSON collection budget exceeded");
      result = charge("{") + keys.map((key, i) => (i ? charge(",") : "") + charge(JSON.stringify(key)) + charge(":") + visit((item as Record<string, unknown>)[key], depth + 1)).join("") + charge("}");
    }
    parents.delete(item); return result;
  };
  return visit(value, 0);
}
export async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const hash = (value: unknown) => sha256(canonical(value));
export function fingerprintFields(cut: BrowserCut) {
  return { lock: cut.lock, throughUs: cut.throughUs, timestampComplete: cut.timestampComplete,
    unfinished: cut.unfinished, counts: cut.counts, execution: cut.execution, completeness: cut.completeness,
    distributions: cut.distributions, omissions: cut.omissions,
    ...(cut.reportCapture === undefined ? {} : { reportCapture: cut.reportCapture }) };
}
export function wallBudget(value: number = browserLimits.wallMs) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > browserLimits.wallMs) throw Error("Browser wall budget may only lower the ceiling");
  return value;
}
