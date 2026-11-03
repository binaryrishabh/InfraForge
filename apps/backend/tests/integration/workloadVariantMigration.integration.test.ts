import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { captureRunInputs } from "../../deployments/runInputs";
import { applyWorkloadVariant } from "@infraforge/domain/workload";
import { layout, workload } from "./scenario";
import { checkModel1SchemaGuards } from "../../release/migrations";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("workload variants preserve history and all existing SQL identity guards", async () => {
  const settings = readLocalSettings(process.env), admin = new Pool({connectionString: settings.databaseUrl, ssl: false, options: ""});
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  const db = new Pool({connectionString: url.href, ssl: false, options: ""});
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, {withFileTypes: true})).filter(e => e.isDirectory()).map(e => e.name).sort();
    expect(folders.at(-1)).toBe("20261103000000_workload_variant_reruns");
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), other = randomUUID(), design = randomUUID(), source = randomUUID();
    for (const id of [owner, other]) await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Fixture\',$2,now())', [id, `${id}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,$2,$2,\'Source\',$3,now())', [design, owner, layout]);
    const input = captureRunInputs(layout, workload, "variant-sql");
    const terminal = {version: 1, kind: "terminal", capturedAt: new Date().toISOString(), topologyRevision: 0,
      simulatedSeconds: 20, overallHealth: "healthy", accumulatedCostUsd: 0, metrics: {}};
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId","ownerId",status,"runInputs",seed,"workloadProfile","terminalSnapshot","updatedAt") VALUES ($1,$2,$3,\'completed\',$4,$5,$6,$7,now())',
      [source, design, owner, input, input.seed, input.workloadProfile, terminal]);
    const before = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    await db.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, directory)).text());
    expect((await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows).toEqual(before);
    await checkModel1SchemaGuards(db);
    const candidate = {...input, workloadProfile: applyWorkloadVariant(input.workloadProfile, {dimension: "arrival-process", value: "poisson"})};
    const insert = (inputs = candidate, mode = "workload-variant", from = source, user = owner, parent: string | null = design, target: number | null = 20,
      seed = inputs.seed, profile = inputs.workloadProfile) => db.query(`INSERT INTO "Deployment"
      (id,"infrastructureId","ownerId","sourceRunId","rerunMode","autoStopAtSimulatedSeconds","runInputs",seed,"workloadProfile",status,"updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',now()) RETURNING *`, [randomUUID(), parent, user, from, mode, target, inputs, seed, profile]);
    expect((await insert()).rows[0]).toMatchObject({runName: "Source", runInputs: candidate, rerunMode: "workload-variant"});
    await insert(input, "exact");
    await insert({...input, resources: input.resources.slice(0, -1)}, "current-design");
    await rejects(insert(candidate, "exact"), /identical/);
    await rejects(insert(candidate, "current-design"), /seed and resolved workload/);
    await rejects(insert({...candidate, resources: candidate.resources.slice(0, -1)}), /all other captured inputs/);
    await rejects(insert({...candidate, connectionLines: []}), /all other captured inputs/);
    await rejects(insert({...candidate, seed: "different"}), /all other captured inputs/);
    await rejects(insert({...candidate, adapterProfiles: []}), /all other captured inputs/);
    await rejects(insert({...candidate, workloadProfile: {...candidate.workloadProfile, targetThroughput: 1}}), /only workload dynamics/);
    await rejects(insert(candidate, "unknown"), /Invalid rerun mode|check constraint/);
    await rejects(insert(candidate, "workload-variant", source, other), /same verified owner/);
    await rejects(insert(candidate, "workload-variant", source, owner, design, 19), /exact source terminal/);
    await rejects(insert(candidate, "workload-variant", source, owner, design, 20, "different"), /seed and resolved workload/);
    await rejects(insert(candidate, "workload-variant", source, owner, design, 20, candidate.seed, input.workloadProfile), /seed and resolved workload/);
    await db.query('UPDATE "Deployment" SET "runtimeActive"=true WHERE id=$1', [source]);
    await rejects(insert(), /same verified owner/);
    await db.query('UPDATE "Deployment" SET "runtimeActive"=false WHERE id=$1', [source]);
    // Construct a genuine challenge source; no immutable column updates or disabled guards.
    const challengeDesign = randomUUID(), challenge = randomUUID();
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,$2,$2,\'Challenge\',$3,\'fixture\',1,now())', [challengeDesign, owner, layout]);
    await db.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","runInputs",seed,"workloadProfile","challengeId","challengeVersion",
      "challengeSpecHash","challengePrediction","predictionSubmittedAt","evaluationStopAtSimulatedSeconds","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,'fixture',1,$7,'{}',now(),20,now())`, [challenge, challengeDesign, owner, input, input.seed, input.workloadProfile, "0".repeat(64)]);
    await db.query('UPDATE "Deployment" SET status=\'failed\' WHERE id=$1', [challenge]);
    await rejects(insert(candidate, "workload-variant", challenge, owner, challengeDesign, null), /freeform captured V2/);
    const legacy = randomUUID();
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","updatedAt") VALUES ($1,$2,\'failed\',$3,$4,$5,now())', [legacy, design, {...input, version: 1}, input.seed, input.workloadProfile]);
    await rejects(insert(candidate, "workload-variant", legacy, owner, design, null), /freeform captured V2/);
    await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [design]);
    expect((await insert(candidate, "workload-variant", source, owner, null)).rows[0].infrastructureId).toBeNull();
    await insert(input, "exact", source, owner, null);
    await rejects(insert(input, "current-design", source, owner, null), /missing current design/);
  } finally {await db.end(); if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();}
}, 30000);
