import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { captureRunInputs } from "../../deployments/runInputs";
import { layout, workload } from "./scenario";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 12 preserves history and guards owned rerun identity, lineage and designless exact inputs", async () => {
  const settings = readLocalSettings(process.env);
  const admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  const db = new Pool({ connectionString: url.href, ssl: false, options: "" });
  let created = false;
  try {
    expect((await admin.query("SELECT current_database() AS name")).rows[0].name).toBe(settings.databaseName);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).filter((name) => name <= "20261013010000_honest_reruns").sort();
    expect(folders.at(-1)).toBe("20261013010000_honest_reruns");
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), other = randomUUID(), design = randomUUID(), source = randomUUID(), legacy = randomUUID();
    for (const id of [owner, other]) await db.query('INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'Owner fixture\',$2,true,now())', [id, `${id}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,\'test-user\',$2,\'Source name\',$3,now())', [design, owner, layout]);
    const input = { ...captureRunInputs(layout, workload), seed: "migration-rerun" };
    const final = { version: 1, kind: "terminal", capturedAt: new Date().toISOString(), topologyRevision: 0, simulatedSeconds: 620,
      overallHealth: "healthy", accumulatedCostUsd: 1, metrics: {} };
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","terminalSnapshot","updatedAt") VALUES ($1,$2,\'torn-down\',$3,$4,$5,$6,now())', [source, design, input, input.seed, input.workloadProfile, final]);
    await db.query('INSERT INTO "Deployment" (id,status,"updatedAt") VALUES ($1,\'failed\',now())', [legacy]);
    const before = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    await db.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, directory)).text());
    const after = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    expect(after.map(({ sourceRunId, rerunMode, autoStopAtSimulatedSeconds, ...old }) => old)).toEqual(before);
    expect(after.every((r) => r.sourceRunId === null && r.rerunMode === null && r.autoStopAtSimulatedSeconds === null)).toBe(true);
    const insert = (changes: { owner?: string; parent?: string | null; from?: string | null; mode?: string | null; inputs?: object; target?: number | null } = {}) => {
      const id = randomUUID();
      return db.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","sourceRunId","rerunMode","autoStopAtSimulatedSeconds",
        "runInputs",seed,"workloadProfile","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) RETURNING *`,
        [id, changes.parent === undefined ? design : changes.parent, changes.owner ?? owner,
          changes.from === undefined ? source : changes.from, changes.mode === undefined ? "exact" : changes.mode,
          changes.target ?? null, changes.inputs ?? input, input.seed, input.workloadProfile]);
    };
    const exact = (await insert({ target: 620 })).rows[0];
    expect(exact).toMatchObject({ ownerId: owner, runName: "Source name", sourceRunId: source, rerunMode: "exact", autoStopAtSimulatedSeconds: 620 });
    await rejects(insert({ owner: other }), /same verified owner/);
    await rejects(insert({ from: legacy }), /same verified owner/);
    await rejects(insert({ from: randomUUID() }), /same verified owner/);
    await rejects(insert({ inputs: { ...input, seed: "different" } }), /identical/);
    await rejects(insert({ target: 619 }), /exact source terminal/);
    await rejects(insert({ target: 604801 }), /exact source terminal|check constraint/);
    await rejects(insert({ parent: null, from: null, mode: null }), /require a design/);
    await rejects(db.query('UPDATE "Deployment" SET "sourceRunId"=$1 WHERE id=$2', [exact.id, source]), /immutable/);
    await rejects(db.query('UPDATE "Deployment" SET "sourceRunId"=NULL WHERE id=$1', [exact.id]), /immutable/);
    await rejects(db.query('UPDATE "Deployment" SET "rerunMode"=\'current-design\' WHERE id=$1', [exact.id]), /immutable/);
    await rejects(db.query('UPDATE "Deployment" SET "autoStopAtSimulatedSeconds"=619 WHERE id=$1', [exact.id]), /immutable/);
    await db.query('UPDATE "Deployment" SET status=\'failed\' WHERE id=$1', [exact.id]);
    await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [design]);
    const detached = (await insert({ parent: null })).rows[0];
    expect(detached).toMatchObject({ infrastructureId: null, ownerId: owner, runName: "Source name", runInputs: input });
    await rejects(insert({ parent: null, mode: "current-design" }), /missing current design/);
    await db.query('DELETE FROM "Deployment" WHERE id=$1', [source]);
    expect((await db.query('SELECT "sourceRunId","rerunMode","ownerId" FROM "Deployment" WHERE id=$1', [detached.id])).rows[0])
      .toEqual({ sourceRunId: null, rerunMode: "exact", ownerId: owner });
    expect((await db.query('SELECT "ownerId" FROM "Deployment" WHERE id=$1', [legacy])).rows[0].ownerId).toBeNull();
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
