import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLocalSettings, childEnvironment } from "./localHarness";
import { migrationManifest } from "../../release/migrations";
import { initializeReference, checkEightMigrationBaseline } from "../../cutover/baseline";
import { collectEvidence, compareRestored } from "../../cutover/evidence";
import { retireLegacyRuns, retirementRequest, FENCE_ACK, RETIREMENT_MESSAGE } from "../../cutover/retire";
import { seedLegacyFixture, legacyDesignId } from "../cutoverScenario";

const integration = process.env.INTEGRATION_RUN === "1" ? describe : describe.skip;
integration("PostgreSQL 18 cutover proof", () => {
  test("Prisma-applied migrations 1–8 independently match the reference builder", async () => {
    const settings = readLocalSettings(process.env);
    const admin = new Client({ connectionString: settings.databaseUrl });
    const names = [0, 1].map(() => `infraforge_it_${randomUUID().replaceAll("-", "")}`);
    const databases: Client[] = [];
    const created: string[] = [];
    const directory = await mkdtemp(join(tmpdir(), "infraforge-prisma-eight-"));
    const backend = fileURLToPath(new URL("../../", import.meta.url));
    await admin.connect();
    try {
      for (const name of names) {
        await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created.push(name);
        const url = new URL(settings.databaseUrl); url.pathname = "/" + name;
        const db = new Client({ connectionString: url.href }); await db.connect(); databases.push(db);
      }
      const manifest = (await migrationManifest()).slice(0, 8);
      const migrationPath = join(directory, "migrations");
      await mkdir(migrationPath);
      await copyFile(join(backend, "prisma/migrations/migration_lock.toml"), join(migrationPath, "migration_lock.toml"));
      for (const item of manifest) {
        await mkdir(join(migrationPath, item.name));
        await copyFile(join(backend, "prisma/migrations", item.name, "migration.sql"), join(migrationPath, item.name, "migration.sql"));
      }
      const config = join(directory, "prisma.config.ts");
      await writeFile(config, `export default { schema: ${JSON.stringify(join(backend, "prisma/schema.prisma"))},
        migrations: { path: ${JSON.stringify(migrationPath)} }, datasource: { url: process.env.DATABASE_URL } };`);
      const target = new URL(settings.databaseUrl); target.pathname = "/" + names[0];
      const environment = { ...childEnvironment(settings, process.env), DATABASE_URL: target.href };
      const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "run", "--bun", "prisma", "migrate", "deploy", "--config", config],
        { cwd: backend, env: environment, stdout: "pipe", stderr: "pipe" });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
      const [output, diagnostic] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
        .finally(() => clearTimeout(timeout));
      if (await child.exited !== 0) throw new Error(`Disposable Prisma migration failed: ${diagnostic.slice(-2000)}`);
      expect(output).toContain("All migrations have been successfully applied");
      const [prisma, reference] = databases as [Client, Client];
      const history = (await prisma.query('SELECT migration_name,checksum,finished_at,applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name')).rows;
      expect(history).toHaveLength(8);
      expect(history.map((row) => row.migration_name)).toEqual(manifest.map((item) => item.name));
      expect(history.every((row, index) => manifest[index]!.checksums.includes(row.checksum) && row.finished_at && row.applied_steps_count === 1)).toBe(true);
      await initializeReference(reference, names[1]!);
      expect((await checkEightMigrationBaseline(prisma, reference)).result).toBe("PASS");
    } finally {
      await Promise.allSettled(databases.map((db) => db.end()));
      for (const name of created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
      if (!resolve(directory).startsWith(resolve(tmpdir(), "infraforge-prisma-eight-"))) throw new Error("Invalid fixture directory");
      await rm(directory, { recursive: true });
    }
  }, 60000);

  test("read-only evidence, exact baseline drift, atomic retirement and preserved checkpoints", async () => {
    const settings = readLocalSettings(process.env);
    const admin = new Client({ connectionString: settings.databaseUrl });
    await admin.connect();
    const names = [0, 1].map(() => `infraforge_it_${randomUUID().replaceAll("-", "")}`);
    const databases: Client[] = [];
    const created: string[] = [];
    const role = `infraforge_read_${randomUUID().replaceAll("-", "")}`;
    let roleCreated = false;
    try {
      for (const name of names) {
        await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created.push(name);
        const url = new URL(settings.databaseUrl); url.pathname = "/" + name;
        const db = new Client({ connectionString: url.href }); await db.connect(); databases.push(db);
        await initializeReference(db, name);
      }
      const [db, reference] = databases as [Client, Client];
      const ids = await seedLegacyFixture(db);
      const request = (selected = ids) => retirementRequest(selected, FENCE_ACK, "disposable-fixture-fencing");
      const rejected = async (selected = ids, message?: string) => {
        // Await database I/O before invoking matchers: Bun's native rejects
        // matcher can stall PostgreSQL BEGIN replies on Windows.
        let error: unknown;
        // A transient table lock can preempt the semantic rejection being tested.
        // Retry only that rolled-back NOWAIT result. The explicit lock-conflict
        // assertion below calls retirement directly and still requires 55P03.
        for (let retry = 0; retry <= 20; retry++) {
          error = await retireLegacyRuns(db, request(selected)).then(() => null, (failure: unknown) => failure);
          if ((error as { code?: string } | null)?.code !== "55P03" || retry === 20) break;
          await Bun.sleep(100);
        }
        expect(error).toBeInstanceOf(Error);
        if (message) expect((error as Error).message).toContain(message);
      };
      const snapshot = async () => ({ designs: (await db.query('SELECT * FROM "Infrastructure" ORDER BY id')).rows,
        runs: (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows,
        outbox: (await db.query('SELECT * FROM "Outbox" ORDER BY id')).rows });
      const before = await snapshot();
      const evidence = await collectEvidence(db);
      expect(evidence.identity.versionNumber).toBeGreaterThanOrEqual(180000);
      expect(evidence.counts).toEqual({ Infrastructure: 28, Deployment: 331, Outbox: 348 });
      expect(evidence.activeDeployments).toHaveLength(4);
      expect(evidence.pendingNameCollisions).toEqual([]);
      expect(evidence.historicalOwners).toEqual([{ marker: "test-user", count: 28 }]);
      expect(evidence.verifiedOwners).toBeNull();
      expect(await snapshot()).toEqual(before);
      // A real SELECT-only role proves the evidence command needs no write privileges.
      await admin.query(`CREATE ROLE "${role}" NOLOGIN`); roleCreated = true;
      await db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`);
      await db.query(`SET ROLE "${role}"`);
      expect((await collectEvidence(db)).contentHashes).toEqual(evidence.contentHashes);
      await db.query("RESET ROLE");
      expect(await snapshot()).toEqual(before);
      expect((await checkEightMigrationBaseline(db, reference)).result).toBe("PASS");

      const peerUrl = new URL(settings.databaseUrl); peerUrl.pathname = "/" + names[0];
      const peer = new Client({ connectionString: peerUrl.href }); await peer.connect();
      try {
        await rejected(ids, "clients remain");
        expect(await snapshot()).toEqual(before);
        await peer.query("SELECT pg_advisory_lock(186542854,1)");
        await rejected(ids, "worker still owns");
        expect(await snapshot()).toEqual(before);
        await peer.query("SELECT pg_advisory_unlock(186542854,1)");
        await peer.query("BEGIN");
        await peer.query('UPDATE "Deployment" SET status=status WHERE id=$1', [ids[0]]);
        const started = Date.now();
        const conflict = await retireLegacyRuns(db, request()).then(() => null, (failure: unknown) => failure);
        expect((conflict as { code: string }).code).toBe("55P03");
        expect(Date.now() - started).toBeLessThan(2000);
        await peer.query("ROLLBACK");
        expect(await snapshot()).toEqual(before);
      } finally { await peer.end(); }
      await db.query('ALTER TABLE "Infrastructure" ADD COLUMN "unexpected" TEXT');
      const drift = await checkEightMigrationBaseline(db, reference);
      expect(drift.result).toBe("FAIL");
      expect(drift.differences.some((row) => row.object === "column:Infrastructure.unexpected")).toBe(true);
      await db.query('ALTER TABLE "Infrastructure" DROP COLUMN "unexpected"');
      expect((await checkEightMigrationBaseline(db, reference)).result).toBe("PASS");
      // LIKE 'pg_%' treats '_' as a wildcard and incorrectly hides pgfixture.
      await db.query('CREATE SCHEMA pgfixture');
      const schemaDrift = await checkEightMigrationBaseline(db, reference);
      expect(schemaDrift.result).toBe("FAIL");
      expect(schemaDrift.differences.some((row) => row.object === "schema:pgfixture")).toBe(true);
      await db.query('DROP SCHEMA pgfixture');
      expect((await checkEightMigrationBaseline(db, reference)).result).toBe("PASS");

      for (const selected of [[randomUUID(), ...ids.slice(1)], ids.slice(1)]) {
        await rejected(selected);
        expect(await snapshot()).toEqual(before);
      }
      await db.query('UPDATE "_prisma_migrations" SET rolled_back_at=now() WHERE migration_name=(SELECT max(migration_name) FROM "_prisma_migrations")');
      const shortHistory = await snapshot();
      await rejected(ids, "eight-migration");
      expect(await snapshot()).toEqual(shortHistory);
      await db.query('UPDATE "_prisma_migrations" SET rolled_back_at=NULL');
      for (const status of ["pending", "running", "live"]) {
        const extra = randomUUID();
        await db.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,"updatedAt") VALUES ($1,$2,$3,now())`, [extra, legacyDesignId, status]);
        const unchanged = await snapshot();
        await rejected(ids, "outside");
        expect(await snapshot()).toEqual(unchanged);
        await db.query('DELETE FROM "Deployment" WHERE id=$1', [extra]);
      }
      await db.query(`UPDATE "Deployment" SET status='completed' WHERE id=$1`, [ids[0]]);
      const unexpected = await snapshot();
      await rejected(ids, "exactly live");
      expect(await snapshot()).toEqual(unexpected);
      await db.query(`UPDATE "Deployment" SET status='live' WHERE id=$1`, [ids[0]]);
      await db.query(`UPDATE "Deployment" SET timeline='{}'::jsonb WHERE id=$1`, [ids[0]]);
      const malformed = await snapshot();
      await rejected(ids, "array timeline");
      expect(await snapshot()).toEqual(malformed);
      await db.query('UPDATE "Deployment" SET timeline=$2::jsonb WHERE id=$1', [ids[0], JSON.stringify(before.runs.find((row) => row.id === ids[0])!.timeline)]);
      for (const status of ["pending", "processing", "running"]) {
        await db.query('UPDATE "Outbox" SET status=$1 WHERE id=(SELECT id FROM "Outbox" LIMIT 1)', [status]);
        const pending = await snapshot();
        await rejected(ids, "outbox");
        expect(await snapshot()).toEqual(pending);
        await db.query(`UPDATE "Outbox" SET status='completed'`);
      }
      await db.query(`CREATE FUNCTION fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id='${ids[3]}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fixture_failure BEFORE UPDATE ON "Deployment" FOR EACH ROW EXECUTE FUNCTION fixture_failure()`);
      await rejected(ids, "fixture failure");
      expect(await snapshot()).toEqual(before);
      await db.query('DROP TRIGGER fixture_failure ON "Deployment"; DROP FUNCTION fixture_failure()');

      await db.query("SET TIME ZONE 'Asia/Kolkata'");
      const retired = await retireLegacyRuns(db, request());
      expect(retired.count).toBe(4);
      expect((await db.query("SHOW TIME ZONE")).rows[0].TimeZone).toBe("Asia/Kolkata");
      const after = await snapshot();
      expect(after.designs).toEqual(before.designs);
      expect(after.outbox).toEqual(before.outbox);
      for (let index = 0; index < after.runs.length; index++) {
        const old = before.runs[index]!; const current = after.runs[index]!;
        if (!ids.includes(old.id)) { expect(current).toEqual(old); continue; }
        const { status, timeline, updatedAt, ...preserved } = current;
        const { status: oldStatus, timeline: oldTimeline, updatedAt: oldUpdated, ...oldPreserved } = old;
        expect(preserved).toEqual(oldPreserved);
        expect(status).toBe("torn-down");
        expect(timeline.slice(0, -1)).toEqual(oldTimeline);
        expect(timeline.at(-1).message).toBe(RETIREMENT_MESSAGE);
        expect(timeline.at(-1).evidence).toBe("disposable-fixture-fencing");
        expect(timeline.at(-1).timestamp).toMatch(/\+00:00$/);
      }
      const times = await db.query(`SELECT abs(extract(epoch FROM ("updatedAt" -
        ((timeline->-1->>'timestamp')::timestamptz AT TIME ZONE 'UTC')))) AS difference FROM "Deployment" WHERE id=ANY($1::text[])`, [ids]);
      expect(times.rows.every((row) => Number(row.difference) < 0.001)).toBe(true);
      await rejected(ids, "exactly live");
      expect(await snapshot()).toEqual(after);
      const changedEvidence = await collectEvidence(db);
      expect(compareRestored(evidence, changedEvidence).result).toBe("FAIL");
      expect(compareRestored(changedEvidence, await collectEvidence(db)).result).toBe("PASS");
    } finally {
      for (const db of databases) {
        await db.query("RESET ROLE").catch(() => {});
        if (roleCreated) await db.query(`DROP OWNED BY "${role}"`).catch(() => {});
        await db.end();
      }
      for (const name of created) await admin.query(`DROP DATABASE "${name}"`);
      if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
      await admin.end();
    }
  }, 90000);
});
