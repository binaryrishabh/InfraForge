import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { requireCapability } from "../capabilities/policy";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { canonical, designRevision, hash } from "./canonical";
import { prepareFirstStackExecution } from "./execution";
import { inputDigest, readIsolatedCut } from "./isolationProtocol";
import { digestPattern, imagePattern } from "./isolationPolicy";

export const submissionEnvelope = Object.freeze({ revision: "first-stack-submission/1", queued: 16,
  queuedBytes: 256 * 1024 * 1024, retainedBytes: 2 * 1024 * 1024 * 1024,
  captureBytes: 32 * 1024 * 1024, metadataBytes: 4 * 1024 * 1024, perOwner: 1, submissionsPerHour: 10 });
export interface ApprovedSubmissionEngine { source: string; image: string }
export interface SubmissionLineage {
  kind: "design"; infrastructureId: string; updatedAt: string; designRevision: string;
}
export interface SubmittedWorkloadReference {
  origin: "submitted-recording"; identity: string; executedScheduleHash: string;
}
export interface SubmissionAdmission {
  // Trusted application configuration only. A grant, request or browser hash
  // cannot activate this boundary. No caller in the shipped API enables it.
  enabled: boolean; engine: ApprovedSubmissionEngine | null;
}
export const closedSubmissionAdmission: SubmissionAdmission = Object.freeze({ enabled: false, engine: null });
const requestSchema = z.object({ infrastructureId: z.uuid(), expectedDesignUpdatedAt: z.iso.datetime(),
  expectedDesignRevision: z.string().regex(digestPattern), idempotencyKey: z.string().min(1).max(80),
  purpose: z.enum(["private", "shared", "scored"]), engine: z.object({ source: z.string().regex(digestPattern), image: z.string().regex(imagePattern) }).strict(),
  workload: z.json(), policy: z.json(), browserCut: z.json() }).strict();

