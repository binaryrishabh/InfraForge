// Browser-only determinism probe. No server code or runtime shims enter this bundle.
import { compileFirstStack, createFirstStackRuntime } from "../../packages/simulation/src/internalFirstStack";
import { captureBrowserReport } from "../../apps/web/src/firstStack/worker/reportCapture";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function hash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function probe(input: { sidecar: Parameters<typeof compileFirstStack>[0]; schedule: Parameters<typeof compileFirstStack>[1]; policy: Parameters<typeof compileFirstStack>[2] }) {
  const { sidecar, schedule, policy } = input;
  const compiled = compileFirstStack(sidecar, schedule, policy);
  const lock = { schema: "infraforge-first-stack-compile-lock/2", compiler: sidecar.compiler, composition: compiled.revision,
    designRevision: sidecar.designRevision, sidecarHash: await hash(sidecar), workloadIdentity: schedule.identity,
    executedScheduleHash: schedule.executedScheduleHash, profileHash: schedule.profileHash, compiledHash: await hash(compiled) };
  const runtime = createFirstStackRuntime(sidecar, schedule, policy);
  runtime.advanceTo(runtime.horizon);
  const e = runtime.evidence(), journal = runtime.journal.measure();
  const fingerprintFields = { lock, throughUs: e.capture.throughUs, timestampComplete: e.capture.timestampComplete ?? true,
    unfinished: { notYetOffered: schedule.rows.length - e.counts.offered, callers: e.counts.inFlight, pendingEvents: e.execution.pending },
    counts: e.counts, execution: e.execution,
    completeness: { horizonReached: e.capture.reachedHorizon, allRootsTerminal: e.counts.offered === schedule.rows.length && e.counts.inFlight === 0,
      aggregates: "observed-prefix", usage: "prefix-only", journalComplete: journal.complete },
    distributions: e.distributions, omissions: { raw: e.resultRetention.omitted, samples: e.sampleRetention?.omitted ?? 0, journal: journal.omitted },
    reportCapture: captureBrowserReport(runtime, e) };
  const cut = { ...fingerprintFields, schema: "first-stack-cut/1", sequence: 1,
    envelope: "first-stack-envelope/1", effectiveLimits: null, interruption: null };
  return { canonical: canonical({ lock, evidence: e, journal: runtime.journal.content() }), canonicalCut: canonical(cut), fingerprint: await hash(fingerprintFields) };
}
Object.assign(globalThis, { firstStackProbe: probe });
