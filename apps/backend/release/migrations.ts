import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Client, Pool } from "pg";

type Database = Pick<Client | Pool, "query">;
export type Migration = { name: string; checksum: string; checksums: string[] };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

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

export async function checkSchemaGuards(db: Database) {
  // Prisma's schema diff cannot check SQL triggers. Check them separately.
  const result = await db.query(`SELECT tgname, tgtype, pg_get_triggerdef(t.oid) AS definition, p.proname, p.prosrc
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE NOT tgisinternal AND tgenabled = 'O' AND n.nspname = 'public' AND NOT p.prosecdef
    AND p.prorettype = 'trigger'::regtype AND p.proconfig IS NULL
    AND p.prolang = (SELECT oid FROM pg_language WHERE lanname='plpgsql') AND tgqual IS NULL
    AND ((tgrelid = '"Deployment"'::regclass AND tgname IN ('deployment_inputs_immutable', 'deployment_active_delete_guard'))
      OR (tgrelid = '"Infrastructure"'::regclass AND tgname = 'design_owner_guard'))`);
  if (result.rows.length !== 3) throw new Error("Required ownership/run-input database guards are missing or disabled");
  const sources = (await Promise.all(["20261009000000_capture_run_inputs", "20261009010000_add_authentication"].map((name) =>
    readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8")))).join("\n");
  const bodies = new Map([...sources.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$/g)]
    .map((match) => [match[1], match[2]!.replace(/\r\n/g, "\n").trim()]));
  const expected: Record<string, [string, number, string]> = {
    deployment_inputs_immutable: ["protect_deployment_inputs", 19, 'BEFORE UPDATE OF "runInputs", seed, "workloadProfile" ON public."Deployment"'],
    deployment_active_delete_guard: ["protect_active_deployment", 11, 'BEFORE DELETE ON public."Deployment"'],
    design_owner_guard: ["protect_design_owner", 19, 'BEFORE UPDATE OF "ownerId" ON public."Infrastructure"'],
  };
  for (const row of result.rows) {
    const guard = expected[row.tgname];
    if (!guard || row.proname !== guard[0] || row.tgtype !== guard[1] || !row.definition.includes(guard[2]) ||
      row.prosrc.replace(/\r\n/g, "\n").trim() !== bodies.get(row.proname)) throw new Error("Database guard definition differs from this release");
  }
  await db.query(`SELECT d."runInputs", d."liveTopology", d."topologyRevision", d."runtimeActive", i."ownerId",
    s."expiresAt", a."providerId", v.identifier FROM "Deployment" d CROSS JOIN "Infrastructure" i
    CROSS JOIN "Session" s CROSS JOIN "Account" a CROSS JOIN "Verification" v LIMIT 0`);
}

export async function assertReleaseIdle(db: Database) {
  const tables = await db.query("SELECT to_regclass('public.\"Deployment\"') IS NOT NULL AS present");
  if (tables.rows[0].present) {
    // The JSON lookup also works before the additive runtimeActive column exists.
    const active = await db.query(`SELECT count(*)::int AS count FROM "Deployment" d
      WHERE status IN ('pending','running','live') OR (to_jsonb(d)->>'runtimeActive')::boolean IS TRUE`);
    if (active.rows[0].count !== 0) throw new Error("Active runs must be torn down through the API before release");
  }
}

export async function assertNoWorker(db: Database) {
  const locked = await db.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND classid = 186542854::oid AND objid = 1::oid AND objsubid = 2 AND granted) AS held`);
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
  const additive = new Set(["20261009000000_capture_run_inputs", "20261009010000_add_authentication"]);
  if (history.count > 0 && history.manifest.slice(history.count).some((migration) => !additive.has(migration.name))) {
    throw new Error("Pending migration compatibility has not been reviewed for this release path");
  }
  await assertReleaseIdle(db);
  return history;
}
