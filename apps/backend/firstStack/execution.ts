import { z } from "zod";
import type { ResolvedSchedule } from "@infraforge/contracts/first-stack";
import { firstStackLimits as limits } from "@infraforge/contracts/first-stack";
import { compileFirstStack, createFirstStackRuntime, FirstStackCompileRefusal } from "@infraforge/simulation/internal-first-stack";
import type { CausalObserver } from "@infraforge/simulation/internal-product";
import { reviewSidecar, sourceSchema } from "./authoring";
import { hash, canonical } from "./canonical";
import { transformSchema } from "./workload";
import { requireCapability } from "../capabilities/policy";

const id = z.string().min(1).max(256).refine(s => !Object.hasOwn(Object.prototype, s));
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), time = amount.max(limits.durationUs);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const resolvedSchema = z.object({ schema: z.literal("infraforge-first-stack-resolved/1"),
  header: z.object({ schema: z.literal("infraforge-first-stack-schedule/1"), unit: z.literal("us"), durationUs: time.positive(), origin: z.enum(["observed-recording", "authored-schedule"]), provenance: id }).strict(),
  transform: transformSchema, scheduleHash: digest, parametersHash: digest, identity: digest, profileHash: digest,
  normalizedContentHash: digest, executedScheduleHash: digest, application: sourceSchema,
  rows: z.array(z.object({ id, atUs: time, operation: id, requestBytes: amount, responseBytes: amount, deadlineUs: time.positive(),
    intendedAtUs: time.optional(), sentAtUs: time.optional(), generatorLost: z.boolean().optional(), plan: id, keys: z.array(id).max(128) }).strict()).max(limits.rows),
  unknown: z.array(z.string().max(256)).max(32),
}).strict();
const policySchema = z.object({ seed: id, horizonUs: time.positive(), sampleIntervalUs: time.positive(),
  maxEvents: amount.positive().max(2_000_000), maxSamples: amount.positive().max(10_000), maxRawResults: amount.max(limits.rows) }).strict();
function refuse(path: string, message: string): never { throw new FirstStackCompileRefusal([{ code: "FIRST_STACK_EXECUTION", path, message }]); }

// Operator qualification tools call this trusted internal function. It is not
// mounted on HTTP or dispatched by the worker; execution-host admission is later.
export function prepareFirstStackExecution(owner: string, layout: unknown, candidate: unknown, recording: unknown, policy: unknown, capability = requireCapability) {
  capability(owner, { capability: "load.recorded.accept", bytes: limits.scheduleBytes, rows: limits.rows, durationSeconds: limits.durationUs / 1_000_000, scale: 1 });
  if (Buffer.byteLength(canonical({ candidate, recording, policy })) > limits.semanticBytes) refuse("input", "Reduce the semantic input below 16 MiB.");
  const review = reviewSidecar(layout, candidate);
  if (!review.ok) throw new FirstStackCompileRefusal(review.diagnostics);
  if (review.sidecar.schema !== "infraforge-first-stack-sidecar/2") refuse("schema", "V1 is review-only; create a reviewed V2 copy with explicit directed links, pool policy and readiness.");
  const parsed = resolvedSchema.safeParse(recording), parsedPolicy = policySchema.safeParse(policy);
  for (const result of [parsed, parsedPolicy]) if (!result.success) throw new FirstStackCompileRefusal(result.error.issues.map(e => ({ code: "FIRST_STACK_EXECUTION", path: e.path.join("."), message: e.message })));
  if (!parsed.success || !parsedPolicy.success) return refuse("input", "Supply a valid resolved schedule and execution policy.");
  const schedule: ResolvedSchedule = parsed.data, sidecar = review.sidecar;
  const { identity, ...body } = schedule;
  if (hash(body) !== identity || hash({ header: schedule.header, rows: schedule.rows }) !== schedule.executedScheduleHash) refuse("workload.identity", "Resolved workload content changed; resolve and review it again.");
  const profile = hash({ profile: sidecar.profile, compiler: sidecar.compiler, application: sidecar.application,
    operations: [...sidecar.operations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), database: sidecar.database });
  if (profile !== schedule.profileHash || canonical(schedule.application) !== canonical(sidecar.application)) refuse("workload.profileHash", "Demand profile changed; resolve the recording against this exact reviewed revision.");
  if (!sidecar.workload || sidecar.workload.scheduleHash !== schedule.scheduleHash || sidecar.workload.parametersHash !== schedule.parametersHash) refuse("workload", "Pin both resolved schedule and parameter hashes in the reviewed V2 sidecar before compilation.");
  const seen = new Set<string>();
  let previous: ResolvedSchedule["rows"][number] | undefined;
  for (const row of schedule.rows) {
    const op = sidecar.operations.find(o => o.id === row.operation), plan = sidecar.database.plans.find(p => p.id === row.plan);
    if (seen.has(row.id) || row.atUs > schedule.header.durationUs || (previous && (row.atUs < previous.atUs || (row.atUs === previous.atUs && row.id <= previous.id)))) refuse(`rows.${row.id}`, "Use unique rows in canonical timestamp/ID order within the duration.");
    seen.add(row.id); previous = row;
    if (!op || !plan || row.plan !== op.plan || row.deadlineUs !== op.deadlineUs) refuse(`rows.${row.id}`, "Match the reviewed operation, plan and deadline.");
    if (new Set(row.keys).size !== row.keys.length || row.keys.some(k => Buffer.byteLength(k) > limits.keyBytes || !sidecar.database.keys.includes(k)) ||
      (op.kind === "range-read" ? !row.keys.length : row.keys.length !== 1) || (plan.keys !== "recorded" && canonical(plan.keys) !== canonical(row.keys))) refuse(`rows.${row.id}.keys`, "Supply exact finite keys matching the reviewed plan; no fallback key selection is permitted.");
  }
  capability(owner, { capability: "load.recorded.accept", bytes: Buffer.byteLength(canonical(schedule)), rows: schedule.rows.length, durationSeconds: schedule.header.durationUs / 1_000_000, scale: schedule.transform.timeScale.numerator / schedule.transform.timeScale.denominator });
  const compiled = compileFirstStack(sidecar, schedule, parsedPolicy.data);
  return { sidecar, schedule, policy: parsedPolicy.data, compiled, compiledHash: hash(compiled),
    lock: { schema: "infraforge-first-stack-compile-lock/2", compiler: sidecar.compiler, composition: compiled.revision,
      designRevision: sidecar.designRevision, sidecarHash: hash(sidecar), workloadIdentity: schedule.identity,
      executedScheduleHash: schedule.executedScheduleHash, profileHash: schedule.profileHash, compiledHash: hash(compiled) } };
}

export function runFirstStackQualification(prepared: ReturnType<typeof prepareFirstStackExecution>, causal?: CausalObserver) {
  // Recompile to detect mutation between review and execution; no caller may
  // replace compiled resource/host inputs under an earlier lock.
  const compiled = compileFirstStack(prepared.sidecar, prepared.schedule, prepared.policy);
  if (hash(compiled) !== prepared.compiledHash || hash(prepared.sidecar) !== prepared.lock.sidecarHash || prepared.schedule.identity !== prepared.lock.workloadIdentity || hash((({ identity: _identity, ...body }) => body)(prepared.schedule)) !== prepared.schedule.identity) refuse("lock", "Reviewed inputs changed; prepare a new immutable compile lock.");
  const runtime = createFirstStackRuntime(prepared.sidecar, prepared.schedule, prepared.policy, causal);
  runtime.advanceTo(runtime.horizon);
  return { lock: prepared.lock, evidence: runtime.evidence() };
}
