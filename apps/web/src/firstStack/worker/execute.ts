import { compileFirstStack, createFirstStackRuntime, boundedJson } from "@infraforge/simulation/internal-first-stack";
import pin from "../enginePin.json";
import { browserLimits as limits, canonical, hash, sha256, fingerprintFields, wallBudget, digestPattern } from "../protocol";
import type { BrowserRequest, BrowserResult, BrowserCut } from "../protocol";

interface Host {
  now(): number; yield(): Promise<void>; cancelled(): boolean; heap(): number | "Unknown";
}
const browserHost: Host = { now: () => performance.now(), yield: () => new Promise(resolve => setTimeout(resolve, 0)),
  cancelled: () => false, heap: () => {
    // performance.memory is nonstandard and often absent, especially in workers.
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    return typeof memory?.usedJSHeapSize === "number" && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize : "Unknown";
  } };
export async function executeBrowser(request: BrowserRequest, overrides: Partial<Host> = {}): Promise<BrowserResult> {
  const host = { ...browserHost, ...overrides }, start = host.now(), wall = wallBudget(request.wallMs);
  canonical(request); // Bound the complete envelope before expansion/compilation.
  if (request.engine.source !== pin.source || !digestPattern.test(request.engine.source) || !/^sha256:[a-f0-9]{64}$/.test(request.engine.image)) throw Error("Browser engine identity does not match the pinned bundle");
  const { input } = request, { candidate: sidecar, recording: schedule, policy } = input;
  if (!input.owner || input.owner.length > 256 || !policy.seed || policy.seed.length > 256) throw Error("Supply owner and explicit seed");
  for (const [name, value, ceiling, min] of [
    ["horizon", policy.horizonUs, limits.horizonUs, 1], ["events", policy.maxEvents, limits.events, 1],
    ["samples", policy.maxSamples, 10000, 1], ["raw results", policy.maxRawResults, limits.roots, 0],
    ["sample interval", policy.sampleIntervalUs, limits.horizonUs, 1],
  ] as const) if (!Number.isSafeInteger(value) || value < min || value > ceiling) throw Error(`Browser ${name} budget exceeded`);
  if (schedule.rows.length > limits.roots) throw Error("Browser offered-root budget exceeded");
  const inputText = canonical(input), inputHash = await sha256(inputText);
  const design = Object.fromEntries(Object.entries(input.layout).filter(([key]) => key !== "firstStack"));
  const { identity, ...scheduleBody } = schedule;
  const profile = { profile: sidecar.profile, compiler: sidecar.compiler, application: sidecar.application,
    operations: [...sidecar.operations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), database: sidecar.database,
    ...(sidecar.schema === "infraforge-first-stack-sidecar/3" ? { cache: sidecar.cache } : {}) };
  if (await hash(design) !== sidecar.designRevision || canonical(input.layout.firstStack) !== canonical(sidecar) ||
    await hash(scheduleBody) !== identity || await hash({ header: schedule.header, rows: schedule.rows }) !== schedule.executedScheduleHash ||
    await hash(profile) !== schedule.profileHash || canonical(schedule.application) !== canonical(sidecar.application) ||
    !sidecar.workload || sidecar.workload.resolvedIdentity !== identity || sidecar.workload.executedScheduleHash !== schedule.executedScheduleHash ||
    sidecar.workload.scheduleHash !== schedule.scheduleHash || sidecar.workload.parametersHash !== schedule.parametersHash) throw Error("Browser immutable design/workload identity changed");
  let reason: string | null = null, kind = "budget", observed: number | "Unknown" = "Unknown";
  const check = () => {
    observed = host.heap();
    if (host.cancelled()) { reason = "Browser run cancelled"; kind = "cancelled"; }
    else if (host.now() - start >= wall) { reason = "Browser wall-time budget exhausted"; kind = "wall"; }
    else if (observed !== "Unknown" && observed >= limits.heapBytes) { reason = "Browser observed heap budget exhausted"; kind = "heap"; }
    return reason !== null;
  };
  const memory = () => ({ observedHeapBytes: observed, enforcement: observed === "Unknown" ? "logical-limits-only" as const : "observed-heap" as const });
  if (check()) return { status: "interrupted", reason, evidence: null, memory: memory() };
  const compiled = compileFirstStack(sidecar, schedule, policy);
  const lock = { schema: "infraforge-first-stack-compile-lock/2", compiler: sidecar.compiler, composition: compiled.revision,
    designRevision: sidecar.designRevision, sidecarHash: await hash(sidecar), workloadIdentity: schedule.identity,
    executedScheduleHash: schedule.executedScheduleHash, profileHash: schedule.profileHash, compiledHash: await hash(compiled) };
  if (check()) return { status: "interrupted", reason, evidence: null, memory: memory() };
  const runtime = createFirstStackRuntime(sidecar, schedule, policy);
  try {
    let done = false;
    while (!done && !check()) {
      const sliceStart = host.now();
      do { done = runtime.advanceSlice(runtime.horizon, limits.sliceEvents); }
      while (!done && host.now() - sliceStart < limits.sliceWallMs && !check());
      await host.yield();
    }
  } catch (error) { reason = error instanceof Error ? error.message : "Browser execution interrupted"; kind = "execution-budget"; }
  check();
  const e = runtime.evidence(), journal = runtime.journal.measure();
  const cut: BrowserCut = { schema: "first-stack-cut/1", sequence: 1, throughUs: e.capture.throughUs, envelope: "first-stack-envelope/1",
    effectiveLimits: { wallMs: wall, cpuUs: "Unknown", rssBytes: "Unknown", heapBytes: limits.heapBytes,
      frameBytes: limits.frameBytes, summaryBytes: limits.frameBytes, captureBytes: limits.frameBytes }, lock,
    timestampComplete: e.capture.timestampComplete ?? true,
    unfinished: { notYetOffered: schedule.rows.length - e.counts.offered, callers: e.counts.inFlight, pendingEvents: e.execution.pending }, counts: e.counts, execution: e.execution,
    completeness: { horizonReached: e.capture.reachedHorizon, allRootsTerminal: e.counts.offered === schedule.rows.length && e.counts.inFlight === 0,
      aggregates: "observed-prefix", usage: "prefix-only", journalComplete: journal.complete },
    distributions: e.distributions, omissions: { raw: e.resultRetention.omitted, samples: e.sampleRetention?.omitted ?? 0, journal: journal.omitted },
    interruption: reason ? { classification: "executor-interrupted", kind, reason } : null };
  const evidence = { schema: "first-stack-isolated-cut/1" as const, source: request.engine.source, inputHash, cut, fingerprint: await hash(fingerprintFields(cut)) };
  boundedJson(evidence, limits.frameBytes);
  if (check() && !cut.interruption) return { status: "interrupted", reason, evidence: null, memory: memory() };
  return { status: reason ? "interrupted" : "completed", reason, evidence, memory: memory() };
}
