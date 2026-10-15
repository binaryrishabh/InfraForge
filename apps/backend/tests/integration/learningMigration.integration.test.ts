import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { captureRunInputs } from "../../deployments/runInputs";
import { definition, tier } from "../challengeHarness";
import { challengeSeed, specHash } from "../../challenges/registry";
import { checkSchemaGuards } from "../../release/migrations";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 17 preserves populated schema 16 and enforces immutable same-condition learning lineage", async () => {
  const settings = readLocalSettings(process.env), admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  const db = new Pool({ connectionString: url.href, ssl: false, options: "" });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(folders).toHaveLength(17);
    for (const folder of folders.slice(0, 16)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), design = randomUUID(), source = randomUUID(), d = definition("first-production-api");
    await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Local fixture\',$2,now())', [owner, `${owner}@infraforge.test`]);
    const input = captureRunInputs(tier(1), d.workload, challengeSeed(d));
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,$2,$2,\'Before migration\',$3,$4,1,now())', [design, owner, tier(1), d.id]);
    await db.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","runInputs",seed,"workloadProfile","challengeId","challengeVersion",
      "challengeSpecHash","challengePrediction","predictionSubmittedAt","evaluationStopAtSimulatedSeconds","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,now(),$10,now())`,
    [source, design, owner, input, input.seed, input.workloadProfile, d.id, specHash(d), { answers: { health: "healthy", busiest: "Database" }, reasoning: null }, d.evaluationSeconds]);
    await db.query('UPDATE "Deployment" SET status=\'failed\' WHERE id=$1', [source]);
    const before = (await db.query('SELECT * FROM "Deployment"')).rows;
    await db.query(await Bun.file(new URL(`${folders[16]}/migration.sql`, directory)).text());
    expect((await db.query('SELECT * FROM "Deployment"')).rows.map(({ improvementSourceId, learningHypothesis, learningIntent, ...row }) => {
      expect([improvementSourceId, learningHypothesis, learningIntent]).toEqual([null, null, null]); return row;
    })).toEqual(before);
    await checkSchemaGuards(db);
    const insert = (id: string, parent: string, seed = input.seed, hypothesis: string | null = "A learner-owned hypothesis") => db.query(`
      INSERT INTO "Deployment" (id,"infrastructureId","ownerId","runInputs",seed,"workloadProfile","challengeId","challengeVersion",
        "challengeSpecHash","challengePrediction","predictionSubmittedAt","evaluationStopAtSimulatedSeconds","improvementSourceId","learningHypothesis","learningIntent","updatedAt")
      SELECT $1,"infrastructureId","ownerId",jsonb_set("runInputs",'{seed}',to_jsonb($3::text)),$3,"workloadProfile","challengeId","challengeVersion",
        "challengeSpecHash","challengePrediction",now(),"evaluationStopAtSimulatedSeconds",$2,$4,'improvement',now() FROM "Deployment" WHERE id=$5`, [id, parent, seed, hypothesis, source]);
    await expect(insert(randomUUID(), source, "different-seed")).rejects.toThrow("identical challenge conditions");
    await expect(insert(randomUUID(), source, input.seed, null)).rejects.toThrow("check constraint");
    const self = randomUUID(); await expect(insert(self, self)).rejects.toThrow("same-owner source");
    await db.query('UPDATE "Deployment" SET "runtimeActive"=true WHERE id=$1', [source]);
    await expect(insert(randomUUID(), source)).rejects.toThrow("same-owner source");
    await db.query('UPDATE "Deployment" SET "runtimeActive"=false WHERE id=$1', [source]);
    const child = randomUUID(); await insert(child, source);
    await expect(db.query('UPDATE "Deployment" SET "improvementSourceId"=$1 WHERE id=$2', [child, source])).rejects.toThrow("immutable");
    await expect(db.query('UPDATE "Deployment" SET "learningIntent"=\'repeat\' WHERE id=$1', [child])).rejects.toThrow("immutable");
    await db.query('UPDATE "Deployment" SET status=\'failed\' WHERE id=$1', [child]);
    await db.query('DELETE FROM "Deployment" WHERE id=$1', [source]);
    expect((await db.query('SELECT "improvementSourceId","learningHypothesis","learningIntent" FROM "Deployment" WHERE id=$1', [child])).rows[0]).toEqual({ improvementSourceId: null, learningHypothesis: "A learner-owned hypothesis", learningIntent: "improvement" });
    await db.query('DROP TRIGGER deployment_learning_guard ON "Deployment"');
    await expect(checkSchemaGuards(db)).rejects.toThrow("guards");
  } finally {
    await db.end(); if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
  }
}, 30000);
