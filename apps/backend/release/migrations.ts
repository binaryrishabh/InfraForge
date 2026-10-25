import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Client, Pool } from "pg";
import { checkCredentialSchema } from "./credentialSchema";
import { checkInternalModel2Schema } from "./model2Schema";
import { checkLessonSchema } from "./lessonSchema";
import { checkFirstStackSchema } from "./firstStackSchema";
import { checkAccountSchema } from "./accountSchema";
import { verifierLock } from "../firstStack/verifierOwnership";

type Database = Pick<Client | Pool, "query">;
export type Migration = { name: string; checksum: string; checksums: string[] };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Reviewed additive migrations: safe to apply to a populated, idle database. They also define the guarded triggers.
export const ADDITIVE_MIGRATIONS = new Set(["20261009000000_capture_run_inputs", "20261009010000_add_authentication",
  "20261013000000_reliable_run_evidence", "20261013010000_honest_reruns", "20261014000000_challenge_attempts",
  "20261015000000_challenge_versions_experiments", "20261016000000_experiment_evidence",
  "20261017000000_credential_usernames", "20261018000000_challenge_learning", "20261019000000_internal_model2", "20261020000000_model2_lesson", "20261021000000_first_stack_submissions", "20261022000000_historical_replay", "20261023000000_account_essentials",
  "20261024120000_account_mail_outbox", "20261024130000_account_mail_intents",
  "20261025000000_first_stack_queue_operations", "20261025120000_email_login_intents"]);

export async function migrationManifest(): Promise<Migration[]> {
  const directory = new URL("../prisma/migrations/", import.meta.url);
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().map(async (name) => {
    const sql = await readFile(new URL(`${name}/migration.sql`, directory), "utf8");
    const lf = sql.replace(/\r\n/g, "\n");
    return { name, checksum: hash(lf), checksums: [...new Set([hash(sql), hash(lf), hash(lf.replace(/\n/g, "\r\n"))])] };
  }));
}

export function migrationFingerprint(manifest: Migration[]) {
  return hash(manifest.map(({ name, checksum }) => `${name}:${checksum}`).join("\n"));
}

export function inspectHistory(manifest: Migration[], rows: Array<{
  migration_name: string; checksum: string; finished_at: unknown; rolled_back_at: unknown;
}>) {
  const applied: string[] = [];
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    const migration = manifest.find((item) => item.name === row.migration_name);
    if (!migration || !migration.checksums.includes(row.checksum) || !row.finished_at) {
      throw new Error("Migration history contains unknown, changed or failed migrations; manual investigation required");
    }
    if (applied.includes(row.migration_name)) throw new Error("Duplicate applied migration history");
    applied.push(row.migration_name);
  }
  applied.sort();
  if (applied.some((name, index) => name !== manifest[index]?.name)) throw new Error("Migration history is not an ordered prefix of this release");
  return applied.length;
}

