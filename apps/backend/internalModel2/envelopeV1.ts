import { z } from "zod";
import { boundedProduct, compileProduct, canonical, requireKnown } from "@infraforge/simulation/internal-product";
import type { ProductContract, SavedProductDesign, CompiledProduct, MeteringConfig, Diagnostic } from "@infraforge/simulation/internal-product";
import { LayoutSchema } from "../zod_schemas/layout.schema";
import { WorkloadProfileSchema } from "../zod_schemas/deployment.schema";
import { contentHash, executionSource } from "./identity";
import { INTERNAL_LIMITS as limits, jsonBytes } from "./budgets";
import { compatibleV1Source } from "./legacyCompatibility";

export const admissionSchema = z.object({ infrastructureId: z.uuid(), idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  expectedDesignUpdatedAt: z.iso.datetime(), workload: WorkloadProfileSchema.extend({ readWriteRatio: z.number().min(0).max(1) }).strict(), contract: z.unknown() }).strict();
export class CompilationRefusal extends Error { constructor(readonly diagnostics: Diagnostic[]) { super("Internal Model-2 contract refused"); } }
export interface ExecutionEnvelope {
  schema: "infraforge-internal-execution/1"; runId: string; ownerId: string; infrastructureId: string; designUpdatedAt: string;
  source: string; design: SavedProductDesign; contract: ProductContract; compiled: CompiledProduct; compiledHash: string; metering: MeteringConfig; fingerprint: string;
}
function refusal(code: string, path: string, message: string): never { throw new CompilationRefusal([{ code, path, message, severity: "error" }]); }
export function compileEnvelope(runId: string, ownerId: string, layout: unknown, updatedAt: Date, request: z.infer<typeof admissionSchema>): ExecutionEnvelope {
  try { boundedProduct(request); jsonBytes(request, limits.requestBytes); }
  catch (error) { refusal("INPUT_BUDGET", "contract", error instanceof Error ? error.message : "Input budget exceeded"); }
  try { boundedProduct(layout); jsonBytes(layout, limits.requestBytes); }
  catch { refusal("SAVED_DESIGN_BUDGET", "design", "Saved layout exceeds the internal structural/text/byte budget"); }
  // JSONB does not preserve object-key order. Compile the canonical authored
  // contract so provenance traversal reconstructs identically after persistence.
  const parsed = LayoutSchema.safeParse(layout);
  if (!parsed.success) refusal("SAVED_DESIGN_INVALID", "design", "Saved infrastructure layout is invalid");
  const saved = parsed.data, contract = canonical(request.contract) as ProductContract;
  if (!contract || typeof contract !== "object") refusal("CONTRACT_REQUIRED", "contract", "Supply a complete versioned application/infrastructure contract");
  if (contract.capabilities?.length) refusal("PROVIDER_SCOPE", "contract.capabilities", "Provider capability/price bindings are excluded from this authored internal slice");
  const objectNode = saved.resources.find((r) => r.type === "Object Storage"), objectConfig = objectNode && contract.nodes?.[objectNode.id]?.resources?.[0]?.config;
  if (objectConfig?.kind === "object-store" && objectConfig.capacity === undefined) refusal("CAPACITY_REQUIRED", "contract.nodes", "Object storage requires an explicit authored byte capacity");
  const design: SavedProductDesign = { schema: "infraforge-saved-design/1", resources: saved.resources, connections: saved.connectionLines, workload: request.workload };
  if (design.resources.length !== 2 || design.resources.filter((r) => r.type === "Virtual Machine").length !== 1 || design.resources.filter((r) => r.type === "Object Storage").length !== 1)
    refusal("INTERNAL_SCOPE", "resources", "This internal slice requires exactly one Virtual Machine and one Object Storage node; other resource compositions are refused");
  for (const r of design.resources) if (["skuId", "size", "region", "public", "encryption", "openPorts", "autoscaling"].some((key) => key in r)) refusal("UNSUPPORTED_CONTROL", `resources.${r.id}`, "SKU, region, legacy security, size and autoscaling controls are outside this internal scope; supply explicit authored resource/listener contracts");
  if (!contract.limits || contract.limits.maxEvents > limits.events || contract.limits.maxRequests > limits.requests || contract.limits.maxSamples > limits.samples || contract.limits.maxRawResults > limits.requests || contract.limits.maxTraceRows > limits.requests)
    refusal("EXECUTION_BUDGET", "contract.limits", "Explicit bounded limits are required: events ≤10000, requests/raw/trace ≤256, samples ≤64");
  if (!Array.isArray(contract.commands) || contract.commands.length > limits.commands || !Array.isArray(contract.faults) || contract.faults.length > 1 || contract.faults.some((f) => f.kind !== "Crash" || f.profile !== "retain-logical-state/1" || !design.resources.some((r) => r.id === f.target && r.type === "Object Storage")))
    refusal("SCHEDULE_SCOPE", "contract", "At most 16 recorded commands and one retained-logical-object crash are supported; other faults are refused");
  const compiled = compileProduct(design, contract);
  if (!compiled.ok) throw new CompilationRefusal(compiled.diagnostics);
  const horizon = requireKnown(contract.horizon, "us");
  if (horizon > limits.horizonUs || compiled.value.input.resources.length !== 2 || compiled.value.pools.length || compiled.value.input.paths.length > 4 || compiled.value.input.links.length > 8)
    refusal("MATERIALIZED_SCOPE", "compiled", "Bounded two-station internal execution required; horizon ≤1000000 us, no pool/auxiliary expansion");
  const vm = design.resources.find((r) => r.type === "Virtual Machine")!, objects = design.resources.find((r) => r.type === "Object Storage")!;
  if (compiled.value.input.operations.some((o) => o.entry !== vm.id) || compiled.value.input.resources.some((r) => r.kind === "compute" && r.downstream) || compiled.value.input.systems.commands.some((c) => c.source !== vm.id || c.target !== objects.id))
    refusal("APPLICATION_SCOPE", "contract", "This slice runs standalone VM application CPU and separate recorded VM-to-object commands; other application mappings are refused");
  const compiledHash = contentHash(compiled.value);
  const metering: MeteringConfig = { schema: "infraforge-usage-metering/1", run: runId, epoch: "execution-1", inputFingerprint: compiledHash,
    provenance: ["Internal product run: actual modeled commands, current objects and directed payload; no physical/cloud billing claim"],
    objects: compiled.value.input.resources.filter((r) => r.kind === "object-store").map((r) => r.id), links: compiled.value.input.links.map((l) => l.id),
    maxRecords: limits.records, maxFields: limits.fields, maxTextCharacters: limits.textCharacters };
  const body = { schema: "infraforge-internal-execution/1" as const, runId, ownerId, infrastructureId: request.infrastructureId, designUpdatedAt: updatedAt.toISOString(), source: executionSource, design, contract, compiled: compiled.value, compiledHash, metering };
  const envelope = canonical({ ...body, fingerprint: contentHash(body) }); captureCuts(envelope);
  try { jsonBytes(envelope, limits.inputBytes); } catch { refusal("PERSISTENCE_BUDGET", "envelope", "Compiled execution envelope exceeds the internal persistence budget"); }
  return envelope;
}
export function readEnvelope(value: unknown, expected: string, compatible = true): ExecutionEnvelope {
  boundedProduct(value); jsonBytes(value, limits.inputBytes);
  const envelope = canonical(value) as ExecutionEnvelope, { fingerprint, ...body } = envelope;
  if (fingerprint !== expected || contentHash(body) !== fingerprint) throw Error("Recorded input content is missing or corrupt");
  if (envelope.schema !== "infraforge-internal-execution/1") throw Error("Unsupported historical input version; no reinterpretation");
  if (envelope.design?.resources.length !== 2 || envelope.design.resources.filter(r => r.type === "Virtual Machine").length !== 1 || envelope.design.resources.filter(r => r.type === "Object Storage").length !== 1 || envelope.compiled?.input.resources.length !== 2 || envelope.compiled.input.resources.some(r => r.kind === "compute" && r.downstream)) throw Error("Historical v1 topology is incompatible; connected execution requires v2");
  if (compatible && !compatibleV1Source(envelope.source, executionSource)) throw Error("Historical execution source is incompatible with this runtime");
  if (compatible) {
    const current = compileProduct(envelope.design, envelope.contract);
    if (!current.ok || contentHash(current.value) !== envelope.compiledHash || contentHash(envelope.compiled) !== envelope.compiledHash) throw Error("Historical compilation is incompatible or corrupt");
  }
  return envelope;
}
export function captureCuts(envelope: Pick<ExecutionEnvelope, "contract">) {
  const horizon = requireKnown(envelope.contract.horizon, "us"), cuts = new Set([0, horizon]);
  for (let i = 1; i < 16; i++) cuts.add(Math.ceil(horizon * i / 16));
  for (const f of envelope.contract.faults) { const at = requireKnown(f.at, "us"), end = at + requireKnown(f.duration, "us"); cuts.add(at); cuts.add(end); cuts.add(end + requireKnown(f.restart!, "us")); }
  const ordered = [...cuts].filter((at) => at <= horizon).sort((a, b) => a - b);
  if (ordered.length > limits.captures) throw Error("Capture budget exceeded"); return ordered;
}
