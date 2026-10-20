import { z } from "zod";
import { firstStackLimits as limits } from "@infraforge/contracts/first-stack";
import type { FirstStackSemantic, RecordedScheduleHeader, RecordedScheduleRow, ResolvedSchedule, ScheduleTransform } from "@infraforge/contracts/first-stack";
import { canonical, hash } from "./canonical";
import { requireCapability } from "../capabilities/policy";
import { createHash } from "node:crypto";

const id = z.string().min(1).max(256).refine(s => !Object.hasOwn(Object.prototype, s));
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const time = integer.max(limits.durationUs);
const headerSchema = z.object({ schema: z.literal("infraforge-first-stack-schedule/1"), unit: z.literal("us"),
  durationUs: time.positive(), origin: z.enum(["observed-recording", "authored-schedule"]), provenance: id }).strict();
const rowSchema = z.object({ id, atUs: time, operation: id, requestBytes: integer.optional(), responseBytes: integer.optional(),
  deadlineUs: time.positive().optional(), intendedAtUs: time.optional(), sentAtUs: time.optional(), generatorLost: z.boolean().optional() }).strict();
const parametersSchema = z.object({ schema: z.literal("infraforge-first-stack-parameters/1"),
  rows: z.array(z.object({ id, plan: id, keys: z.array(id).max(128), responseBytes: integer.optional() }).strict()).max(limits.rows) }).strict();
export const transformSchema = z.object({ schema: z.literal("infraforge-first-stack-transform/1"),
  timeScale: z.object({ numerator: integer.positive().max(1000), denominator: integer.positive().max(1000) }).strict(), shiftUs: time }).strict();
