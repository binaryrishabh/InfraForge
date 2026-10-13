import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("run-evidence migration preserves verified and quarantined history, names and nullable design references", async () => {
  const settings = readLocalSettings(process.env);
  const admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(settings.databaseUrl); target.pathname = "/" + name;
  const db = new Pool({ connectionString: target.href, ssl: false, options: "" });
  let created = false;
  try {
    expect((await admin.query("SELECT current_database() AS name")).rows[0].name).toBe(settings.databaseName);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).filter((name) => name <= "20261013000000_reliable_run_evidence").sort();
    expect(folders.at(-1)).toBe("20261013000000_reliable_run_evidence");
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const user = randomUUID(), owned = randomUUID(), legacy = randomUUID(), ownedRun = randomUUID(), legacyRun = randomUUID();
    await db.query('INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'Verified fixture\',$2,true,now())', [user, `${user}@infraforge.test`]);
    for (const [id, owner, title] of [[owned, user, "Captured owned name"], [legacy, null, "Legacy name"]]) {
      await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,\'test-user\',$2,$3,\'{}\',now())', [id, owner, title]);
    }
    for (const [id, parent] of [[ownedRun, owned], [legacyRun, legacy]]) {
      await db.query('INSERT INTO "Deployment" (id,"infrastructureId",status,seed,"simulationState","updatedAt") VALUES ($1,$2,\'completed\',\'legacy seed\',\'{"simulatedSeconds":5}\',now())', [id, parent]);
    }
    const before = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    await db.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, directory)).text());
    const after = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    expect(after.map(({ ownerId, runName, actionSequence, terminalSnapshot, ...old }) => old)).toEqual(before);
    expect(after.find((r) => r.id === ownedRun)).toMatchObject({ ownerId: user, runName: "Captured owned name", actionSequence: 0, terminalSnapshot: null });
    expect(after.find((r) => r.id === legacyRun)?.ownerId).toBeNull();
    await db.query('UPDATE "Infrastructure" SET name=\'Renamed\' WHERE id=$1', [owned]);
    await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [owned]);
    expect((await db.query('SELECT "ownerId","runName","infrastructureId","simulationState" FROM "Deployment" WHERE id=$1', [ownedRun])).rows[0])
      .toEqual({ ownerId: user, runName: "Captured owned name", infrastructureId: null, simulationState: { simulatedSeconds: 5 } });
    const active = randomUUID();
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId",status,"updatedAt") VALUES ($1,$2,\'live\',now())', [active, legacy]);
    await rejects(db.query('DELETE FROM "Infrastructure" WHERE id=$1', [legacy]), /active/);
    await rejects(db.query('UPDATE "Deployment" SET "infrastructureId"=NULL WHERE id=$1', [active]), /detached/);
    await rejects(db.query('UPDATE "Deployment" SET "ownerId"=$1 WHERE id=$2', [user, legacyRun]), /recovery/);
    expect((await db.query('SELECT "ownerId" FROM "Deployment" WHERE id=$1', [legacyRun])).rows[0].ownerId).toBeNull();
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