export async function submissionTransaction<T>(pool: Pool, task: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Serialize admission/reservations and state transitions across API and
    // worker processes. Separate from the executor's session ownership lock.
    await db.query("SELECT pg_advisory_xact_lock(186542854,11)");
    const value = await task(db);
    await db.query("COMMIT");
    return value;
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
  finally { db.release(); }
}
export function createSubmissionService(pool: Pool, configuration: SubmissionAdmission = closedSubmissionAdmission) {
  return {
    async submit(owner: string, value: unknown) {
      if (!configuration.enabled || !configuration.engine) throw new NotFoundError();
      if (!owner) throw new NotFoundError();
      if (Buffer.byteLength(canonical(value)) > 18 * 1024 * 1024) throw new ValidationError("Submission byte budget exceeded");
      const parsed = requestSchema.safeParse(value);
      if (!parsed.success) throw new ValidationError("Supply the strict first-stack submission fields and approved engine identity");
      const request = parsed.data, requestHash = hash(request);
      if (canonical(request.engine) !== canonical(configuration.engine)) throw new ConflictError("Approved engine unavailable; retain the original browser run");
      return submissionTransaction(pool, async db => {
        const previous = await db.query('SELECT id,"requestHash" FROM "FirstStackRun" WHERE "ownerId"=$1 AND "idempotencyKey"=$2', [owner, request.idempotencyKey]);
        if (previous.rowCount) {
          if (previous.rows[0].requestHash !== requestHash) throw new ConflictError("Idempotency key already used for different content");
          return { id: previous.rows[0].id as string, reused: true };
        }
        const design = (await db.query('SELECT * FROM "Infrastructure" WHERE id=$1 AND "ownerId"=$2 FOR UPDATE', [request.infrastructureId, owner])).rows[0];
        if (!design) throw new NotFoundError("Saved design unavailable");
        if (design.challengeId) throw new ValidationError("Fixed challenge submissions require a server-owned challenge adapter");
        if (design.updatedAt.toISOString() !== request.expectedDesignUpdatedAt || designRevision(design.layout) !== request.expectedDesignRevision) throw new ConflictError("Saved design changed; review its exact revision");
        const prepared = prepareFirstStackExecution(owner, design.layout, design.layout.firstStack, request.workload, request.policy);
        const input = canonical({ owner, layout: design.layout, candidate: design.layout.firstStack, recording: prepared.schedule, policy: prepared.policy });
        const inputHash = inputDigest(input), browserCut = request.browserCut as unknown as Parameters<typeof readIsolatedCut>[0];
        if (Buffer.byteLength(canonical(browserCut)) > 1024 * 1024) throw new ValidationError("Browser evidence exceeds frame limit");
        try { readIsolatedCut(browserCut, configuration.engine!.source, inputHash); }
        catch { throw new ValidationError("Invalid browser cut identity or fingerprint"); }
        if (hash(browserCut.cut.lock) !== hash(prepared.lock) || !browserCut.cut.completeness.horizonReached || browserCut.cut.interruption) throw new ValidationError("Submit a finished browser run under the exact reviewed compile lock");
        const commercial = requireCapability(owner, { capability: "run.start", purpose: "engineer", engine: "2", profile: "first-stack/1", durationSeconds: prepared.policy.horizonUs / 1_000_000 });
        const rate = await db.query('SELECT count(*)::int AS count FROM "FirstStackRun" WHERE "ownerId"=$1 AND "createdAt">CURRENT_TIMESTAMP-INTERVAL \'1 hour\'', [owner]);
        if (rate.rows[0].count >= submissionEnvelope.submissionsPerHour) throw new AppError("Submission rate exceeded; try again later", 429);
        const verifying = request.purpose !== "private", inputBytes = Buffer.byteLength(input), reservedBytes = inputBytes + submissionEnvelope.captureBytes + submissionEnvelope.metadataBytes;
        const usage = (await db.query(`SELECT count(*) FILTER (WHERE w.status<>'terminal')::int AS queued,
          count(*) FILTER (WHERE w.status<>'terminal' AND r."ownerId"=$1)::int AS owned,
          COALESCE(sum(r."inputBytes") FILTER (WHERE w.status<>'terminal'),0)::bigint AS bytes,
          COALESCE(sum(r."reservedBytes"),0)::bigint AS retained
          FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id`, [owner])).rows[0];
        if (Number(usage.retained) + reservedBytes > submissionEnvelope.retainedBytes ||
          verifying && (usage.queued >= submissionEnvelope.queued || usage.owned >= submissionEnvelope.perOwner || Number(usage.bytes) + inputBytes > submissionEnvelope.queuedBytes)) throw new AppError("Submission storage or verification capacity busy", 503);
        const id = randomUUID(), lineage: SubmissionLineage = { kind: "design", infrastructureId: design.id, updatedAt: request.expectedDesignUpdatedAt, designRevision: request.expectedDesignRevision };
        const workload: SubmittedWorkloadReference = { identity: prepared.schedule.identity, executedScheduleHash: prepared.schedule.executedScheduleHash, origin: "submitted-recording" };
        await db.query(`INSERT INTO "FirstStackRun" (id,"ownerId","idempotencyKey","requestHash",purpose,engine,input,"inputHash",lock,seed,workload,envelope,lineage,"browserCut","inputBytes","reservedBytes")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, owner, request.idempotencyKey, requestHash, request.purpose, request.engine, input, inputHash, prepared.lock, prepared.policy.seed,
          workload,
          { ...submissionEnvelope, commercial: commercial.revision }, lineage, browserCut, inputBytes, reservedBytes]);
        await db.query('INSERT INTO "FirstStackWork" ("runId",status) VALUES ($1,$2)', [id, verifying ? "queued" : "terminal"]);
        if (verifying) await db.query('INSERT INTO "FirstStackOutbox" ("runId") VALUES ($1)', [id]);
        else await appendSubmissionResult(db, id, { verification: "unverified", reason: "Browser evidence is untrusted", browserFingerprint: browserCut.fingerprint });
        return { id, reused: false };
      });
    },
    async read(owner: string, id: string) {
      const row = (await pool.query(`SELECT r.*,w.status,w."cancelRequested",s.body AS result,s.hash AS "resultHash"
        FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id LEFT JOIN "FirstStackResult" s ON s."runId"=r.id WHERE r.id=$1 AND r."ownerId"=$2`, [id, owner])).rows[0];
      if (!row) throw new NotFoundError();
      return row;
    },
    async cancel(owner: string, id: string) {
      requireCapability(owner, { capability: "run.control", runId: id, control: "cancel-verification" });
      return submissionTransaction(pool, async db => {
        const row = (await db.query('SELECT w.* FROM "FirstStackWork" w JOIN "FirstStackRun" r ON r.id=w."runId" WHERE r.id=$1 AND r."ownerId"=$2 FOR UPDATE OF w', [id, owner])).rows[0];
        if (!row) throw new NotFoundError();
        if (row.status === "terminal") return;
        await db.query('UPDATE "FirstStackWork" SET "cancelRequested"=true WHERE "runId"=$1', [id]);
        if (row.status === "queued") {
          await appendSubmissionResult(db, id, { verification: "cancelled", reason: "Cancelled before executor ownership" });
          await db.query('UPDATE "FirstStackWork" SET status=\'terminal\' WHERE "runId"=$1', [id]);
        }
      });
    },
  };
}
export async function appendSubmissionResult(db: Pick<PoolClient, "query">, id: string, body: unknown) {
  await db.query('INSERT INTO "FirstStackResult" ("runId",body,hash) VALUES ($1,$2,$3)', [id, body, hash(body)]);
}
