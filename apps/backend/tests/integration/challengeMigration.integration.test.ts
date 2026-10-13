import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { captureRunInputs } from "../../deployments/runInputs";
import { layout, workload } from "./scenario";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 13 preserves history and guards verified, immutable challenge attempts", async () => {
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
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
      .filter((folder) => folder <= "20261014000000_challenge_attempts").sort();
    expect(folders.at(-1)).toBe("20261014000000_challenge_attempts");
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), other = randomUUID(), design = randomUUID(), workspace = randomUUID(), foreign = randomUUID(), legacy = randomUUID();
    for (const id of [owner, other]) await db.query('INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'Owner fixture\',$2,true,now())', [id, `${id}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,\'test-user\',$2,\'Freeform\',$3,now())', [design, owner, layout]);
    const input = { ...captureRunInputs(layout, workload), seed: "challenge-migration" };
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","updatedAt") VALUES ($1,$2,\'torn-down\',$3,$4,$5,now())', [randomUUID(), design, input, input.seed, input.workloadProfile]);
    await db.query('INSERT INTO "Deployment" (id,status,"updatedAt") VALUES ($1,\'failed\',now())', [legacy]);
    const before = { runs: (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows, designs: (await db.query('SELECT * FROM "Infrastructure" ORDER BY id')).rows };
    await db.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, directory)).text());
    const after = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    expect(after.map(({ challengeId, challengeVersion, challengeSpecHash, challengePrediction, predictionSubmittedAt, evaluationStopAtSimulatedSeconds, ...old }) => old)).toEqual(before.runs);
    expect(after.every((r) => r.challengeId === null && r.challengePrediction === null && r.evaluationStopAtSimulatedSeconds === null)).toBe(true);
    expect((await db.query('SELECT * FROM "Infrastructure" ORDER BY id')).rows.map(({ challengeId, ...old }) => old)).toEqual(before.designs);

    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","updatedAt") VALUES ($1,\'test-user\',$2,\'Workspace\',$3,\'first-production-api\',now())', [workspace, owner, layout]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","updatedAt") VALUES ($1,\'test-user\',$2,\'Other workspace\',$3,\'first-production-api\',now())', [foreign, other, layout]);
    const prediction = { answers: { health: "healthy" }, reasoning: null };
    const attempt = (changes: Record<string, unknown> = {}) => {
      const row = { id: randomUUID(), infrastructureId: workspace, ownerId: owner, challengeId: "first-production-api", challengeVersion: 1,
        challengeSpecHash: "a".repeat(64), challengePrediction: prediction, predictionSubmittedAt: new Date("2000-01-01"), evaluationStopAtSimulatedSeconds: 120,
        status: "pending", sourceRunId: null, rerunMode: null, ...changes };
      return db.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","challengeId","challengeVersion","challengeSpecHash","challengePrediction",
        "predictionSubmittedAt","evaluationStopAtSimulatedSeconds",status,"sourceRunId","rerunMode","runInputs",seed,"workloadProfile","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) RETURNING *`,
        [row.id, row.infrastructureId, row.ownerId, row.challengeId, row.challengeVersion, row.challengeSpecHash, row.challengePrediction,
          row.predictionSubmittedAt, row.evaluationStopAtSimulatedSeconds, row.status, row.sourceRunId, row.rerunMode, input, input.seed, input.workloadProfile]);
    };
    const ok = (await attempt()).rows[0];
    expect(ok.predictionSubmittedAt.getTime()).toBeGreaterThan(new Date("2001-01-01").getTime());
    await rejects(attempt({ infrastructureId: design }), /workspace design/);
    await rejects(attempt({ infrastructureId: foreign }), /workspace design|verified design owner/);
    await rejects(attempt({ challengeId: "cache-matters" }), /workspace design/);
    await rejects(attempt({ status: "live" }), /before the attempt starts/);
    await rejects(attempt({ challengePrediction: null }), /check constraint/);
    await rejects(attempt({ evaluationStopAtSimulatedSeconds: null }), /check constraint/);
    await rejects(attempt({ challengeSpecHash: "short" }), /check constraint/);
    await rejects(attempt({ sourceRunId: ok.id, rerunMode: "exact" }), /check constraint|verified owner|identical/);
    for (const [column, value] of [["challengeId", "cache-matters"], ["challengePrediction", '{"answers":{},"reasoning":null}'],
      ["challengeSpecHash", "b".repeat(64)], ["evaluationStopAtSimulatedSeconds", 90], ["predictionSubmittedAt", new Date()]] as const) {
      await rejects(db.query(`UPDATE "Deployment" SET "${column}"=$1 WHERE id=$2`, [value, ok.id]), /immutable/);
    }
    await rejects(db.query('UPDATE "Infrastructure" SET "challengeId"=NULL WHERE id=$1', [workspace]), /immutable/);
    await rejects(db.query('UPDATE "Infrastructure" SET "challengeId"=\'first-production-api\' WHERE id=$1', [design]), /immutable/);
    const action = (kind: string, sequence: number) => db.query('INSERT INTO "RunAction" (id,"deploymentId",sequence,kind,parameters) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), ok.id, sequence, kind, kind === "speed" ? { speed: 60 } : kind === "teardown" ? { trigger: "challenge-evaluation" } : {}]);
    await action("speed", 1); await action("teardown", 2);
    for (const kind of ["load", "chaos", "vertical-scale", "pool-scale", "topology"]) await rejects(action(kind, 3), /only speed changes and stopping/);
    await db.query('UPDATE "Deployment" SET status=\'torn-down\' WHERE id=$1', [ok.id]);
    await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [workspace]);
    expect((await db.query('SELECT "infrastructureId","challengeId","challengePrediction" FROM "Deployment" WHERE id=$1', [ok.id])).rows[0])
      .toEqual({ infrastructureId: null, challengeId: "first-production-api", challengePrediction: prediction });
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
