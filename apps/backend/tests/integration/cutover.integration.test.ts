import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { readLocalSettings } from "./localHarness";
import { initializeReference, checkEightMigrationBaseline } from "../../cutover/baseline";
import { collectEvidence, compareRestored } from "../../cutover/evidence";
import { retireLegacyRuns, retirementRequest, FENCE_ACK, RETIREMENT_MESSAGE } from "../../cutover/retire";
import { seedLegacyFixture, legacyDesignId } from "../cutoverScenario";

const integration = process.env.INTEGRATION_RUN === "1" ? describe : describe.skip;
integration("PostgreSQL 18 cutover proof", () => {
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
        const error = await retireLegacyRuns(db, request(selected)).then(() => null, (failure: unknown) => failure);
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
      await db.query(`UPDATE "Outbox" SET status='pending' WHERE id=(SELECT id FROM "Outbox" LIMIT 1)`);
      const pending = await snapshot();
      await rejected(ids, "outbox");
      expect(await snapshot()).toEqual(pending);
      await db.query(`UPDATE "Outbox" SET status='completed'`);
      await db.query(`CREATE FUNCTION fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id='${ids[3]}' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fixture_failure BEFORE UPDATE ON "Deployment" FOR EACH ROW EXECUTE FUNCTION fixture_failure()`);
      await rejected(ids, "fixture failure");
      expect(await snapshot()).toEqual(before);
      await db.query('DROP TRIGGER fixture_failure ON "Deployment"; DROP FUNCTION fixture_failure()');

      const retired = await retireLegacyRuns(db, request());
      expect(retired.count).toBe(4);
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
      }
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
