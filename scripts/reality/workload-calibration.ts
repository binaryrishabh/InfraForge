import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fitConstantDemand, type BenchmarkRecord } from "../../packages/simulation/src/model2/workload/calibration";
import { createWorkloadModel2 } from "../../packages/simulation/src/model2/workload/run";
import type { WorkloadInput, TraceRow } from "../../packages/simulation/src/model2/workload/contracts";
import type { DemandProfile } from "../../packages/simulation/src/model2/workload/profiles";
import type { Quantity, Unit } from "../../packages/simulation/src/reality/quantity";
import type { RealityEntry } from "../../packages/simulation/src/reality/ledger";
import { WORKLOAD_POLICY_LEDGER } from "../../packages/simulation/src/model2/workload/policy";

const root = resolve(import.meta.dir, "../.."), directory = resolve(root, "docs/reality");
const read = (name: string) => JSON.parse(readFileSync(resolve(directory, name), "utf8"));
const write = (name: string, data: unknown) => writeFileSync(resolve(directory, name), JSON.stringify(data, null, 2) + "\n");
interface Measurement { host: Record<string, string>; software: string; environment: string; sourceHash: string; records: BenchmarkRecord[] }
interface TraceMeasurement { name: string; factor: number; intervalUs: number; software: string; environment: string; trace: TraceRow[];
  results: Array<{ id: string; operation: string; offeredAtUs: number; beganUs: number; finishedUs: number; responseUs: number }>;
  cpuCoreUs: number; elapsedUs: number; executionWallUs: number; maxReadyQueue: number }

export function candidateProfiles(measurement: Measurement) {
  const ledger: RealityEntry[] = [];
  const entry = (id: string, quantity: Quantity, classification: RealityEntry["classification"], detail: string) => {
    ledger.push({ id, concept: id, modelVersion: "2", scope: `Host-specific controlled PBKDF2: ${measurement.environment}; ${measurement.software}`, validityDomain: "Warm serial PBKDF2-SHA256 v1, 64-byte payload, one modeled core/worker, exact environment/software identifiers and operation-specific iteration count; candidate only", quantity,
      formula: detail, classification, confidence: "conditional", provenance: [{ source: "docs/reality/m2b-measurements.json", supports: "exact", detail }], assumptions: ["Single warm serial worker; no cloud applicability", "Core time is a fitted conditional mean; wall overhead and service variance are not fitted"],
      researchedOn: measurement.records[0]!.date, freeMode: "forbidden", replacement: "Candidate only; independently remeasure any different environment/application" });
    return quantity;
  };
  const q = <U extends Unit>(id: string, value: number, unit: U): Quantity<U> => entry(id, { kind: "known", value, unit, provenance: [id] }, "user-input", "Authored controlled-experiment configuration, not an infrastructure fact") as Quantity<U>;
  const range = (id: string, min: number, max: number, unit: Unit) => { const value = { unit, min, max, provenance: [id] }; entry(id, { kind: "range", ...value }, "derived", "Restricted calibration applicability; not a confidence interval"); return value; };
  const fits = ["light", "heavy"].map((operation) => {
    const id = `m2b.local.${operation}`, contract: Omit<DemandProfile, "cpu" | "method" | "obtainedBy" | "evidence" | "uncertainty"> = {
      schema: "infraforge-demand/1", id, version: "1", application: "controlled-pbkdf2-v1", operation, stage: "compute", io: q(`${id}.io`, 0, "us"), date: measurement.records[0]!.date,
      validity: { exact: { software: measurement.software, environment: measurement.environment, warm: "yes" }, ranges: {
        workers: range(`${id}.workers`, 1, 1, "count"), cores: range(`${id}.cores`, 1, 1, "cores"), payloadBytes: range(`${id}.payload`, 64, 64, "bytes"),
      } }, freeMode: "forbidden",
    };
    const fit = fitConstantDemand(measurement.records.filter((r) => r.operation === operation), contract, `${id}.cpu`);
    entry(`${id}.cpu`, fit.profile.cpu, "calibrated-model", "Sum fitting-batch measured process CPU core-microseconds / sum fitting-batch operations; holdout excluded"); return fit;
  });
  const baseInterval = Math.round(fits.reduce((n, f) => n + (f.profile.cpu.kind === "known" ? f.profile.cpu.value : NaN), 0) / fits.length * 0.75);
  for (const fit of fits) {
    fit.profile.validity.ranges.arrivalIntervalUs = range(`${fit.profile.id}.arrivalInterval`, Math.round(baseInterval * 0.5), baseInterval * 2, "us");
    fit.profile.uncertainty.push("Only periodic authored global intervals in the declared experiment range; its three tested intervals are not a continuous external-validity guarantee");
  }
  return { fits, ledger, q };
}

