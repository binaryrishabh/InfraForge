import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
import { hash, canonical } from "./canonical";
import { appendSubmissionResult, submissionTransaction, type SubmissionAdmission } from "./admission";
import { executeFirstStackIsolated } from "./isolatedExecution";
import type { IsolationControl } from "./isolationConnection";
import { withFirstStackOwnership } from "./isolationOwnership";
import { inputDigest, readIsolatedCut, type IsolatedCut } from "./isolationProtocol";
import type { IsolationConfiguration } from "./isolationRunner";
import { challengeFence, executeScoredChallenge } from "./scoredChallenges/execution";

export interface SubmissionVerifier {
  admission: SubmissionAdmission; isolation: IsolationConfiguration; control: IsolationControl;
}
export function createSubmissionFence(run: any, token: string, allowed: () => boolean = () => true) {
  return {
    token,
    async check(db: Client) {
      const row = (await db.query(`SELECT w.* FROM "FirstStackWork" w JOIN "FirstStackRun" r ON r.id=w."runId"
        WHERE r.id=$1 AND r."ownerId"=$2 AND r."inputHash"=$3 FOR UPDATE OF w`, [run.id, run.ownerId, run.inputHash])).rows[0];
      if (!allowed() || !row || row.status !== "running" || row.token !== token || row.daemon !== run.daemon || row.cancelRequested || !row.authorized) throw Error("Submission ownership cancelled, revoked or lost");
    },
    async commit(db: Client, cut: IsolatedCut) {
      const previous = (await db.query('SELECT body FROM "FirstStackCut" WHERE "runId"=$1 ORDER BY sequence DESC LIMIT 1', [run.id])).rows[0]?.body;
      readIsolatedCut(cut, run.engine.source, run.inputHash, previous);
      if ((!previous && cut.cut.sequence !== 1) || hash(cut.cut.lock) !== hash(run.lock)) throw Error("Submission cut changed its immutable lock");
      await db.query('INSERT INTO "FirstStackCut" ("runId",sequence,body) VALUES ($1,$2,$3)', [run.id, cut.cut.sequence, cut]);
    },
  };
}
// Pure decision boundary: browser input can never set verification status.
export function verificationOutcome(run: any, result: Awaited<ReturnType<typeof executeFirstStackIsolated>>, allowed: boolean) {
  const clean = result.receipt.cleanup === "removed" || result.receipt.cleanup === "not-created";
  const cut = result.durablePrefix;
  const complete = allowed && clean && result.status === "completed" && result.receipt.cleanup === "removed" &&
    cut?.cut.completeness.horizonReached && hash(cut.cut.lock) === hash(run.lock) && cut.source === run.engine.source && cut.inputHash === run.inputHash;
  return { clean, body: { verification: complete ? cut.fingerprint === run.browserCut.fingerprint ? "verified" : "mismatch" : "interrupted",
    actual: cut?.fingerprint ?? null, expected: run.browserCut.fingerprint, receipt: result.receipt,
    interruption: result.interruption, summary: result.summary, journal: result.journal } };
}
export async function verifySubmission(pool: Pool, databaseUrl: string, id: string, configuration: SubmissionVerifier) {
  const token = randomUUID();
  const run = await submissionTransaction(pool, async db => {
    const row = (await db.query('SELECT r.*,w.status,w."cancelRequested",w.authorized FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id WHERE r.id=$1 FOR UPDATE OF w', [id])).rows[0];
    if (!row || row.status !== "queued") return null; // Duplicate/stalled delivery never restarts execution.
    if (!configuration.admission.enabled || !configuration.admission.engine || row.cancelRequested || !row.authorized ||
      canonical(row.engine) !== canonical(configuration.admission.engine) || row.engine.source !== configuration.isolation.source || row.engine.image !== configuration.isolation.image) {
      await appendSubmissionResult(db, id, { verification: "unavailable", reason: "Pinned approved engine or authorization unavailable" });
      await db.query('UPDATE "FirstStackWork" SET status=\'terminal\' WHERE "runId"=$1', [id]);
      return null;
    }
    if (inputDigest(row.input) !== row.inputHash || hash(JSON.parse(row.input).policy.seed) !== hash(row.seed)) throw Error("Stored immutable input identity differs");
    await db.query('UPDATE "FirstStackWork" SET status=\'running\',token=$2,daemon=$3 WHERE "runId"=$1', [id, token, configuration.control.identity]);
    return { ...row, daemon: configuration.control.identity };
  });
  if (!run) return;
  const allowed = () => configuration.admission.enabled && configuration.admission.engine !== null &&
    canonical(configuration.admission.engine) === canonical(run.engine) && configuration.isolation.source === run.engine.source && configuration.isolation.image === run.engine.image && configuration.control.identity === run.daemon;
  // The session lock is shared with execute AND replay, across all workers.
  // A lost COMMIT response is never automatically retried. Durable cuts are
  // read from PostgreSQL on recovery; no continuation is inferred from Redis.
  try {
    const fence = challengeFence(createSubmissionFence(run, token, allowed), run.engine.source);
    const execution = await withFirstStackOwnership(databaseUrl, { token, check: fence.check, commit: fence.commit }, async (authority, signal) => {
      const result = await executeFirstStackIsolated(configuration.control, configuration.isolation, run.input, authority, signal);
      const score = await executeScoredChallenge(run, result, authority, signal, fence.select,
        (input, owner, abort) => executeFirstStackIsolated(configuration.control, configuration.isolation, input, owner, abort));
      return { result, score, held: !signal.aborted };
    });
    // The container AND the session ownership have cleared before releasing a
    // reservation. Recheck the captured work token/authorization in this commit.
    await submissionTransaction(pool, async db => {
        const state = (await db.query('SELECT * FROM "FirstStackWork" WHERE "runId"=$1 FOR UPDATE', [id])).rows[0];
        if (!state || state.status !== "running" || state.token !== token || state.daemon !== run.daemon) throw Error("Submission completion fence lost");
        const outcome = verificationOutcome(run, execution.result, state.authorized && !state.cancelRequested && execution.held && allowed());
        if (!outcome.clean) {
          await db.query('UPDATE "FirstStackWork" SET status=\'recovery\' WHERE "runId"=$1', [id]);
          return; // Unconfirmed cleanup retains its reservation and blocks replacements.
        }
        await appendSubmissionResult(db, id, { ...outcome.body, ...(outcome.body.verification === "verified" && execution.score ? { score: execution.score } : {}) });
        await db.query('UPDATE "FirstStackWork" SET status=\'terminal\' WHERE "runId"=$1', [id]);
    });
  } catch (error) {
    // Conservative even if launch failed before create: operator reviews the
    // exact stored prefix/container before releasing uncertain ownership.
    await submissionTransaction(pool, async db => {
      await db.query('UPDATE "FirstStackWork" SET status=\'recovery\' WHERE "runId"=$1 AND token=$2 AND status=\'running\'', [id, token]);
    });
    throw error;
  }
}

// Call only after stopping the previous worker. Never reset to queued, expire a
// lease, release capacity or automatically rerun an uncertain browser submission.
export async function markSubmissionRecovery(pool: Pool) {
  await submissionTransaction(pool, async db => {
    await db.query('UPDATE "FirstStackWork" SET status=\'recovery\' WHERE status=\'running\'');
    await db.query('UPDATE "FirstStackReplay" SET status=\'recovery\' WHERE status=\'running\'');
  });
}
