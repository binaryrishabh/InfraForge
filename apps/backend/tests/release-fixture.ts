// Disposable Docker rehearsal only; this file is never copied into application images.
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { migrationManifest } from "../release/migrations";
const url = new URL(process.env.DATABASE_URL || "");
if (process.env.RELEASE_REHEARSAL !== "owned-local" || url.hostname !== "postgres" || !/^\/infraforge_release_[a-f0-9]{8}$/.test(url.pathname)) {
  throw new Error("Release fixture requires its isolated disposable Compose database");
}
const db = new Client({ connectionString: url.href });
await db.connect();
try {
  const action = process.argv[2];
  if (action === "legacy") {
    await db.query(`CREATE TABLE "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
    for (const item of (await migrationManifest()).slice(0, 8)) {
      await db.query(await readFile(new URL(`../prisma/migrations/${item.name}/migration.sql`, import.meta.url), "utf8"));
      await db.query(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)`,
        [crypto.randomUUID(), item.checksum, item.name]);
    }
    await db.query(`INSERT INTO "Infrastructure" (id,name,layout,"userId","updatedAt") VALUES ('legacy','Legacy','{}','historical-owner',now())`);
  } else if (action === "migration-conflict") {
    await db.query('ALTER TABLE "Deployment" ADD COLUMN "runInputs" JSONB');
  } else if (action === "clear-migration-conflict") {
    // Only this disposable failed statement is repaired; production recovery is manual.
    await db.query('ALTER TABLE "Deployment" DROP COLUMN "runInputs"');
    await db.query(`DELETE FROM "_prisma_migrations" WHERE migration_name='20261009000000_capture_run_inputs' AND finished_at IS NULL`);
  } else if (action === "check-legacy") {
    const record = (await db.query(`SELECT "userId", "ownerId" FROM "Infrastructure" WHERE id='legacy'`)).rows[0];
    if (record?.userId !== "historical-owner" || record.ownerId !== null) throw new Error("Legacy data/ownership changed");
  } else if (action === "failed-history") {
    await db.query(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name) VALUES ('failed','bad','failed-fixture')`);
  } else if (action === "clear-failed") await db.query(`DELETE FROM "_prisma_migrations" WHERE id='failed'`);
  else if (action === "drift") await db.query('ALTER TABLE "Infrastructure" ADD COLUMN "unexpectedFixture" TEXT');
  else if (action === "clear-drift") await db.query('ALTER TABLE "Infrastructure" DROP COLUMN "unexpectedFixture"');
  else if (action === "disable-guard") await db.query('ALTER TABLE "Deployment" DISABLE TRIGGER deployment_inputs_immutable');
  else if (action === "enable-guard") await db.query('ALTER TABLE "Deployment" ENABLE TRIGGER deployment_inputs_immutable');
  else if (action === "active") await db.query(`INSERT INTO "Deployment" (id,"infrastructureId","updatedAt",status) VALUES ('active-fixture','legacy',now(),'live')`);
  else if (action === "clear-active") {
    await db.query(`UPDATE "Deployment" SET status='torn-down' WHERE id='active-fixture'`);
    await db.query(`DELETE FROM "Deployment" WHERE id='active-fixture'`);
  } else throw new Error("Unknown disposable fixture action");
} finally { await db.end(); }
