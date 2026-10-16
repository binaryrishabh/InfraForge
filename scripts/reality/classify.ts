import type { NumericSite } from "./scan";
import type { RealityEntry } from "../../packages/simulation/src/reality/ledger";
import type { Unit } from "../../packages/simulation/src/reality/quantity";

export const AUDIT_SHA = "361a3b1afe33740d8f45d9c79601c6476657d602";
export function classify(site: NumericSite): RealityEntry {
  const { file, symbol, context } = site;
  let classification: RealityEntry["classification"] = "implementation-policy", unit: Unit = "code-number";
  let scope = "Application bookkeeping, presentation or operational guard; not infrastructure physics";
  let assumptions = ["This literal is not evidence of real infrastructure capacity or performance."];
  let replacement = "Retain as an implementation policy; separate from modeled infrastructure measurements.";
  if (/packages\/simulation\//.test(file)) {
    classification = "educational-assumption"; scope = "Published Model-1 engine behavior";
    assumptions = ["Fixed educational coefficients; no application benchmark or provider measurement establishes a universal value."];
    replacement = "M2: explicit service demand, capacity, queues and resource-specific state; require provenance or Unknown.";
    if (/capacity\.ts/.test(file)) unit = "requests/s";
    if (/cost\.ts/.test(file)) { classification = "approximation"; unit = symbol.includes("MONTHLY") ? "USD/month" : "code-number";
      replacement = "M2G: dated provider/region tariffs, billing units, minimums and explicit missing cost components."; }
    if (/DURATION|SECONDS|TICKS/.test(symbol)) unit = "seconds";
    if (/RPS_PER|QPS_PER/.test(symbol)) unit = "mixed";
    if (/DEGRADED_AT|SATURATED_AT|TARGET_CPU|SCALE_DOWN_AT|CPU_SPIKE_BOOST/.test(symbol)) unit = "percent";
    if (/CACHE_HIT_RATIO|FACTOR|MULTIPLIER|AMPLIFICATION|MAX_RETRY_BOOST/.test(symbol)) unit = "ratio";
    if (/MAX_LOAD_FRACTION|MAX_EFFECTIVE_LOAD|VM_WRITE_CPU_TAX/.test(symbol)) unit = "ratio";
    if (/PAYLOAD_KB/.test(symbol)) unit = "kB-label";
    if (/BANDWIDTH_CAPACITY_KBPS/.test(symbol)) unit = "kB/s";
    if (/MEMORY_LEAK_RATE|KBPS_PER_GBPS/.test(symbol)) unit = "mixed";
    if (/DB_POOL_PER|MAX_DB_CONNECTIONS|DEFAULT_MAX_CAP/.test(symbol)) unit = "count";
    if (/SPAWN_Y_GAP|spawnOrigin/.test(symbol)) { classification = "implementation-policy"; unit = "code-number"; scope = "Canvas layout, not physics"; }
    if (/engineHelpers/.test(file) && /mulberry32|round1/.test(symbol)) { classification = "implementation-policy"; unit = "code-number"; scope = "Replay RNG/rounding algorithm, not a measured stochastic process"; }
    if (/targetRps/.test(symbol) && [60, 3600].includes(site.value)) { classification = "derived"; unit = "seconds"; assumptions = ["Exact minute/hour conversion; workload rate itself is selected configuration."]; replacement = "Retain explicit unit conversions in M2."; }
    if (/engineRouting/.test(file)) { classification = "derived"; assumptions = ["Graph traversal, equal splitting and fixed read/miss/write fractions; no request completion, queue or path latency is calculated."]; }
    if ([0, 1].includes(site.value) && /length|\[0\]|Counter|hotTicks|coldTicks|inDegree|remainingTicks|const remaining|let monthlyTotal|let (cpu|stress|boost)|processed/.test(context)) {
      classification = "implementation-policy"; unit = "code-number"; scope = "Initialization, indexing, count arithmetic or discrete tick lifecycle";
    }
  } else if (/packages\/catalog\/src\/.+catalog\.ts/.test(file)) {
    scope = "Historical provider-labelled catalog snapshot 2026-08; field validity is independent";
    classification = /monthlyPriceUsd|maxConnections|networkGbps/.test(symbol) ? "approximation" : "unverified";
    unit = symbol.endsWith("vCpu") ? "cores" : symbol.endsWith("ramGb") ? "GB-label" : symbol.endsWith("monthlyPriceUsd") ? "USD/month" : symbol.endsWith("networkGbps") ? "Gbps" : symbol.endsWith("maxConnections") ? "count" : "ratio";
    assumptions = ["Repository snapshot is implementation provenance only; provider identity does not verify this exact field.", "No region/date/credit-mode/guaranteed-versus-burst contract is captured per field."];
    replacement = "M2G: verify each SKU field independently against a dated provider specification; separate limits, estimates and tariff terms.";
    if (symbol.startsWith("AWS_COMPUTE.") && symbol.endsWith("baselineFactor") && /baselineFactor: 0\.(40|60)/.test(context) && /t3\.(medium|large)/.test(context)) {
      classification = "obsolete"; assumptions.push("Published T3 per-vCPU baseline is 20% for medium and 30% for large; Model 1 stores 40%/60%. Preserve historical behavior.");
    }
  } else if (/workload|DeployDialog/.test(file)) {
    classification = "educational-assumption"; scope = "Selectable example workload/default or workload validation bound";
    assumptions = ["A preset becomes captured configuration when selected; it is not observed production demand."];
    replacement = "M2B: request classes and measured/configured service-demand profiles, explicit arrival model and assumptions.";
  } else if (/challenges\/definitions|challenges\/starter/.test(file)) {
    classification = "calibrated-model"; scope = "Immutable educational scenario, calibrated against Model 1 only";
    assumptions = ["Passing/failing engine fixtures establish educational behavior, not real cloud accuracy."];
    replacement = "Keep V1 immutable. Later M2K publishes newly calibrated Model-2 challenge versions.";
  } else if (/evidence|experimentTrace|challenges\/validate|comparison|reports/.test(file)) {
    classification = "implementation-policy"; scope = "Evidence retention, authoring, comparison or report presentation guard";
    assumptions = ["Bounds govern what can be claimed, not infrastructure capacity. Missing evidence remains unknown."];
    replacement = "Keep existing historical report semantics; design separate versioned M2 evidence with units/provenance.";
  } else if (/example|preset/i.test(file)) {
    classification = "educational-assumption"; scope = "Example architecture/configuration, including nonphysical layout coordinates";
    replacement = "Label examples as configuration; never infer provider capacity from layout or resource count alone.";
  } else if (/RESOURCE_PORTS|securityScan|CONNECTION_RULES|validation/.test(file)) {
    scope = "Default protocol ports, topology/readiness rules or limited static security checks";
    assumptions = ["Defaults are configurable conventions; static checks do not simulate firewalls, TLS or prove security."];
    replacement = "M2: explicit listener/protocol/reachability and security policy; retain static warnings separately.";
    if (/RESOURCE_PORTS|openPorts/.test(file + context)) unit = "port";
  }
  const internalProductSource = /apps\/backend\/internalModel2\/|apps\/backend\/release\/model2Schema|packages\/simulation\/src\/internalProduct/.test(file);
  const evidence: RealityEntry["provenance"] = [{ source: internalProductSource ? `workspace:${file}#L${site.line}` : `repo:${AUDIT_SHA}/${file}#L${site.line}`, supports: "implementation", detail: internalProductSource ? "Current internal product implementation policy; file identity is retained by this inventory. Not a cloud fact or Model-1 physical assumption." : "Exact historical literal and source expression; not external validation." }];
  if (file === "apps/backend/stages/costEstimation.stages.ts" && context.includes("GENERIC_MONTHLY_USD") && site.value === 10) {
    classification = "approximation"; unit = "USD/month"; scope = "Historical fallback price in deployment-time cost estimation";
    assumptions = ["Fallback estimate, not a documented provider tariff; runtime cost.ts contains the matching historical fallback."];
    replacement = "M2G: missing tariff remains Unknown; derive priced components from dated provider/service/region billing rules.";
  }
  if (classification === "obsolete") evidence.push({ source: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html", supports: "qualitative",
    detail: "Contradicts this stored coefficient: EC2 t3.medium/large baselines are 20%/30% per vCPU. Exact replacement facts are separately recorded in provider-facts.json; this source does not validate the stored value." });
  if (file.includes("apps/web/src/features/monitoring/store/") && /metrics|cpu|health|loadFraction|simulatedSeconds|burnRate|accumulatedCost/.test(symbol + context)) {
    classification = "placeholder"; scope = "Client initial/missing-snapshot defaults, not an infrastructure measurement";
    assumptions = ["Zero/initial values can be UI state without retained measurements; they do not establish measured zero usage."];
    replacement = "M2 evidence/UI must keep missing or stale measurements explicit; use Unknown instead of numeric substitution.";
  }
  if (classification === "calibrated-model") evidence.push({ source: "apps/backend/tests/challengeHarness.ts", supports: "exact", detail: "Deterministic starter/reference tests support scenario outcomes only, not physical accuracy." });
  if (classification === "implementation-policy") assumptions.push("Permitted only as nonphysical bookkeeping, UI or an explicit implementation guard; never an infrastructure performance claim.");
  return { id: site.id, concept: `${symbol || file.split("/").at(-1)} · literal ${site.text}`, modelVersion: "1", scope,
    quantity: { kind: "known", value: site.value, unit, provenance: [site.id] }, formula: context,
    classification, confidence: classification === "implementation-policy" ? "high" : classification === "calibrated-model" ? "conditional" : "low",
    provenance: evidence, assumptions, researchedOn: "2026-10-15", freeMode: classification === "implementation-policy" ? "conditional" : "forbidden", replacement };
}
