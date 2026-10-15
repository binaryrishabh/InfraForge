import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createComputeModel2 } from "../../packages/simulation/src/model2/compute/run";
import type { ComputeInput, ComputeProfile } from "../../packages/simulation/src/model2/compute/contracts";
import type { Quantity, Unit } from "../../packages/simulation/src/reality/quantity";
import type { RealityEntry } from "../../packages/simulation/src/reality/ledger";
import { COMPUTE_POLICY_LEDGER } from "../../packages/simulation/src/model2/compute/policy";

interface Observation { id: string; workers: number; mix: string; repeat: number; split: "fit" | "holdout"; configurationHoldout: boolean; operations: number; cpuCoreUs: number; wallUs: number; achievedPerSecond: number; results: Array<{ id: number; operation: string; responseUs: number; serviceWallUs: number }> }
interface Config { sourceHash: string; date: string; environment: string; workers: number; host: { logicalProcessors: number; availableParallelism: number }; records: Observation[] }
interface Campaign { cpu: Config[]; memory: unknown[] }
const path = new URL("../../docs/reality/m2c-measurements.json", import.meta.url);
export const readComputeMeasurements = (): Campaign => JSON.parse(readFileSync(path, "utf8"));
const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function computeCalibration(data: Campaign) {
  const sourceHash = createHash("sha256").update(readFileSync(new URL("./compute-benchmark.mjs", import.meta.url))).digest("hex");
  if (!data.cpu.length || data.cpu.some((c) => c.sourceHash !== sourceHash || c.environment !== data.cpu[0]!.environment)) throw new Error("Compute benchmark source/environment drift");
  const all = data.cpu.flatMap((c) => c.records);
  for (const r of all) if (r.operations !== r.results.length || r.operations !== 128 || !Number.isFinite(r.cpuCoreUs) || r.cpuCoreUs <= 15625 || r.results.some((v) => !Number.isFinite(v.responseUs) || v.responseUs < 0)) throw new Error("Invalid measured compute observation");
  const fit = all.filter((r) => r.split === "fit"), fitIds = new Set(fit.map((r) => r.id));
  if (all.filter((r) => r.split === "holdout").some((r) => fitIds.has(r.id))) throw new Error("Compute fit/holdout leakage");
  const fitted = data.cpu.filter((c) => !c.records[0]!.configurationHoldout).flatMap((c) => ["light", "heavy"].map((operation) => {
    const records = fit.filter((r) => r.workers === c.workers && r.mix === operation);
    if (records.length !== 2) throw new Error("Two fitting repetitions required at each calibrated point");
    return { workers: c.workers, operation, cpuCoreUs: records.reduce((sum, r) => sum + r.cpuCoreUs, 0) / records.reduce((sum, r) => sum + r.operations, 0), fitIds: records.map((r) => r.id) };
  }));
  const candidates: ComputeProfile[] = [], ledger: RealityEntry[] = [];
  const results = all.map((record) => {
    const config = data.cpu.find((c) => c.workers === record.workers)!, localLedger: RealityEntry[] = [];
    const q = <U extends Unit>(id: string, value: number, unit: U, classification: RealityEntry["classification"] = "user-input"): Quantity<U> => {
      const quantity: Quantity<U> = { kind: "known", value, unit, provenance: [id] };
      localLedger.push({ id, concept: id, modelVersion: "2", scope: "Host-specific warm PBKDF2 worker-pool experiment; never a cloud SKU", validityDomain: `Exact ${config.environment}/${sourceHash}; finite burst of 128; workers=${record.workers}`, quantity,
        formula: classification === "calibrated-model" ? "Aggregate fitting process CPU / completed fitting operations at this worker count" : "Explicit experiment/scheduler applicability input; no universal hardware claim", classification, confidence: "conditional",
        provenance: [{ source: "docs/reality/m2c-measurements.json", supports: "exact", detail: `Observation ${record.id}; CPU means exclude all holdout data` }], assumptions: ["CPU capacity is an authored accounting-unit hypothesis, not physical-core equivalence", "No automatic interpolation across worker counts or allocation-to-RSS mapping"], researchedOn: config.date.slice(0, 10), freeMode: "forbidden", replacement: "Remeasure changed software/environment; unsupported configurations remain Unknown" });
      return quantity;
    };
    const unknown = (id: string): Quantity<"bytes"> => {
      const quantity: Quantity<"bytes"> = { kind: "unknown", unit: "bytes", provenance: [id], reason: "RSS observations do not identify this modeled resident component" };
      localLedger.push({ ...localLedger[0]!, id, concept: id, quantity, classification: "unknown", confidence: "unknown", formula: quantity.reason }); return quantity;
    };
    const capacity = Math.min(config.host.availableParallelism, config.host.logicalProcessors);
    q("compute.capacity", capacity, "cores");
    const profiles = ["light", "heavy"].map((operation): ComputeProfile => {
      const point = fitted.find((p) => p.workers === record.workers && p.operation === operation);
      const value = point?.cpuCoreUs ?? average(fitted.filter((p) => p.operation === operation).map((p) => p.cpuCoreUs));
      const prefix = `m2c.${record.workers}.${operation}`;
      const profile: ComputeProfile = { schema: "infraforge-compute-demand/1", id: prefix, version: "1", application: "controlled-worker-pbkdf2-v1", operation, stage: "compute", method: point ? "fitted" : "synthetic",
        cpu: q(`${prefix}.cpu`, value, "cpu-us", point ? "calibrated-model" : "approximation"), blockingWait: q(`${prefix}.blocking`, 0, "us"), maxCpuParallelism: q(`${prefix}.parallelism`, 1, "cores", "derived"),
        residentCoverage: "partial", requestResidentBytes: unknown(`${prefix}.requestResident`), activeResidentBytes: unknown(`${prefix}.activeResident`), obtainedBy: point ? "Conditional mean at a discrete fitting configuration" : "Explicit validation-only constant-demand transfer hypothesis; not a calibrated point",
        evidence: point ? point.fitIds : fitted.filter((p) => p.operation === operation).flatMap((p) => p.fitIds), date: config.date.slice(0, 10),
        validity: { exact: { software: sourceHash, environment: config.environment, experiment: "warm-burst-128", claim: point ? "discrete-fit-point" : "unsupported-transfer-hypothesis" }, ranges: {} },
        uncertainty: ["Process CPU includes coordinator/runtime overhead and coarse Windows counters", "No per-request CPU distribution or SMT/frequency attribution", "Only discrete worker-count candidates; this experiment does not certify other mixtures, hosts or rates"], freeMode: "forbidden" };
      // A point restriction has its own ledger bound; no broad range implies interpolation.
      for (const [key, unit, n] of [["workers", "count", record.workers], ["cores", "cores", capacity], ["payloadBytes", "bytes", 64]] as const) {
        const id = `${prefix}.domain.${key}`, range = { unit, min: n, max: n, provenance: [id] };
        q(id, n, unit, "derived"); localLedger.at(-1)!.quantity = { kind: "range", ...range }; profile.validity.ranges[key] = range;
      }
      return profile;
    });
    const input: ComputeInput = { modelVersion: "2", workloadVersion: "m2c/1", seed: "measured-compute", ledger: localLedger, profiles,
      resources: [{ id: "app", kind: "compute", scheduler: "capped-equal-fluid/1", cores: q("run.cores", capacity, "cores"), workers: q("run.workers", record.workers, "count"), queueCapacity: q("run.queue", 128, "count"), cancellation: "unsupported", profiles: { light: profiles[0]!.id, heavy: profiles[1]!.id }, context: { labels: profiles[0]!.validity.exact, quantities: { payloadBytes: q("run.payload", 64, "bytes") } },
        memory: { coverage: "partial", baseline: unknown("run.baseline"), perWorker: unknown("run.perWorker"), retained: unknown("run.retained"), policy: "observe" } }],
      operations: ["light", "heavy"].map((id) => ({ id, entry: "app", onCallerStop: "detach", idempotency: "read-only", callerTimeout: q(`run.${id}.timeout`, 100000000, "us") })),
      arrivals: [{ id: "burst", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 0, provenance: `docs/reality/m2c-measurements.json#${record.id}`, rows: record.results.map((r) => ({ id: String(r.id).padStart(3, "0"), atUs: 0, operation: r.operation, payloadBytes: 64 })) } }],
      faults: [], interventions: [], horizon: q("run.horizon", 10000000, "us"), sampleInterval: q("run.sample", 1000000, "us"), limits: { maxEvents: 100000, maxSamples: 100, maxRequests: 128, maxRawResults: 128, maxTraceRows: 128 } };
    const m = createComputeModel2(input); m.advanceTo(m.horizon); const e = m.evidence();
    if (e.counts.completed !== 128) throw new Error("Measured compute replay did not drain");
    const modelElapsed = Math.max(...e.results.map((r) => r.at));
    const errors = e.results.map((r) => r.responseUs - record.results[Number(JSON.parse(r.rootId)[2])]!.responseUs);
    const modelCpu = e.resources[0]!.compute!.cpu.appCoreUs;
    if (record.split === "fit" && record.mix === "light" && record.repeat === 0) { candidates.push(...profiles); ledger.push(...localLedger.filter((v) => v.id.startsWith("m2c."))); }
    return { id: record.id, workers: record.workers, mix: record.mix, split: record.split, configurationHoldout: record.configurationHoldout, modelClaim: record.configurationHoldout ? "unsupported-transfer-hypothesis; numerical experiment only" : "discrete-point conditional mean",
      measuredThroughput: record.achievedPerSecond, modelThroughput: 128000000 / modelElapsed, throughputRelativeError: Math.abs(128000000 / modelElapsed - record.achievedPerSecond) / record.achievedPerSecond,
      measuredCpuCoreUs: record.cpuCoreUs, modelCpuCoreUs: modelCpu, cpuRelativeError: Math.abs(modelCpu - record.cpuCoreUs) / record.cpuCoreUs,
      measuredMeanResponseUs: average(record.results.map((r) => r.responseUs)), modelMeanResponseUs: average(e.results.map((r) => r.responseUs)), latencyMaeUs: average(errors.map(Math.abs)), latencyRmseUs: Math.sqrt(average(errors.map((v) => v * v))), modeledResident: e.resources[0]!.compute!.memory.totalResidentBytes.kind };
  });
  return { schema: "infraforge-compute-calibration/1", sourceHash, environment: data.cpu[0]!.environment, fitted, candidates, ledger, policyLedger: COMPUTE_POLICY_LEDGER, results,
    summaries: ["fit", "holdout"].map((split) => { const group = results.filter((r) => r.split === split); return { split, cases: group.length, throughputMARE: average(group.map((r) => r.throughputRelativeError)), cpuMARE: average(group.map((r) => r.cpuRelativeError)), meanLatencyMaeUs: average(group.map((r) => r.latencyMaeUs)) }; }),
    validationGroups: [false, true].map((configurationHoldout) => { const rows = results.filter((r) => r.split === "holdout" && r.configurationHoldout === configurationHoldout); return { kind: configurationHoldout ? "unseen-worker-configuration-transfer-hypothesis" : "held-out-repetition-or-mix-at-discrete-worker-point", cases: rows.length, throughputMARE: average(rows.map((r) => r.throughputRelativeError)), cpuMARE: average(rows.map((r) => r.cpuRelativeError)), latencyMaeUs: average(rows.map((r) => r.latencyMaeUs)) }; }),
    serviceVariation: { kind: "unknown", reason: "Observed per-call wall variation includes scheduling/preemption/IPC; coarse process CPU batches do not identify per-call CPU demand variance" },
    memoryCalibration: { kind: "unknown", reason: "Explicit buffer bytes and ownership measured; resident baseline/per-worker/request mapping is not identified by noisy global RSS" },
    acceptance: "Internal candidates only at discrete fitting worker points; held-out worker counts remain unsupported, their transfer-hypothesis errors are retained. No cloud/general scaling claim." };
}
if (import.meta.main) {
  const report = computeCalibration(readComputeMeasurements()), output = new URL("../../docs/reality/m2c-calibration.json", import.meta.url);
  if (process.argv.includes("--write")) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  else if (JSON.stringify(JSON.parse(readFileSync(output, "utf8"))) !== JSON.stringify(report)) throw new Error("Compute calibration artifact drift");
  console.log(JSON.stringify({ verified: true, points: report.fitted, summaries: report.summaries }));
}
