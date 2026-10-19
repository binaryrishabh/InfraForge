import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rejects } from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { readLocalSettings } from "./localHarness";
import { layout, workload } from "./scenario";
import { captureRunInputs } from "../../deployments/runInputs";
import { sampleHash } from "../../evidence/contract";
import { persistEvidence } from "../../evidence/persist";
import type { ExperimentEvidencePayload } from "@infraforge/contracts/reports";

const integration = process.env.INTEGRATION_RUN === "1" ? test : test.skip;
integration("migration 15 preserves history and enforces bounded immutable samples, retry consistency and run-owned history", async () => {
  const settings = readLocalSettings(process.env);
  const admin = new Pool({ connectionString: settings.databaseUrl, ssl: false, options: "" });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(settings.databaseUrl); url.pathname = "/" + name;
  const db = new Pool({ connectionString: url.href, ssl: false, options: "" });
  const client = new PrismaClient({ adapter: new PrismaPg(db) });
  let created = false;
  try {
    expect((await admin.query("SELECT current_database() AS name")).rows[0].name).toBe(settings.databaseName);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const folders = (await readdir(directory, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
      .filter((name) => name <= "20261016000000_experiment_evidence").sort();
    expect(folders.at(-1)).toBe("20261016000000_experiment_evidence");
    for (const folder of folders.slice(0, -1)) await db.query(await Bun.file(new URL(`${folder}/migration.sql`, directory)).text());
    const owner = randomUUID(), workspace = randomUUID(), ordinary = randomUUID(), resilience = randomUUID(), freeform = randomUUID();
    await db.query('INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,\'Evidence fixture\',$2,true,now())', [owner, `${owner}@infraforge.test`]);
    for (const [id, challengeId, version] of [[workspace, "lose-an-app-server", 1], [ordinary, null, null]]) {
      await db.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,\'test-user\',$2,\'Fixture\',$3,$4,$5,now())', [id, owner, layout, challengeId, version]);
    }
    const input = captureRunInputs(layout, workload, "trace-migration");
    const plan = { version: 1, fault: "crash", atSimulatedSecond: 60, durationSimulatedSeconds: 30, targetResourceId: "vm-a", targetType: "Virtual Machine" };
    await db.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId",status,"runInputs",seed,"workloadProfile","challengeId","challengeVersion",
      "challengeSpecHash","challengePrediction","predictionSubmittedAt","evaluationStopAtSimulatedSeconds","challengeExperiment","updatedAt")
      VALUES ($1,$2,$3,'pending',$4,$5,$6,'lose-an-app-server',1,$7,$8,now(),90,$9,now())`,
    [resilience, workspace, owner, input, input.seed, input.workloadProfile, "a".repeat(64), { answers: { health: "healthy" }, reasoning: null }, plan]);
    await db.query('INSERT INTO "Deployment" (id,"infrastructureId",status,"runInputs",seed,"workloadProfile","updatedAt") VALUES ($1,$2,\'pending\',$3,$4,$5,now())',
      [freeform, ordinary, input, input.seed, input.workloadProfile]);
    const before = (await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows;
    await db.query(await Bun.file(new URL(`${folders.at(-1)}/migration.sql`, directory)).text());
    expect((await db.query('SELECT * FROM "Deployment" ORDER BY id')).rows).toEqual(before);
    expect((await db.query('SELECT count(*)::int AS count FROM "RunEvidenceSample"')).rows[0].count).toBe(0);
    await db.query('UPDATE "Deployment" SET status=\'live\',"runtimeActive"=true WHERE id=ANY($1::text[])', [[resilience, freeform]]);
    const payload: ExperimentEvidencePayload = { version: 1, topologyRevision: 0, overallHealth: "healthy", loadFraction: 1, targetLoadFraction: 1,
      resources: [{ id: "vm-a", cpu: 20, memory: 25, health: "healthy" }],
      pools: [{ id: "lb", currentReplicas: 2, baseReplicas: 2, pending: { action: "up", secondsRemaining: 59 } }] };
    const first = { simulatedSeconds: 30, sampledAt: new Date("2026-10-14T00:00:00Z"), payload, hash: sampleHash(payload) };
    await persistEvidence(resilience, [first], client);
    await persistEvidence(resilience, [{ ...first, sampledAt: new Date() }], client);
    const saved = (await db.query('SELECT * FROM "RunEvidenceSample" WHERE "deploymentId"=$1', [resilience])).rows;
    expect(saved).toHaveLength(1); expect(saved[0].sampledAt).toEqual(first.sampledAt);
    const conflict = { ...payload, resources: [{ ...payload.resources[0]!, cpu: 99 }] };
    await rejects(persistEvidence(resilience, [{ ...first, payload: conflict, hash: sampleHash(conflict) }, { ...first, simulatedSeconds: 31 }], client), /Conflicting/);
    expect((await db.query('SELECT count(*)::int AS count FROM "RunEvidenceSample"')).rows[0].count).toBe(1);
    const insert = (runId: string, second: number, data: unknown = payload) => db.query('INSERT INTO "RunEvidenceSample" ("deploymentId","simulatedSeconds","sampledAt",payload,hash) VALUES ($1,$2,now(),$3,$4)', [runId, second, data, first.hash]);
    await rejects(insert(resilience, 30), /duplicate key/);
    await rejects(insert(resilience, 29), /bounded retained window/);
    await rejects(insert(resilience, 91), /bounded retained window/);
    await rejects(insert(freeform, 30), /owned live resilience attempt/);
    await rejects(insert(resilience, 31, { ...payload, logs: [] }), /Malformed/);
    await rejects(insert(resilience, 31, { ...payload, resources: Array.from({ length: 129 }, (_, i) => ({ ...payload.resources[0], id: String(i) })) }), /Malformed/);
    await rejects(insert(resilience, 31, { ...payload, resources: [{ ...payload.resources[0], cpu: 101 }] }), /Malformed/);
    await rejects(insert(resilience, 31, { ...payload, resources: [] }), /Malformed/);
    await rejects(db.query('INSERT INTO "RunEvidenceSample" ("deploymentId","simulatedSeconds","sampledAt",payload,hash) VALUES ($1,31,\'infinity\'::timestamptz,$2,$3)', [resilience, payload, first.hash]), /check constraint/);
    await rejects(insert(resilience, 31, { ...payload, resources: [payload.resources[0], payload.resources[0]] }), /Duplicate/);
    await rejects(insert(resilience, 31, { ...payload, logs: "x".repeat(70000) }), /oversized|check constraint/);
    await rejects(db.query('UPDATE "RunEvidenceSample" SET payload=$1 WHERE "deploymentId"=$2', [conflict, resilience]), /immutable/);
    await db.query('UPDATE "Deployment" SET status=\'failed\',"runtimeActive"=false WHERE id=$1', [resilience]);
    await rejects(insert(resilience, 31), /owned live resilience attempt/);
    await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [workspace]);
    expect((await db.query('SELECT "infrastructureId" FROM "Deployment" WHERE id=$1', [resilience])).rows[0].infrastructureId).toBeNull();
    expect((await db.query('SELECT count(*)::int AS count FROM "RunEvidenceSample"')).rows[0].count).toBe(1);
    await db.query('DELETE FROM "Deployment" WHERE id=$1', [resilience]);
    expect((await db.query('SELECT count(*)::int AS count FROM "RunEvidenceSample"')).rows[0].count).toBe(0);
  } finally {
    await client.$disconnect(); await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 30000);
