import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { readLocalSettings } from "./localHarness";
import { captureRunInputs } from "../../deployments/runInputs";
import { layout, workload } from "./scenario";

const MIGRATION = "20261015000000_challenge_versions_experiments";
const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 14 versions existing workspaces and guards each attempt's one scheduled fault", async () => {
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
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).filter((f) => f <= MIGRATION).sort();
    expect(folders.at(-1)).toBe(MIGRATION);
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());

    // History written under migration 13: a version-less workspace, its attempt and a freeform run.
    const owner = randomUUID(), design = randomUUID(), workspace = randomUUID(), freeformRun = randomUUID(), attempt = randomUUID();
    await db.query('INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'Owner fixture\',$2,true,now())', [owner, `${owner}@infraforge.test`]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt") VALUES ($1,\'test-user\',$2,\'Freeform\',$3,now())', [design, owner, layout]);
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","updatedAt") VALUES ($1,\'test-user\',$2,\'Workspace\',$3,\'first-production-api\',now())', [workspace, owner, layout]);
    const input = { ...captureRunInputs(layout, workload), seed: "experiment-migration" };
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId","ownerId",status,"runInputs",seed,"workloadProfile","updatedAt") VALUES ($1,$2,$3,\'pending\',$4,$5,$6,now())',
      [freeformRun, design, owner, input, input.seed, input.workloadProfile]);
    const insertAttempt = (id: string, changes: Record<string, unknown> = {}) => {
      const row = { infrastructureId: workspace, challengeId: "first-production-api", challengeVersion: 1, evaluationStopAtSimulatedSeconds: 90, challengeExperiment: null, ...changes };
      return db.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","challengeId","challengeVersion","challengeSpecHash","challengePrediction",
        "predictionSubmittedAt","evaluationStopAtSimulatedSeconds",status,"runInputs",seed,"workloadProfile","updatedAt"${row.challengeExperiment === null ? "" : ',"challengeExperiment"'})
        VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,'pending',$9,$10,$11,now()${row.challengeExperiment === null ? "" : ",$12"})`,
        [id, row.infrastructureId, owner, row.challengeId, row.challengeVersion, "a".repeat(64), { answers: { health: "healthy" }, reasoning: null },
          row.evaluationStopAtSimulatedSeconds, input, input.seed, input.workloadProfile, ...(row.challengeExperiment === null ? [] : [row.challengeExperiment])]);
    };
    await insertAttempt(attempt);
    const before = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;

    await db.query(await Bun.file(new URL(`${MIGRATION}/migration.sql`, directory)).text());
    expect((await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows.map(({ challengeExperiment, ...old }) => { expect(challengeExperiment).toBeNull(); return old; })).toEqual(before);
    const versions = Object.fromEntries((await db.query('SELECT id, "challengeVersion" FROM "Infrastructure"')).rows.map((r) => [r.id, r.challengeVersion]));
    expect(versions).toEqual({ [design]: null, [workspace]: 1 });

    // Workspace identity is a challenge and a version, set together and never changed.
    const insertDesign = (challengeId: string | null, version: number | null) => db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,\'test-user\',$2,\'W\',$3,$4,$5,now())',
      [randomUUID(), owner, layout, challengeId, version]);
    await rejects(insertDesign("lose-an-app-server", null), /check constraint/);
    await rejects(insertDesign(null, 1), /check constraint/);
    await rejects(insertDesign("lose-an-app-server", 0), /check constraint/);
    await rejects(db.query('UPDATE "Infrastructure" SET "challengeVersion"=2 WHERE id=$1', [workspace]), /immutable/);
    // A version 1 workspace cannot start an attempt recorded as version 2.
    await rejects(insertAttempt(randomUUID(), { challengeVersion: 2 }), /for that challenge version/);

    const resilience = randomUUID(), resilienceAttempt = randomUUID();
    await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,\'test-user\',$2,\'Lose\',$3,\'lose-an-app-server\',1,now())', [resilience, owner, layout]);
    const plan = { version: 1, fault: "crash", atSimulatedSecond: 60, durationSimulatedSeconds: 30, targetResourceId: "vm-a", targetType: "Virtual Machine" };
    const withPlan = (p: unknown) => ({ infrastructureId: resilience, challengeId: "lose-an-app-server", challengeExperiment: p });
    await rejects(insertAttempt(randomUUID(), withPlan({ ...plan, atSimulatedSecond: 90 })), /check constraint/);
    await rejects(insertAttempt(randomUUID(), withPlan(["not", "an", "object"])), /check constraint/);
    await rejects(insertAttempt(randomUUID(), withPlan({ ...plan, targetResourceId: 7 })), /check constraint/);
    await rejects(db.query('UPDATE "Deployment" SET "challengeExperiment"=$1 WHERE id=$2', [plan, freeformRun]), /immutable|check constraint/);
    await insertAttempt(resilienceAttempt, withPlan(plan));
    await rejects(db.query('UPDATE "Deployment" SET "challengeExperiment"=$1 WHERE id=$2', [{ ...plan, targetResourceId: "vm-b" }, resilienceAttempt]), /immutable/);

    // Only the recorded fault, exactly as planned, once; people still get only speed and stop.
    const action = (deployment: string, sequence: number, kind: string, parameters: object) =>
      db.query('INSERT INTO "RunAction" (id,"deploymentId",sequence,kind,parameters) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), deployment, sequence, kind, parameters]);
    const scheduled = { type: "crash", resourceId: "vm-a", trigger: "challenge-experiment" };
    await rejects(action(resilienceAttempt, 1, "chaos", { ...scheduled, resourceId: "vm-b" }), /recorded experiment/);
    await rejects(action(resilienceAttempt, 1, "chaos", { ...scheduled, type: "cpu-spike" }), /recorded experiment/);
    await rejects(action(resilienceAttempt, 1, "chaos", { ...scheduled, trigger: "manual" }), /recorded experiment/);
    await rejects(action(resilienceAttempt, 1, "chaos", { type: "crash", resourceId: "vm-a" }), /only speed changes and stopping/);
    await action(resilienceAttempt, 1, "chaos", scheduled);
    await rejects(action(resilienceAttempt, 2, "chaos", scheduled), /run_action_challenge_experiment|duplicate key/);
    await action(resilienceAttempt, 2, "speed", { speed: 60 });
    await rejects(action(attempt, 1, "chaos", { ...scheduled, resourceId: "vm-a" }), /recorded experiment/);
    // Freeform faults keep working, and cannot claim the experiment's origin.
    await action(freeformRun, 1, "chaos", { type: "crash", resourceId: "vm-a" });
    await rejects(action(freeformRun, 2, "chaos", scheduled), /recorded experiment/);
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