export async function checkHistory(db: Database, complete = true) {
  const manifest = await migrationManifest();
  const exists = await db.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present");
  const rows = exists.rows[0].present ? (await db.query(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`)).rows : [];
  const count = inspectHistory(manifest, rows);
  if (complete && count !== manifest.length) throw new Error("Database migrations do not match this release");
  return { manifest, count, fingerprint: migrationFingerprint(manifest) };
}

export async function checkModel1SchemaGuards(db: Database) {
  // Prisma's schema diff cannot check SQL triggers. Check them separately.
  const result = await db.query(`SELECT tgname, tgtype, pg_get_triggerdef(t.oid) AS definition, p.proname, p.prosrc
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE NOT tgisinternal AND tgenabled = 'O' AND n.nspname = 'public' AND NOT p.prosecdef
    AND p.prorettype = 'trigger'::regtype AND p.proconfig IS NULL
    AND p.prolang = (SELECT oid FROM pg_language WHERE lanname='plpgsql') AND tgqual IS NULL
    AND ((tgrelid = '"Deployment"'::regclass AND tgname IN ('deployment_inputs_immutable', 'deployment_active_delete_guard', 'deployment_identity_capture', 'deployment_evidence_guard', 'deployment_lineage_guard', 'deployment_challenge_attempt', 'deployment_challenge_guard', 'deployment_learning_insert', 'deployment_learning_guard'))
      OR (tgrelid = '"Infrastructure"'::regclass AND tgname IN ('design_owner_guard', 'design_active_delete_guard', 'infrastructure_challenge_guard'))
      OR (tgrelid = '"RunAction"'::regclass AND tgname IN ('run_action_evidence_guard', 'run_action_challenge_guard'))
      OR (tgrelid = '"RunEvidenceSample"'::regclass AND tgname = 'run_experiment_evidence_guard'))`);
  if (result.rows.length !== 15) throw new Error("Required ownership/run-input database guards are missing or disabled");
  const sources = (await Promise.all([...ADDITIVE_MIGRATIONS].map((name) =>
    readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8")))).join("\n");
  const bodies = new Map([...sources.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$/g)]
    .map((match) => [match[1], match[2]!.replace(/\r\n/g, "\n").trim()]));
  const expected: Record<string, [string, number, string]> = {
    deployment_learning_insert: ["verify_challenge_learning", 7, 'BEFORE INSERT ON public."Deployment"'],
    deployment_learning_guard: ["protect_challenge_learning", 19, 'BEFORE UPDATE OF "improvementSourceId", "learningHypothesis", "learningIntent" ON public."Deployment"'],
    run_experiment_evidence_guard: ["protect_experiment_evidence", 23, 'BEFORE INSERT OR UPDATE ON public."RunEvidenceSample"'],
    deployment_inputs_immutable: ["protect_deployment_inputs", 19, 'BEFORE UPDATE OF "runInputs", seed, "workloadProfile" ON public."Deployment"'],
    deployment_active_delete_guard: ["protect_active_deployment", 11, 'BEFORE DELETE ON public."Deployment"'],
    design_owner_guard: ["protect_design_owner", 19, 'BEFORE UPDATE OF "ownerId" ON public."Infrastructure"'],
    deployment_identity_capture: ["capture_run_identity", 7, 'BEFORE INSERT ON public."Deployment"'],
    deployment_evidence_guard: ["protect_run_evidence", 19, 'BEFORE UPDATE OF "ownerId", "runName", "terminalSnapshot", "infrastructureId" ON public."Deployment"'],
    design_active_delete_guard: ["protect_design_history", 11, 'BEFORE DELETE ON public."Infrastructure"'],
    run_action_evidence_guard: ["protect_run_action", 19, 'BEFORE UPDATE ON public."RunAction"'],
    deployment_lineage_guard: ["protect_run_lineage", 19, 'BEFORE UPDATE OF "sourceRunId", "rerunMode", "autoStopAtSimulatedSeconds" ON public."Deployment"'],
    deployment_challenge_attempt: ["verify_challenge_attempt", 7, 'BEFORE INSERT ON public."Deployment"'],
    deployment_challenge_guard: ["protect_challenge_attempt", 19, 'BEFORE UPDATE OF "challengeId", "challengeVersion", "challengeSpecHash", "challengePrediction", "predictionSubmittedAt", "evaluationStopAtSimulatedSeconds", "challengeExperiment" ON public."Deployment"'],
    infrastructure_challenge_guard: ["protect_challenge_design", 19, 'BEFORE UPDATE OF "challengeId", "challengeVersion" ON public."Infrastructure"'],
    run_action_challenge_guard: ["restrict_challenge_actions", 7, 'BEFORE INSERT ON public."RunAction"'],
  };
  for (const row of result.rows) {
    const guard = expected[row.tgname];
    if (!guard || row.proname !== guard[0] || row.tgtype !== guard[1] || !row.definition.includes(guard[2]) ||
      row.prosrc.replace(/\r\n/g, "\n").trim() !== bodies.get(row.proname)) throw new Error("Database guard definition differs from this release");
  }
  await db.query(`SELECT d."runInputs", d."liveTopology", d."topologyRevision", d."runtimeActive", d."ownerId", d."runName", d."terminalSnapshot", d."actionSequence", d."sourceRunId", d."rerunMode", d."autoStopAtSimulatedSeconds", d."challengeId", d."challengeVersion", d."challengeSpecHash",
    d."challengePrediction", d."predictionSubmittedAt", d."evaluationStopAtSimulatedSeconds", d."challengeExperiment", r.parameters, r.outcome, i."ownerId", i."challengeId", i."challengeVersion",
    s."expiresAt", a."providerId", v.identifier FROM "Deployment" d CROSS JOIN "Infrastructure" i
    CROSS JOIN "Session" s CROSS JOIN "Account" a CROSS JOIN "Verification" v CROSS JOIN "RunAction" r LIMIT 0`);
  await db.query('SELECT "deploymentId", "simulatedSeconds", "sampledAt", payload, hash FROM "RunEvidenceSample" LIMIT 0');
  await db.query('SELECT username FROM "User" LIMIT 0');
  await db.query('SELECT "improvementSourceId", "learningHypothesis", "learningIntent" FROM "Deployment" LIMIT 0');
  await checkCredentialSchema(db);
}

export async function checkSchemaGuards(db: Database) {
  await checkModel1SchemaGuards(db);
  await checkInternalModel2Schema(db);
  await checkLessonSchema(db);
  await checkFirstStackSchema(db);
  await checkAccountSchema(db);
}

export async function assertReleaseIdle(db: Database) {
  const replays = await db.query("SELECT to_regclass('public.\"FirstStackReplay\"') IS NOT NULL AS present");
  if (replays.rows[0].present && (await db.query('SELECT 1 FROM "FirstStackReplay" WHERE status<>\'terminal\' LIMIT 1')).rowCount) throw Error("Historical replays must finish or undergo operator recovery before release");
  const submissions = await db.query("SELECT to_regclass('public.\"FirstStackWork\"') IS NOT NULL AS present");
  if (submissions.rows[0].present && (await db.query('SELECT 1 FROM "FirstStackWork" WHERE status<>\'terminal\' LIMIT 1')).rowCount) throw Error("First-stack reservations must finish or undergo operator recovery before release");
  const internal = await db.query("SELECT to_regclass('public.\"InternalModel2Run\"') IS NOT NULL AS present");
  if (internal.rows[0].present && (await db.query('SELECT 1 FROM "InternalModel2Run" WHERE status IN (\'queued\',\'running\') LIMIT 1')).rowCount) throw Error("Active internal Model-2 runs must finish or be cancelled before release");
  const tables = await db.query("SELECT to_regclass('public.\"Deployment\"') IS NOT NULL AS present");
  if (tables.rows[0].present) {
    // The JSON lookup also works before the additive runtimeActive column exists.
    const active = await db.query(`SELECT count(*)::int AS count FROM "Deployment" d
      WHERE status IN ('pending','running','live') OR (to_jsonb(d)->>'runtimeActive')::boolean IS TRUE`);
    if (active.rows[0].count !== 0) throw new Error("Active runs must be torn down through the API before release");
  }
}

// The caller owns this dedicated session until migrate/postcheck has finished,
// including all Prisma subprocesses. Client.end() releases the lock on every exit.
export async function acquireReleaseOwnership(db: Client) {
  const result = await db.query("SELECT pg_try_advisory_lock($1,$2) AS held", verifierLock);
  if (result.rows[0]?.held !== true) throw new Error("A verifier or another release still owns this database");
}

export async function assertNoWorker(db: Database) {
  const locked = await db.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND classid = 186542854::oid AND objid IN (1::oid,10::oid,12::oid) AND objsubid = 2 AND granted
    AND (objid <> 12::oid OR pid <> pg_backend_pid())) AS held`);
  if (locked.rows[0].held) throw new Error("A simulation worker still owns this database; release must stop it first");
}

export async function migrationPreflight(db: Database) {
  const history = await checkHistory(db, false);
  if (history.count === 0) {
    const tables = await db.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
    if (tables.rows[0].count !== 0) throw new Error("Unmanaged nonempty database cannot be migrated automatically");
  } else if (history.count < 8) {
    throw new Error("Historical non-additive migration requires a separate data-preserving upgrade plan");
  }
  if (history.count > 0 && history.manifest.slice(history.count).some((migration) => !ADDITIVE_MIGRATIONS.has(migration.name))) {
    throw new Error("Pending migration compatibility has not been reviewed for this release path");
  }
  await assertReleaseIdle(db);
  return history;
}
