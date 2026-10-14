import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { checkCredentialSchema } from "../../release/credentialSchema";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 16 preserves OAuth users, rejects ambiguous legacy email and enforces normalized usernames", async () => {
  const settings = readLocalSettings(process.env);
  const admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(settings.databaseUrl); target.pathname = "/" + name;
  const db = new Pool({ connectionString: target.href, ssl: false, options: "" });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(folders).toHaveLength(16);
    for (const folder of folders.slice(0, 15)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const user = randomUUID(), account = randomUUID(), other = randomUUID();
    await db.query('INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'OAuth user\',\'Existing@infraforge.test\',true,now())', [user]);
    await db.query('INSERT INTO "Account" (id,"accountId","providerId","userId","updatedAt") VALUES ($1,$2,\'github\',$3,now())', [account, randomUUID(), user]);
    const usersBefore = (await db.query('SELECT * FROM "User"')).rows;
    const accountsBefore = (await db.query('SELECT * FROM "Account"')).rows;
    await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Ambiguous legacy\',\'existing@infraforge.test\',now())', [other]);
    const sql = await Bun.file(new URL(`${folders[15]}/migration.sql`, directory)).text();
    await rejects(db.query(sql), { code: "23505" });
    await db.query("ROLLBACK");
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='username'")).rowCount).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n).toBe(2);
    // Delete only the second row introduced by this disposable fixture.
    await db.query('DELETE FROM "User" WHERE id=$1', [other]);
    await db.query(sql);
    expect((await db.query('SELECT * FROM "User"')).rows.map(({ username, ...original }) => { expect(username).toBeNull(); return original; })).toEqual(usersBefore);
    expect((await db.query('SELECT * FROM "Account"')).rows).toEqual(accountsBefore);
    await rejects(db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Collision\',\'existing@infraforge.test\',now())', [other]), /duplicate key/);
    await rejects(db.query('UPDATE "User" SET username=\'Rishabh\' WHERE id=$1', [user]), /check constraint/);
    await rejects(db.query('UPDATE "User" SET username=\'1bad\' WHERE id=$1', [user]), /check constraint/);
    await db.query('UPDATE "User" SET username=\'rishabh\' WHERE id=$1', [user]);
    await rejects(db.query('INSERT INTO "User" (id,name,email,username,"updatedAt") VALUES ($1,\'Other\',\'other@infraforge.test\',\'rishabh\',now())', [other]), /duplicate key/);
    await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Another OAuth\',\'other@infraforge.test\',now())', [other]);
    expect((await db.query('SELECT username FROM "User" WHERE id=$1', [other])).rows[0].username).toBeNull();
    await checkCredentialSchema(db);
    await db.query('DROP INDEX "User_email_casefold_key"');
    await rejects(checkCredentialSchema(db), /uniqueness/);
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
