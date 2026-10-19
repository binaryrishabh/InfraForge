import { requireCapability } from "../capabilities/policy";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { config } from "../utils/config";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { admissionSchema, compileEnvelope } from "./envelope";
import { contentHash } from "./identity";
import { INTERNAL_LIMITS as limits } from "./budgets";
import { boundedProduct, requireKnown } from "@infraforge/simulation/internal-product";
import { jsonBytes } from "./budgets";
import type { ExecutionEnvelope } from "./envelope";
import type { LessonPolicy } from "./lessonPolicy";
export const internalDatabase = new Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
export interface InternalRunRow { id: string; ownerId: string; infrastructureId: string | null; idempotencyKey: string; requestHash: string; input: unknown; inputHash: string; status: string; token: string | null; sequence: number; throughUs: number; evidence: unknown; cancelRequested: boolean; reason: string | null; createdAt: Date; updatedAt: Date }
export async function hasInternalGrant(owner: string) { return (await internalDatabase.query('SELECT 1 FROM "InternalModel2Grant" WHERE "userId"=$1', [owner])).rowCount === 1; }
export async function admit(owner: string, request: z.infer<typeof admissionSchema>, lesson?: (input: ExecutionEnvelope) => LessonPolicy) {
  // Bound untrusted structure before hashing or borrowing a transaction connection.
  try { boundedProduct(request); jsonBytes(request, limits.requestBytes); }
  catch { throw new ValidationError("Internal request exceeds structural, text or byte budgets"); }
  const requestHash = contentHash(request), client = await internalDatabase.connect();
  try {
    await client.query("BEGIN");
    // One bounded admission critical section makes per-owner/global quotas race safe.
    await client.query("SELECT pg_advisory_xact_lock(186542854,2)");
    const grant = (await client.query('SELECT scope FROM "InternalModel2Grant" WHERE "userId"=$1 FOR SHARE', [owner])).rows[0];
    if (!grant || !["operator", "lesson"].includes(grant.scope) || !lesson && (grant.scope !== "operator" || (request.contract as { version?: string })?.version === "object-restart/1")) throw new NotFoundError();
    const existing = (await client.query<InternalRunRow>('SELECT * FROM "InternalModel2Run" WHERE "ownerId"=$1 AND "idempotencyKey"=$2', [owner, request.idempotencyKey])).rows[0];
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictError("Idempotency key already names a different recorded request");
      await client.query("COMMIT"); return { run: existing, created: false };
    }
    const counts = (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE "ownerId"=$1)::int AS owned,
      count(*) FILTER (WHERE "ownerId"=$1 AND status IN ('queued','running'))::int AS active FROM "InternalModel2Run"`, [owner])).rows[0];
    if (counts.total >= limits.globalRuns || counts.owned >= limits.ownerRuns || counts.active >= limits.activeRuns) throw new ConflictError("Internal run retention/admission quota reached");
    const design = (await client.query('SELECT layout,"updatedAt" AT TIME ZONE \'UTC\' AS "updatedAt","challengeId" FROM "Infrastructure" WHERE id=$1 AND "ownerId"=$2 FOR SHARE', [request.infrastructureId, owner])).rows[0];
    if (!design) throw new NotFoundError("Saved design not found");
    if (design.challengeId) throw new ValidationError("Published challenge workspaces are excluded from internal Model-2 admission");
    if (design.updatedAt.toISOString() !== request.expectedDesignUpdatedAt) throw new ConflictError("Saved design changed; review it before creating a new internal run");
    const id = randomUUID(), envelope = compileEnvelope(id, owner, design.layout, design.updatedAt, request);
    const traces = envelope.compiled.input.arrivals.filter(a => a.kind === "trace");
    if (traces.length) requireCapability(owner, { capability: "load.recorded.accept", bytes: Buffer.byteLength(JSON.stringify(traces), "utf8"), rows: traces.reduce((n, a) => n + (a.kind === "trace" ? a.trace.rows.length : 0), 0), durationSeconds: requireKnown(envelope.contract.horizon, "us") / 1_000_000, scale: 1 });
    requireCapability(owner, { capability: "run.start", purpose: lesson ? "learner" : "operator", engine: "2", profile: envelope.contract.version, durationSeconds: requireKnown(envelope.contract.horizon, "us") / 1_000_000 });
    const row = (await client.query<InternalRunRow>(`INSERT INTO "InternalModel2Run" (id,"ownerId","infrastructureId","idempotencyKey","requestHash",input,"inputHash")
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id, owner, request.infrastructureId, request.idempotencyKey, requestHash, envelope, envelope.fingerprint])).rows[0]!;
    if (lesson) await client.query('INSERT INTO "InternalModel2LessonRun" ("runId",policy) VALUES ($1,$2)', [id, lesson(envelope)]);
    await client.query('INSERT INTO "Outbox" (id,"eventType",payload) VALUES ($1,\'model2-internal-created\',$2)', [randomUUID(), { internalModel2RunId: id }]);
    await client.query("COMMIT"); return { run: row, created: true };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function ownedRun(id: string, owner: string) {
  const row = (await internalDatabase.query<InternalRunRow>('SELECT * FROM "InternalModel2Run" WHERE id=$1 AND "ownerId"=$2', [id, owner])).rows[0];
  if (!row) throw new NotFoundError("Internal run not found"); return row;
}
export async function requestCancellation(id: string, owner: string) {
  const row = (await internalDatabase.query<InternalRunRow>(`UPDATE "InternalModel2Run" SET "cancelRequested"=true,
    status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
    reason=CASE WHEN status='queued' THEN 'Cancelled before execution' ELSE reason END,"updatedAt"=now()
    WHERE id=$1 AND "ownerId"=$2 AND status IN ('queued','running')
      AND EXISTS (SELECT 1 FROM "InternalModel2Grant" WHERE "userId"=$2) RETURNING *`, [id, owner])).rows[0];
  if (!row) { await ownedRun(id, owner); throw new ConflictError("Internal run is already terminal"); } return row;
}