export const identityTransform: ScheduleTransform = { schema: "infraforge-first-stack-transform/1", timeScale: { numerator: 1, denominator: 1 }, shiftUs: 0 };
export class WorkloadRefusal extends Error {
  constructor(readonly code: string, readonly path: string, message: string) { super(message); }
}
function refuse(code: string, path: string, message: string): never { throw new WorkloadRefusal(code, path, message); }
const parsed = <T>(schema: z.ZodType<T>, value: unknown, path: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) return refuse("WORKLOAD_FIELD", path, result.error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join("; "));
  return result.data;
};
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// Byte/line caps apply while scanning, before UTF-8 decode, JSON.parse or row materialization.
// Nothing is persisted; a failed/cancelled import returns no partial schedule.
export async function resolveWorkload(chunks: AsyncIterable<Uint8Array>, options: {
  owner: string; sidecar: FirstStackSemantic; parameters: unknown; transform?: unknown; signal?: AbortSignal;
  capability?: typeof requireCapability;
}): Promise<ResolvedSchedule> {
  const capability = options.capability ?? requireCapability;
  // Preflight authorizes the bounded maximum; the second check uses resolved facts.
  capability(options.owner, { capability: "load.recorded.accept", bytes: limits.scheduleBytes, rows: limits.rows, durationSeconds: limits.durationUs / 1_000_000, scale: 1 });
  const cancelled = () => { if (options.signal?.aborted) refuse("IMPORT_CANCELLED", "schedule", "Import cancelled; no content saved."); };
  cancelled();
  // The HTTP adapter caps this serialized sidecar before JSON parsing as well.
  if (Buffer.byteLength(canonical(options.parameters)) > limits.parameterBytes) refuse("PARAMETER_BYTES", "parameters", "Parameter byte budget exceeded");
  const parameters = parsed(parametersSchema, options.parameters, "parameters");
  const transform = parsed(transformSchema, options.transform ?? identityTransform, "transform");
  const operationMap = new Map(options.sidecar.operations.map(o => [o.id, o]));
  const planMap = new Map(options.sidecar.database.plans.map(p => [p.id, p]));
  const dataset = new Set(options.sidecar.database.keys), ids = new Set<string>();
  let header: RecordedScheduleHeader | undefined, bytes = 0, lineNumber = 0, lineLength = 0, previous = -1;
  const rows: RecordedScheduleRow[] = [], line = new Uint8Array(limits.lineBytes);
  const normalizedContent = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const acceptLine = () => {
    lineNumber++;
    if (header && rows.length >= limits.rows) refuse("ROW_BUDGET", `line.${lineNumber}`, "Schedule row budget exceeded before parsing");
    let text: string;
    try { text = decoder.decode(line.subarray(0, lineLength)); }
    catch { return refuse("INVALID_UTF8", `line.${lineNumber}`, "Malformed UTF-8"); }
    if (text.endsWith("\r")) text = text.slice(0, -1);
    normalizedContent.update(text).update("\n");
    if (!text.length) refuse("EMPTY_LINE", `line.${lineNumber}`, "Empty JSONL lines are not supported");
    let value: unknown;
    try { value = JSON.parse(text); } catch { return refuse("INVALID_JSON", `line.${lineNumber}`, "Malformed JSON line"); }
    if (!header) { header = parsed(headerSchema, value, "header"); return; }
    const row = parsed(rowSchema, value, `line.${lineNumber}`);
    if (ids.has(row.id)) refuse("DUPLICATE_ID", row.id, "Duplicate schedule row ID");
    if (row.atUs < previous || row.atUs > header.durationUs) refuse("ROW_TIME", row.id, "Rows must be nondecreasing and within duration");
    if (!operationMap.has(row.operation)) refuse("UNKNOWN_OPERATION", row.id, "Operation has no reviewed application mapping");
    if ([row.intendedAtUs, row.sentAtUs].some(t => t !== undefined && t > header!.durationUs) || (row.generatorLost && row.sentAtUs !== undefined)) refuse("GENERATOR_TIMING", row.id, "Conflicting or out-of-range generator timing");
    rows.push(row); ids.add(row.id); previous = row.atUs;
  };
  for await (const chunk of chunks) {
    cancelled();
    if (!(chunk instanceof Uint8Array)) refuse("INPUT_TYPE", "schedule", "Expected UTF-8 byte chunks");
    bytes += chunk.byteLength;
    if (bytes > limits.scheduleBytes) refuse("SCHEDULE_BYTES", "schedule", "Schedule byte budget exceeded");
    for (const byte of chunk) {
      if (byte === 10) { acceptLine(); lineLength = 0; }
      else {
        if (lineLength === limits.lineBytes) refuse("LINE_BYTES", `line.${lineNumber + 1}`, "JSONL line byte budget exceeded");
        line[lineLength++] = byte;
      }
    }
    // Yield import work so HTTP disconnects and cancellation can be observed.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  cancelled();
  if (lineLength) acceptLine();
  if (!header) refuse("MISSING_HEADER", "header", "An explicit schedule header is required");
  if (!rows.length) refuse("EMPTY_SCHEDULE", "rows", "At least one offered row is required");
  rows.sort((a, b) => a.atUs - b.atUs || lexical(a.id, b.id));
  const parameterMap = new Map(parameters.rows.map(p => [p.id, p]));
  if (parameterMap.size !== parameters.rows.length || parameterMap.size !== rows.length || [...parameterMap.keys()].some(id => !ids.has(id))) refuse("PARAMETER_IDS", "parameters.rows", "Exactly one parameter mapping per schedule row is required");
  const distinctKeys = new Set<string>();
  const scale = (at: number) => {
    const product = BigInt(at) * BigInt(transform.timeScale.numerator), divisor = BigInt(transform.timeScale.denominator);
    if (product % divisor !== BigInt(0)) refuse("TRANSFORM_PRECISION", "transform", "Transform must retain integer microseconds");
    const result = Number(product / divisor) + transform.shiftUs;
    if (!Number.isSafeInteger(result) || result > limits.durationUs) refuse("TRANSFORM_BUDGET", "transform", "Transformed schedule exceeds the review horizon");
    return result;
  };
  const resolved = rows.map(row => {
    const op = operationMap.get(row.operation)!, p = parameterMap.get(row.id)!, plan = planMap.get(p.plan);
    if (p.plan !== op.plan || !plan) refuse("PARAMETER_PLAN", row.id, "Parameter plan must match the reviewed operation plan");
    if (new Set(p.keys).size !== p.keys.length || p.keys.some(k => Buffer.byteLength(k) > limits.keyBytes || !dataset.has(k))) refuse("PARAMETER_KEY", row.id, "Recorded keys must belong to the bounded dataset");
    if (op.kind === "cpu-control" ? p.keys.length !== 0 : op.kind === "range-read" ? p.keys.length < 1 : p.keys.length !== 1) refuse("PARAMETER_KEY", row.id, "Supply exact finite keys for this operation kind");
    if (plan.keys !== "recorded" && canonical(plan.keys) !== canonical(p.keys)) refuse("PARAMETER_KEY", row.id, "Recorded keys conflict with the fixed plan");
    p.keys.forEach(key => distinctKeys.add(key));
    const requestBytes = row.requestBytes ?? op.requestBytes, responseBytes = row.responseBytes ?? p.responseBytes ?? op.responseBytes;
    if (requestBytes === null || responseBytes === null) refuse("UNKNOWN_BYTES", row.id, "Missing bytes require an explicit conditional operation mapping");
    if (row.responseBytes !== undefined && p.responseBytes !== undefined && row.responseBytes !== p.responseBytes) refuse("CONFLICTING_BYTES", row.id, "Row and parameter response bytes conflict");
    if (row.deadlineUs !== undefined && row.deadlineUs !== op.deadlineUs) refuse("ROW_DEADLINE", row.id, "Conflicting per-row deadlines are unsupported");
    return { ...row, atUs: scale(row.atUs), ...(row.intendedAtUs !== undefined ? { intendedAtUs: scale(row.intendedAtUs) } : {}),
      ...(row.sentAtUs !== undefined ? { sentAtUs: scale(row.sentAtUs) } : {}), plan: p.plan, keys: [...p.keys],
      requestBytes: requestBytes!, responseBytes: responseBytes!, deadlineUs: op.deadlineUs };
  });
  if (distinctKeys.size > limits.keys) refuse("KEY_BUDGET", "parameters", "Distinct key budget exceeded");
  const canonicalParameters = { ...parameters, rows: [...parameters.rows].sort((a, b) => lexical(a.id, b.id)) };
  const scheduleHash = hash({ header, rows }), parametersHash = hash(canonicalParameters);
  if (options.sidecar.workload && (options.sidecar.workload.scheduleHash !== scheduleHash || options.sidecar.workload.parametersHash !== parametersHash)) refuse("WORKLOAD_REFERENCE", "workload", "Recording does not match the saved workload references");
  const body = { schema: "infraforge-first-stack-resolved/1" as const, header: { ...header, durationUs: scale(header.durationUs) },
    transform, scheduleHash, parametersHash, application: structuredClone(options.sidecar.application), rows: resolved,
    normalizedContentHash: normalizedContent.digest("hex"),
    executedScheduleHash: hash({ header: { ...header, durationUs: scale(header.durationUs) }, rows: resolved }),
    profileHash: hash({ profile: options.sidecar.profile, compiler: options.sidecar.compiler, application: options.sidecar.application,
      operations: [...options.sidecar.operations].sort((a, b) => lexical(a.id, b.id)), database: options.sidecar.database, ...(options.sidecar.schema === "infraforge-first-stack-sidecar/3" ? { cache: options.sidecar.cache } : {}) }),
    unknown: ["Physical timing calibration", ...(rows.some(r => r.sentAtUs === undefined) ? ["Missing observed send times"] : []),
      ...(rows.some(r => r.generatorLost === undefined) ? ["Missing generator loss observations"] : [])] };
  capability(options.owner, { capability: "load.recorded.accept", bytes, rows: rows.length, durationSeconds: body.header.durationUs / 1_000_000,
    scale: transform.timeScale.numerator / transform.timeScale.denominator });
  return { ...body, identity: hash(body) };
}

// Typed application input for a later execution bridge. No cycle/uniform fallback.
// LB/compute child work copies Invocation.message; this adapter supplies exact keys.
export function recordedApplicationInput(schedule: ResolvedSchedule, rowId: string) {
  const row = schedule.rows.find(row => row.id === rowId);
  if (!row) return refuse("UNKNOWN_ROW", rowId, "Unknown recorded row");
  return { kind: "first-stack-keyed/1" as const, plan: row.plan, keys: [...row.keys],
    ...(row.keys.length === 1 ? { key: row.keys[0]! } : {}),
    bodyBytes: { request: row.requestBytes, response: row.responseBytes } };
}
