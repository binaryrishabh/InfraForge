import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { checkHistory, migrationManifest } from "../release/migrations";
import { CutoverError, readOnly, requirePostgres18, type Database } from "./database";
import { schemaCatalog } from "./catalog";
import { compareSchema } from "./evidence";

// Only a newly created, explicitly named local reference may be initialized.
// The target of the comparison is never passed to this function by the CLI.
export async function initializeReference(db: Database, name: string) {
  if (!/^infraforge_(reference|it|release)_[a-f0-9]{8,64}$/.test(name)) throw new CutoverError("Invalid disposable reference name");
  await requirePostgres18(db);
  const identity = await db.query("SELECT current_database() AS name");
  if (identity.rows[0].name !== name) throw new CutoverError("Reference database identity mismatch");
  const objects = await db.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`);
  if (objects.rows[0].count) throw new CutoverError("Reference database must be empty");
  await db.query("BEGIN");
  try {
    await db.query(`CREATE TABLE public."_prisma_migrations" (id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
    for (const item of (await migrationManifest()).slice(0, 8)) {
      await db.query(await readFile(new URL(`../prisma/migrations/${item.name}/migration.sql`, import.meta.url), "utf8"));
      await db.query(`INSERT INTO public."_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count)
        VALUES ($1,$2,$3,now(),1)`, [randomUUID(), item.checksum, item.name]);
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

async function eightCatalog(db: Database) {
  return readOnly(db, async () => {
    await requirePostgres18(db);
    if ((await checkHistory(db, false)).count !== 8) throw new CutoverError("Exactly migrations 1–8 must be applied successfully");
    return schemaCatalog(db);
  });
}

export async function checkEightMigrationBaseline(target: Database, reference: Database) {
  const expected = await eightCatalog(reference);
  return compareSchema(expected, await eightCatalog(target));
}
