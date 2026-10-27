import { rejects } from "node:assert/strict";
import { expect } from "bun:test";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { checkSchemaGuards } from "../../release/migrations";
import { contentHash } from "../../internalModel2/identity";
import type { LocalHarness } from "./localHarness";
export async function checkLessonUpgrade(h: LocalHarness) {
  const name = `infraforge_it_${crypto.randomUUID().replaceAll("-", "")}`, url = new URL(h.settings.databaseUrl); url.pathname = `/${name}`;
  const db = new Pool({ connectionString: url.href, ssl: false, options: "", connectionTimeoutMillis: 3000, query_timeout: 5000 }); let created = false;
  try {
    await h.sql.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url), folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(folders).toHaveLength(28);
    for (const folder of folders.slice(0, 18)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = crypto.randomUUID(), design = crypto.randomUUID(), run = crypto.randomUUID(), hash = "0".repeat(64);
    await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Legacy M2M fixture\',$2,now())', [owner, `${owner}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'Legacy saved fields\',\'{"resources":[],"connectionLines":[],"unsupported":"retained"}\',now())', [design, owner]);
    await db.query('INSERT INTO "InternalModel2Grant" ("userId",reason) VALUES ($1,\'Existing trusted operator\')', [owner]);
    const insert = (id: string) => db.query('INSERT INTO "InternalModel2Run" (id,"ownerId","infrastructureId","idempotencyKey","requestHash",input,"inputHash") VALUES ($1,$2,$3,$5,$4,\'{}\',$4)', [id, owner, design, hash, id]);
    await insert(run); await db.query('UPDATE "InternalModel2Run" SET status=\'cancelled\' WHERE id=$1', [run]);
    const before = (await db.query('SELECT * FROM "InternalModel2Run"')).rows, saved = (await db.query('SELECT * FROM "Infrastructure"')).rows;
    await db.query(await Bun.file(new URL(`${folders[18]}/migration.sql`, directory)).text());
    const after = (await db.query('SELECT * FROM "InternalModel2Run"')).rows;
    expect(after).toEqual(before); expect((await db.query('SELECT * FROM "Infrastructure"')).rows).toEqual(saved);
    expect((await db.query('SELECT scope FROM "InternalModel2Grant"')).rows[0].scope).toBe("operator");
    // Later additive migrations must also be present before the full release guard set is checked.
    for (const folder of folders.slice(19)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    await checkSchemaGuards(db);
    await rejects(db.query('UPDATE "InternalModel2Grant" SET scope=\'public\''));
    await db.query('UPDATE "InternalModel2Grant" SET scope=\'lesson\'');
    await rejects(insert(crypto.randomUUID()), /immutable lesson metadata/);
    expect((await db.query('SELECT count(*)::int AS n FROM "InternalModel2Run"')).rows[0].n).toBe(1);
    const jsonHash = (value: unknown) => contentHash(JSON.parse(JSON.stringify(value)));
    return { before: jsonHash(before), after: jsonHash(after), saved: jsonHash(saved), existingGrantScope: "operator", invalidScopeRejected: true, unscopedAdmissionRejected: true };
  } finally { await db.end(); if (created) await h.sql.query(`DROP DATABASE "${name}"`); }
}
