import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EventKernel } from "../../packages/simulation/src/model2/time";
import { connectionPool } from "../../packages/simulation/src/model2/network/pool";
import { networkLink } from "../../packages/simulation/src/model2/network/link";
import { NETWORK_POLICY_LEDGER } from "../../packages/simulation/src/model2/network/policy";
import type { Quantity, Unit } from "../../packages/simulation/src/reality/quantity";
import type { RealityEntry } from "../../packages/simulation/src/reality/ledger";

interface Configuration { id: string; rate: number; payload: number; reuse: boolean; pool: number; concurrency: number; holdout: boolean }
interface Observation { id: string; config: string; repeat: number; split: "fit" | "holdout"; configurationHoldout: boolean; operations: number; wallUs: number; throughput: number; created: number; acceptedConnections: number; connectsUs: number[]; requestBytes: number; responseBytes: number; results: Array<{ id: number; offeredUs: number; responseUs: number }> }
interface Campaign { schema: string; sourceHash: string; environment: string; host: Record<string, unknown>; date: string; configurations: Configuration[]; records: Observation[] }
export const readNetworkMeasurements = (): Campaign => JSON.parse(readFileSync(new URL("../../docs/reality/m2d-measurements.json", import.meta.url), "utf8"));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const q = <U extends Unit>(value: number, unit: U): Quantity<U> => ({ kind: "known", value, unit, provenance: ["calibration-only"] });
export function networkCalibration(data: Campaign) {
  const hash = createHash("sha256").update(readFileSync(new URL("./network-benchmark.mjs", import.meta.url))).digest("hex");
  if (data.schema !== "infraforge-network-observations/1" || data.sourceHash !== hash || createHash("sha256").update(JSON.stringify(data.host)).digest("hex") !== data.environment || new Set(data.records.map((r) => r.id)).size !== data.records.length || new Set(data.configurations.map((c) => c.id)).size !== data.configurations.length) throw new Error("Network measurement source/identity drift");
  for (const r of data.records) {
    const config = data.configurations.find((c) => c.id === r.config);
    if (!config || ![0, 1, 2].includes(r.repeat) || r.id !== `${config.id}/${r.repeat}` || r.configurationHoldout !== config.holdout || r.split !== (config.holdout || r.repeat === 2 ? "holdout" : "fit") || new Set(r.results.map((x) => x.id)).size !== 32 || r.results.some((x) => !Number.isInteger(x.id) || x.id < 0 || x.id >= 32)) throw new Error("Invalid network split/operation identity");
  }
  for (const r of data.records) if (r.operations !== 32 || r.results.length !== 32 || !r.connectsUs.length || r.created !== r.acceptedConnections || r.connectsUs.some((n) => !Number.isFinite(n) || n < 0) || r.results.some((x) => !Number.isFinite(x.responseUs) || x.responseUs < 0)) throw new Error("Invalid network observation");
  const fitting = data.records.filter((r) => r.split === "fit"), ledger: RealityEntry[] = [];
  if (fitting.some((r) => r.configurationHoldout || data.configurations.find((c) => c.id === r.config)!.holdout)) throw new Error("Network configuration holdout leakage");
  const candidates = data.configurations.filter((c) => !c.holdout).map((config) => {
    const rows = fitting.filter((r) => r.config === config.id); if (rows.length !== 2) throw new Error("Two fitting observations required per discrete point");
    const id = `m2d.local.establish.${config.id}`, value = Math.ceil(mean(rows.flatMap((r) => r.connectsUs)));
    const quantity: Quantity<"us"> = { kind: "known", value, unit: "us", provenance: [id] };
    ledger.push({ id, concept: "Conditional local socket establishment observation", modelVersion: "2", scope: "Owner-local paced loopback framing experiment only", validityDomain: `Exact ${hash}/${data.environment}/${config.id}`, quantity,
      formula: "Ceiling of mean connect-event duration from fitting repetitions only", classification: "calibrated-model", confidence: "conditional", provenance: [{ source: "docs/reality/m2d-measurements.json", supports: "exact", detail: rows.map((r) => r.id).join(", ") }],
      assumptions: ["Connect event includes runtime scheduling; not pure TCP handshake or propagation", "Whole-message pacer is authored; JS timer overhead and protocol costs are not fitted away", "No interpolation/extrapolation or cloud/WAN validity"], researchedOn: data.date.slice(0, 10), freeMode: "forbidden", replacement: "Remeasure changed software/environment/configuration" });
    return { configuration: config.id, establishUs: quantity, fitIds: rows.map((r) => r.id), validity: { sourceHash: hash, environment: data.environment, ...config }, physicalBandwidth: "Unknown", propagation: "Unknown", runtimeDispatchCost: "Unknown", freeMode: "forbidden" };
  });
  const experimentInputs = data.configurations.map((c) => {
    const values = { rate: [c.rate, "bytes/s"], request: [c.payload + 8, "bytes"], response: [c.payload * 2 + 8, "bytes"], connections: [c.pool, "count"], clientConcurrency: [c.concurrency, "count"], streams: [1, "count"], jobs: [32, "count"], injectedPropagation: [0, "us"] } as const;
    return { configuration: c.id, quantities: Object.fromEntries(Object.entries(values).map(([name, [value, unit]]) => {
      const id = `m2d.experiment.${c.id}.${name}`, quantity = { kind: "known" as const, value, unit, provenance: [id] };
      ledger.push({ ...ledger[0]!, id, concept: name, quantity, classification: "user-input", formula: "Explicit controlled experiment/model input; application framing bytes exclude protocol headers", validityDomain: `Exact logical pacer experiment ${hash}/${data.environment}/${c.id}`, provenance: [{ source: "scripts/reality/network-benchmark.mjs", supports: "implementation", detail: "Configured application pacer/pool/framing; zero injected delay does not identify physical propagation" }] });
      return [name, quantity];
    })) };
  });
  for (const [name, value, unit] of [["events", 100000, "count"], ["buffer", 100000000, "bytes"], ["virtualBound", 100000000, "us"]] as const) {
    const id = `m2d.calibration.policy.${name}`;
    ledger.push({ ...ledger[0]!, id, concept: name, quantity: { kind: "known", value, unit, provenance: [id] }, classification: "implementation-policy", confidence: "high", formula: "Bound this finite mechanism replay; not a network capacity/timeout fact" });
  }
  for (const [name, unit] of [["physicalBandwidth", "bytes/s"], ["propagation", "us"], ["dispatchCost", "us"]] as const) {
    const id = `m2d.unknown.${name}`;
    ledger.push({ ...ledger[0]!, id, concept: name, quantity: { kind: "unknown", unit, provenance: [id], reason: "Loopback framing/pacer observations do not identify this physical/runtime component" }, classification: "unknown", confidence: "unknown", formula: "Unidentified; no zero substitution or fitted residual constant" });
  }
  const results = data.records.map((r) => {
    const config = data.configurations.find((c) => c.id === r.config)!, candidate = candidates.find((p) => p.configuration === config.id);
    const establish = candidate ? candidate.establishUs.value : Math.ceil(mean(candidates.map((p) => p.establishUs.value)));
    const kernel = new EventKernel(100000), out = networkLink({ id: "out", from: "client", to: "echo", policy: "fifo-message/1", bandwidth: q(config.rate, "bytes/s"), propagation: q(0, "us"), bufferBytes: q(100000000, "bytes") }, kernel);
    const incoming = networkLink({ id: "in", from: "echo", to: "client", policy: "fifo-message/1", bandwidth: q(config.rate, "bytes/s"), propagation: q(0, "us"), bufferBytes: q(100000000, "bytes") }, kernel);
    const pool = connectionPool("echo", { mode: "serial", reuse: config.reuse, maxConnections: q(config.pool, "count"), streams: q(1, "count"), pending: q(32, "count"), establish: q(establish, "us"), acquireTimeout: q(100000000, "us"), connectTimeout: q(100000000, "us"), responseTimeout: q(100000000, "us"), remoteCancellation: "detach" }, kernel, () => true);
    const modeled: Array<{ id: number; responseUs: number; at: number }> = []; let issued = 0;
    const offer = () => {
      if (issued >= 32) return; const id = issued++, start = kernel.now;
      pool.acquire(String(id), (lease) => out.transmit(`out:${id}`, config.payload + 8, () => incoming.transmit(`in:${id}`, config.payload * 2 + 8, () => {
        modeled.push({ id, responseUs: kernel.now - start, at: kernel.now }); lease.release(); offer();
      })), (reason) => { throw new Error(`Calibration pool failure: ${reason}`); });
    };
    for (let i = 0; i < config.concurrency; i++) offer(); kernel.advanceTo(100000000);
    if (modeled.length !== 32 || out.measure().deliveredBytes !== r.requestBytes || incoming.measure().deliveredBytes !== r.responseBytes) throw new Error("Measured/model application bytes or outcomes differ");
    const elapsed = Math.max(...modeled.map((x) => x.at)), modelThroughput = 32000000 / elapsed;
    const errors = modeled.map((x) => x.responseUs - r.results.find((v) => v.id === x.id)!.responseUs);
    return { id: r.id, configuration: config.id, split: r.split, configurationHoldout: r.configurationHoldout, claim: candidate ? "discrete conditional socket-duration point; shaper mechanism comparison" : "unsupported establishment transfer; diagnostic only",
      measuredThroughput: r.throughput, modelThroughput, throughputRelativeError: Math.abs(modelThroughput - r.throughput) / r.throughput,
      measuredMeanResponseUs: mean(r.results.map((x) => x.responseUs)), modelMeanResponseUs: mean(modeled.map((x) => x.responseUs)), responseMaeUs: mean(errors.map(Math.abs)), responseRmseUs: Math.sqrt(mean(errors.map((n) => n * n))),
      measuredConnections: r.created, modelConnections: pool.measure().created, requestBytes: out.measure().deliveredBytes, responseBytes: incoming.measure().deliveredBytes };
  });
  const summaries = ["fit", "holdout"].map((split) => { const rows = results.filter((r) => r.split === split); return { split, batches: rows.length, throughputMARE: mean(rows.map((r) => r.throughputRelativeError)), responseMAEUs: mean(rows.map((r) => r.responseMaeUs)) }; });
  return { schema: "infraforge-network-calibration/1", sourceHash: hash, environment: data.environment,
    scope: "Logical application-message pacer/connection pipeline only; zero injected logical propagation is not measured zero physical delay; visible runtime/timer/protocol residuals are not a fitted latency constant", acceptance: "Complete real networking predictor rejected; conditional establishment observations only; all profiles remain internal", candidates, experimentInputs, ledger, policyLedger: NETWORK_POLICY_LEDGER, summaries, results };
}
if (import.meta.main) {
  const report = networkCalibration(readNetworkMeasurements()), file = new URL("../../docs/reality/m2d-calibration.json", import.meta.url);
  if (process.argv.includes("--write")) writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  else if (JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) !== JSON.stringify(report)) throw new Error("Network calibration artifact drift");
  console.log(JSON.stringify({ verified: true, candidates: report.candidates.length, summaries: report.summaries }));
}
