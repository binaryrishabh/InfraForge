// Disposable Docker rehearsal only; this file is never copied into application images.
import { Client } from "pg";
import { initializeReference } from "../cutover/baseline";
import { seedLegacyFixture, legacyDesignId } from "./cutoverScenario";
const url = new URL(process.env.DATABASE_URL || "");
if (process.env.RELEASE_REHEARSAL !== "owned-local" || url.hostname !== "postgres" || !/^\/infraforge_release_[a-f0-9]{8}$/.test(url.pathname)) {
  throw new Error("Release fixture requires its isolated disposable Compose database");
}
const db = new Client({ connectionString: url.href });
await db.connect();
try {
  const action = process.argv[2];
  if (action === "legacy") {
    await initializeReference(db, url.pathname.slice(1));
    await seedLegacyFixture(db);
  } else if (action === "migration-conflict") {
    await db.query('ALTER TABLE "Deployment" ADD COLUMN "runInputs" JSONB');
  } else if (action === "clear-migration-conflict") {
    // Only this disposable failed statement is repaired; production recovery is manual.
    await db.query('ALTER TABLE "Deployment" DROP COLUMN "runInputs"');
    await db.query(`DELETE FROM "_prisma_migrations" WHERE migration_name='20261009000000_capture_run_inputs' AND finished_at IS NULL`);
  } else if (action === "check-legacy") {
    const record = (await db.query(`SELECT count(*)::int AS count FROM "Infrastructure" WHERE "userId"='test-user' AND "ownerId" IS NULL`)).rows[0];
    if (record?.count !== 28) throw new Error("Legacy data/ownership changed");
  } else if (action === "failed-history") {
    await db.query(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name) VALUES ('failed','bad','failed-fixture')`);
  } else if (action === "clear-failed") await db.query(`DELETE FROM "_prisma_migrations" WHERE id='failed'`);
  else if (action === "drift") await db.query('ALTER TABLE "Infrastructure" ADD COLUMN "unexpectedFixture" TEXT');
  else if (action === "clear-drift") await db.query('ALTER TABLE "Infrastructure" DROP COLUMN "unexpectedFixture"');
  else if (action === "disable-guard") await db.query('ALTER TABLE "Deployment" DISABLE TRIGGER deployment_inputs_immutable');
  else if (action === "enable-guard") await db.query('ALTER TABLE "Deployment" ENABLE TRIGGER deployment_inputs_immutable');
  else if (action === "active") await db.query(`INSERT INTO "Deployment" (id,"infrastructureId","updatedAt",status) VALUES ('active-fixture',$1,now(),'live')`, [legacyDesignId]);
  else if (action === "clear-active") {
    await db.query(`UPDATE "Deployment" SET status='torn-down' WHERE id='active-fixture'`);
    await db.query(`DELETE FROM "Deployment" WHERE id='active-fixture'`);
  } else throw new Error("Unknown disposable fixture action");
} finally { await db.end(); }
