import { boundedProduct, canonical, compileProduct, requireKnown } from "@infraforge/simulation/internal-product";
import type { ProductContract, SavedProductDesign } from "@infraforge/simulation/internal-product";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { contentHash, executionSource } from "./identity";
import { INTERNAL_LIMITS as limits, jsonBytes } from "./budgets";
import { CompilationRefusal, captureCuts, admissionSchema as v1Admission } from "./envelopeV1";
import type { ExecutionEnvelope } from "./envelopeV1";
import { causalLimits, CONNECTED_PROFILE, connectedRefusal, qualifyConnected, qualifyMaterialized } from "./connectedScope";
import type { CausalLimits } from "./connectedScope";
import type { z } from "zod";
export { causalLimits };
export interface ExecutionEnvelopeV2 extends Omit<ExecutionEnvelope, "schema"> {
  schema: "infraforge-internal-execution/2"; causal: CausalLimits;
}
export function compileEnvelopeV2(runId: string, ownerId: string, layout: unknown, updated: Date, request: z.infer<typeof v1Admission> & { execution?: "infraforge-internal-execution/2"; causal?: CausalLimits }): ExecutionEnvelopeV2 {
  try { boundedProduct(request); boundedProduct(layout); jsonBytes(request, limits.requestBytes); jsonBytes(layout, limits.requestBytes); }
  catch { connectedRefusal("input", "Request or saved design exceeds the existing structural/byte budget"); }
  const parsed = LayoutSchema.safeParse(layout), retention = causalLimits.safeParse(request.causal);
  if (!parsed.success || !retention.success) connectedRefusal("input", "Valid saved design and explicit bounded causal retention limits required");
  const contract = canonical(request.contract) as ProductContract;
  if (contract?.version !== CONNECTED_PROFILE) connectedRefusal("contract.version", "Execution v2 requires bounded-connected-web/1");
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: parsed.data.resources, connections: parsed.data.connectionLines, workload: request.workload };
  const topology = qualifyConnected(design, contract), l = contract.limits;
  if (!l || l.maxEvents > limits.events || l.maxRequests > 32 || l.maxRawResults > 256 || l.maxTraceRows > 32 || l.maxSamples > limits.samples || requireKnown(contract.horizon, "us") > limits.horizonUs) connectedRefusal("limits", "Existing event/sample/horizon bounds, at most 32 caller rows and 256 raw engine rows");
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw new CompilationRefusal(compiled.diagnostics);
  qualifyMaterialized(compiled.value, topology);
  const compiledHash = contentHash(compiled.value);
  const body = { schema: "infraforge-internal-execution/2" as const, runId, ownerId, infrastructureId: request.infrastructureId, designUpdatedAt: updated.toISOString(), source: executionSource, design, contract, compiled: compiled.value, compiledHash, causal: retention.data,
    metering: { schema: "infraforge-usage-metering/1" as const, run: runId, epoch: "execution-1", inputFingerprint: compiledHash, provenance: ["Authored connected logical execution; physical capacity, durability and provider billing Unknown"], objects: [], links: compiled.value.input.links.map(l => l.id), maxRecords: limits.records, maxFields: limits.fields, maxTextCharacters: limits.textCharacters } };
  const envelope = canonical({ ...body, fingerprint: contentHash(body) }); captureCuts(envelope); jsonBytes(envelope, limits.inputBytes); return envelope;
}
export function readEnvelopeV2(value: unknown, expected: string, compatible = true): ExecutionEnvelopeV2 {
  boundedProduct(value); jsonBytes(value, limits.inputBytes);
  const e = canonical(value) as ExecutionEnvelopeV2, { fingerprint, ...body } = e;
  if (e.schema !== "infraforge-internal-execution/2" || fingerprint !== expected || contentHash(body) !== fingerprint || e.contract?.version !== CONNECTED_PROFILE || !causalLimits.safeParse(e.causal).success) throw Error("Recorded v2 input is corrupt or incompatible");
  if (compatible) {
    if (e.source !== executionSource) throw Error("Historical v2 execution source is incompatible");
    const rebuilt = compileEnvelopeV2(e.runId, e.ownerId, { resources: e.design.resources, connectionLines: e.design.connections }, new Date(e.designUpdatedAt), { infrastructureId: e.infrastructureId, idempotencyKey: "reconstruction", expectedDesignUpdatedAt: e.designUpdatedAt, workload: v1Admission.shape.workload.parse(e.design.workload), contract: e.contract, execution: e.schema, causal: e.causal });
    if (rebuilt.fingerprint !== fingerprint) throw Error("Recorded v2 compilation is corrupt or incompatible");
  }
  return e;
}