export function measuredInput(measurement: Measurement, rows: TraceRow[], horizon: number, sample: number) {
  const { fits, ledger, q } = candidateProfiles(measurement);
  const profiles = fits.map((f) => f.profile);
  const input: WorkloadInput = { modelVersion: "2", workloadVersion: "m2b/1", seed: "local-pbkdf2-heldout", ledger, profiles,
    resources: [{ id: "service", kind: "compute", cores: q("run.cores", 1, "cores"), concurrency: q("run.workers", 1, "count"), queueCapacity: q("run.queue", rows.length, "count"), cancellation: "unsupported",
      profiles: Object.fromEntries(profiles.map((p) => [p.operation, p.id])), context: { labels: { software: measurement.software, environment: measurement.environment, warm: "yes" }, quantities: { payloadBytes: q("run.payload", 64, "bytes"), arrivalIntervalUs: q("run.arrivalInterval", rows.length > 1 ? rows[1]!.atUs - rows[0]!.atUs : 0, "us") } } }],
    operations: profiles.map((p) => ({ id: p.operation, entry: "service", callerTimeout: q(`run.${p.operation}.timeout`, horizon + 1, "us"), onCallerStop: "detach", idempotency: "read-only" })),
    arrivals: [{ id: "measured-trace", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: rows.at(-1)?.atUs ?? 0, provenance: "docs/reality/m2b-heldout-traces.json", rows } }],
    faults: [], horizon: q("run.horizon", horizon, "us"), sampleInterval: q("run.sample", sample, "us"),
    limits: { maxEvents: 1000000, maxSamples: 10000, maxRequests: Math.max(1, rows.length), maxRawResults: rows.length, maxTraceRows: 100000 } };
  return input;
}

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
export function calibrationReport(measurement: Measurement, traces: TraceMeasurement[]) {
  if (measurement.sourceHash !== createHash("sha256").update(readFileSync(resolve(root, "scripts/reality/controlled-service.mjs"))).digest("hex")) throw new Error("Measured application source changed; remeasure under a new profile version");
  const { fits, ledger } = candidateProfiles(measurement);
  const experiments = traces.map((trace) => {
    if (trace.software !== measurement.software || trace.environment !== measurement.environment) throw new Error("Held-out scenario context mismatch");
    const horizon = Math.ceil(Math.max(trace.elapsedUs, trace.intervalUs * trace.trace.length + trace.trace.length * Math.max(...fits.map((f) => f.profile.cpu.kind === "known" ? f.profile.cpu.value : NaN))) + 100000);
    const input = measuredInput(measurement, trace.trace, horizon, trace.intervalUs), model = createWorkloadModel2(input);
    const window = trace.intervalUs * trace.trace.length; model.advanceTo(window); const windowEvidence = model.evidence();
    model.advanceTo(horizon); const e = model.evidence();
    const byId = new Map(trace.results.map((r) => [r.id, r]));
    const pairs = e.results.map((r) => ({ predicted: r.responseUs, observed: byId.get(JSON.parse(r.rootId)[2])!.responseUs }));
    const error = pairs.map((p) => p.predicted - p.observed), observed = pairs.map((p) => p.observed), predicted = pairs.map((p) => p.predicted);
    const measuredWindowCompleted = trace.results.filter((r) => r.finishedUs <= window).length;
    const service = windowEvidence.resources[0]!;
    return { name: trace.name, factor: trace.factor, offeredRps: 1000000 / trace.intervalUs, offered: trace.trace.length,
      modelWindow: { completed: windowEvidence.counts.completed, queued: service.queued, active: service.serving, consumedCoreUs: service.consumedCoreUs, utilization: service.consumedCoreUs / window },
      measuredWindow: { completed: measuredWindowCompleted, pending: trace.trace.length - measuredWindowCompleted },
      fullDrain: { modelCompleted: e.counts.completed, measuredCompleted: trace.results.length, modelCpuCoreUs: e.resources[0]!.consumedCoreUs, measuredCpuCoreUs: trace.cpuCoreUs,
        cpuComparison: trace.cpuCoreUs > 0 ? { kind: "observed-discrepancy", relative: Math.abs(e.resources[0]!.consumedCoreUs - trace.cpuCoreUs) / trace.cpuCoreUs,
          limitation: "Process counter includes dispatcher overhead, unlike modeled service demand; not an isolated service CPU accuracy metric" }
          : { kind: "unknown", reason: "Zero process CPU delta despite completed CPU work; measurement invalid, no division or zero-demand inference" } },
      latency: { population: "all 80 authored arrivals, including intended-arrival-to-dispatch delay; no request omission", samples: pairs.length,
        maeUs: error.reduce((n, v) => n + Math.abs(v), 0) / pairs.length, rmseUs: Math.sqrt(error.reduce((n, v) => n + v * v, 0) / pairs.length),
        measuredMeanUs: observed.reduce((n, v) => n + v, 0) / pairs.length, modelMeanUs: predicted.reduce((n, v) => n + v, 0) / pairs.length,
        measuredMedianUs: percentile(observed, 0.5), modelMedianUs: percentile(predicted, 0.5), measuredP95Us: percentile(observed, 0.95), modelP95Us: percentile(predicted, 0.95),
        p99: "Unknown: fewer than 100 responses; no external tail inference" },
      validity: "Host/software/warm-worker/payload domain only; candidate mean-demand model; not cloud certification" };
  });
  return { schema: "infraforge-m2b-report/1", host: measurement.host, software: measurement.software, environment: measurement.environment, calibration: fits, ledger, policyLedger: WORKLOAD_POLICY_LEDGER,
    experiments, limits: ["Fit records and held-out records are independent batches on one host, not independent environments", "No fitted service variance, scheduler model or transport; queueing near saturation amplifies demand bias", "Trace dispatcher may wake late; latency includes that lateness rather than deleting arrivals", "One low-load Windows trace reported zero process CPU; it is explicitly invalid/Unknown. Other trace counters include dispatcher overhead", "No automatic candidate acceptance; held-out errors remain visible"] };
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  if (args.has("--measure")) {
    const measure = (config: unknown) => JSON.parse(execFileSync("node", [resolve(root, "scripts/reality/controlled-service.mjs"), JSON.stringify(config)], { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 }));
    const measurement: Measurement = measure({ mode: "batches" }); write("m2b-measurements.json", measurement);
    const fits = candidateProfiles(measurement).fits, mean = fits.reduce((n, f) => n + (f.profile.cpu.kind === "known" ? f.profile.cpu.value : NaN), 0) / fits.length;
    const baseInterval = Math.max(1, Math.round(mean * 0.75)), traces: TraceMeasurement[] = [];
    for (const factor of [1, 2, 0.5]) for (const name of ["light", "mix90", "heavy", "mix50"]) {
      const intervalUs = Math.round(baseInterval * factor), rows = Array.from({ length: 80 }, (_, i) => ({ id: `r${String(i).padStart(3, "0")}`, atUs: i * intervalUs, operation: name === "heavy" || (name === "mix90" && i % 10 === 9) || (name === "mix50" && i % 2 === 1) ? "heavy" : "light", payloadBytes: 64 }));
      traces.push({ name, factor, intervalUs, ...measure({ mode: "trace", rows }) });
      console.log(`Measured ${name}, interval ${intervalUs} us; ${traces.length}/12`);
    }
    write("m2b-heldout-traces.json", traces);
  }
  const report = calibrationReport(read("m2b-measurements.json"), read("m2b-heldout-traces.json"));
  if (args.has("--write") || args.has("--measure")) write("m2b-calibration.json", report);
  else if (JSON.stringify(read("m2b-calibration.json")) !== JSON.stringify(report)) throw new Error("Calibration artifact drift");
  console.log(JSON.stringify({ verified: true, profiles: report.calibration.map((f) => ({ id: f.profile.id, cpu: f.profile.cpu, fit: f.fit.meanAbsoluteRelativeError, holdout: f.holdout.meanAbsoluteRelativeError })), scenarios: report.experiments.length }));
}
