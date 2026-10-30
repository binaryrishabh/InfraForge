import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { captureRunInputs } from "../../deployments/runInputs";
import { boundRetriesDuringSlowdownV1 as d } from "../../challenges/definitions/bound-retries-during-slowdown/v1";
import { recordedScenario } from "../../challenges/scenario";
import { specHash, challengeSeed } from "../../challenges/registry";
import { checkModel1SchemaGuards } from "../../release/migrations";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("scenario migration preserves history and guards exact, unique, immutable step requests", async () => {
  const settings = readLocalSettings(process.env), admin = new Pool({connectionString: settings.databaseUrl, ssl: false, options: ""});
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`, url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  const db = new Pool({connectionString: url.href, ssl: false, options: ""});
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, {withFileTypes: true})).filter(e => e.isDirectory()).map(e => e.name).sort();
    expect(folders.at(-1)).toBe("20261030010000_challenge_scenarios");
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), design = randomUUID(), legacy = randomUUID(), scenarioRun = randomUUID(), free = randomUUID();
    const input = captureRunInputs(d.starter!, d.workload, challengeSeed(d)), plan = recordedScenario(d, input)!;
    await db.query('INSERT INTO "User" (id,name,email,"updatedAt") VALUES ($1,\'Scenario fixture\',$2,now())', [owner, `${owner}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,$2,$2,\'Fixture\',$3,$4,1,now())', [design, owner, d.starter, d.id]);
    const insert = (id: string, scenario?: unknown, experiment?: unknown) => db.query(`INSERT INTO "Deployment"
      (id,"infrastructureId","ownerId","runInputs",seed,"workloadProfile","challengeId","challengeVersion","challengeSpecHash","challengePrediction","predictionSubmittedAt","evaluationStopAtSimulatedSeconds",${scenario === undefined ? "" : '"challengeScenario",'}"challengeExperiment","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,now(),5,${scenario === undefined ? "" : "$11,"}$10,now())`,
    [id, design, owner, input, input.seed, input.workloadProfile, d.id, specHash(d), {answers: {health: "healthy"}, reasoning: null}, experiment ?? null, ...(scenario === undefined ? [] : [scenario])]);
    await insert(legacy);
    await db.query('INSERT INTO "Deployment" (id,"runInputs",seed,"workloadProfile","updatedAt") VALUES ($1,$2,$3,$4,now())', [free, input, input.seed, input.workloadProfile]);
    const speed = randomUUID();
    await db.query('INSERT INTO "RunAction" (id,"deploymentId",sequence,kind,parameters) VALUES ($1,$2,1,\'speed\',\'{"speed":1}\')', [speed, legacy]);
    const before = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    const actionsBefore = (await db.query('SELECT * FROM "RunAction"')).rows;
    await db.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, directory)).text());
    expect((await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows.map(({challengeScenario, ...row}) => {expect(challengeScenario).toBeNull(); return row;})).toEqual(before);
    expect((await db.query('SELECT * FROM "RunAction"')).rows.map(({scenarioStepId, ...row}) => {expect(scenarioStepId).toBeNull(); return row;})).toEqual(actionsBefore);
    await checkModel1SchemaGuards(db);
    await insert(scenarioRun, plan);
    await rejects(insert(randomUUID(), {...plan, definitionHash: "0".repeat(64)}), /check constraint/);
    await rejects(insert(randomUUID(), plan, {version: 1, fault: "crash", targetResourceId: "db", atSimulatedSecond: 2, durationSimulatedSeconds: 1}), /check constraint/);
    await rejects(db.query('UPDATE "Deployment" SET "challengeScenario"=NULL WHERE id=$1', [scenarioRun]), /immutable/);
    const action = (deploymentId: string, step: string | null, request: unknown = plan.steps[0]!.request, sequence = 2) => db.query(
      'INSERT INTO "RunAction" (id,"deploymentId",sequence,kind,parameters,"scenarioStepId") VALUES ($1,$2,$3,\'intervention\',$4,$5)', [randomUUID(), deploymentId, sequence, request, step]);
    await rejects(action(scenarioRun, null), /Challenge attempts/);
    await rejects(action(legacy, "db-slowdown"), /recorded scenario/);
    await rejects(action(free, "db-slowdown"), /recorded scenario/);
    await rejects(action(scenarioRun, "unknown"), /exactly match/);
    await rejects(action(scenarioRun, "db-slowdown", {...plan.steps[0]!.request, parameters: {cores: 0, duration: 2}}), /exactly match/);
    await rejects(action(scenarioRun, "db-slowdown", {...plan.steps[0]!.request, trigger: "scenario"}), /exactly match/);
    // Concurrent retries establish one row, never two applications of the same step.
    const raced = await Promise.allSettled([action(scenarioRun, "db-slowdown", undefined, 2), action(scenarioRun, "db-slowdown", undefined, 3)]);
    expect(raced.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.query('SELECT count(*)::int AS count FROM "RunAction" WHERE "deploymentId"=$1', [scenarioRun])).rows[0].count).toBe(1);
    await rejects(db.query('UPDATE "RunAction" SET "scenarioStepId"=NULL WHERE "deploymentId"=$1', [scenarioRun]), /immutable/);
    await rejects(db.query('UPDATE "RunAction" SET parameters=\'{}\' WHERE "deploymentId"=$1', [scenarioRun]), /immutable/);
    await action(free, null); // Freeform interventions remain available.
  } finally {await db.end(); if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();}
}, 30000);
