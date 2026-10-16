import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { checkModel1SchemaGuards, assertReleaseIdle } from "../../release/migrations";
import { checkInternalModel2Schema } from "../../release/model2Schema";
// This fixture deliberately stops at migration 18. Current release checks also
// require migration 19; do not reinterpret historical schema-18 readiness.
const checkSchemaGuards = async (db: Pool) => { await checkModel1SchemaGuards(db); await checkInternalModel2Schema(db); };
const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 18 preserves schema-17 history and guards immutable bounded internal execution", async () => {
  const settings = readLocalSettings(process.env), admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  const db = new Pool({ connectionString: url.href, ssl: false, options: "" }); let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url), folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name <= "20261019000000_internal_model2").map((e) => e.name).sort();
    expect(folders).toHaveLength(18);
    for (const folder of folders.slice(0, 17)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), other = randomUUID(), design = randomUUID();
    await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Migration fixture\',$2,now()),($3,\'Other fixture\',$4,now())', [owner, `${owner}@infraforge.test`, other, `${other}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'Retained old design\',\'{"resources":[],"connectionLines":[]}\',now())', [design, owner]);
    const before = (await db.query('SELECT * FROM "Infrastructure"')).rows;
    const usersBefore = (await db.query('SELECT * FROM "User" ORDER BY id')).rows;
    await db.query(await Bun.file(new URL(`${folders[17]}/migration.sql`, directory)).text());
    expect((await db.query('SELECT * FROM "Infrastructure"')).rows).toEqual(before);
    expect((await db.query('SELECT * FROM "User" ORDER BY id')).rows).toEqual(usersBefore);
    expect((await db.query('SELECT * FROM "InternalModel2Grant"')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM "InternalModel2Run"')).rows).toEqual([]);
    await checkSchemaGuards(db);
    const insert = (id: string, actor = owner) => db.query(`INSERT INTO "InternalModel2Run" (id,"ownerId","infrastructureId","idempotencyKey","requestHash",input,"inputHash") VALUES ($1,$2,$3,$5,$4,'{}',$4)`, [id, actor, design, "0".repeat(64), id]);
    await expect(insert(randomUUID())).rejects.toThrow("granted same-owner");
    await db.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Disposable migration proof\'),($2,\'Other grant\')', [owner, other]);
    await expect(insert(randomUUID(), other)).rejects.toThrow("granted same-owner");
    const id = randomUUID(); await insert(id);
    await expect(assertReleaseIdle(db)).rejects.toThrow("Active internal Model-2");
    await expect(db.query('DELETE FROM "InternalModel2Run" WHERE id=$1', [id])).rejects.toThrow("Active internal run");
    await expect(db.query('UPDATE "InternalModel2Run" SET input=\'{"changed":true}\' WHERE id=$1', [id])).rejects.toThrow("immutable");
    await db.query('UPDATE "InternalModel2Run" SET status=\'running\',token=\'first-owner\' WHERE id=$1', [id]);
    await expect(db.query('UPDATE "InternalModel2Run" SET token=\'replacement\' WHERE id=$1', [id])).rejects.toThrow("transition");
    await expect(db.query('UPDATE "InternalModel2Run" SET sequence=2,evidence=\'{}\' WHERE id=$1', [id])).rejects.toThrow("transition");
    await expect(db.query('UPDATE "InternalModel2Run" SET "throughUs"=1 WHERE id=$1', [id])).rejects.toThrow();
    await expect(db.query('UPDATE "InternalModel2Run" SET input=$2 WHERE id=$1', [id, { excessive: "x".repeat(786433) }])).rejects.toThrow("budget");
    await db.query('UPDATE "InternalModel2Run" SET evidence=\'{"prefix":true}\',sequence=1,status=\'interrupted\',reason=\'Safe prefix\' WHERE id=$1', [id]);
    await expect(db.query('UPDATE "InternalModel2Run" SET reason=\'Rewritten\' WHERE id=$1', [id])).rejects.toThrow("immutable");
    await assertReleaseIdle(db);
    await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [design]);
    expect((await db.query('SELECT "infrastructureId",evidence FROM "InternalModel2Run" WHERE id=$1', [id])).rows[0]).toEqual({ infrastructureId: null, evidence: { prefix: true } });
    await db.query('DROP TRIGGER internal_model2_guard ON "InternalModel2Run"');
    await expect(checkSchemaGuards(db)).rejects.toThrow("guard");
  } finally { await db.end(); if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end(); }
}, 30000);
