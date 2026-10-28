import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ChallengeSummary, LearningHistory } from "@infraforge/contracts/challenges";
import type { LocalHarness } from "./localHarness";
import type { SessionFixtures } from "./sessionFixtures";
import { captureRunInputs } from "../../deployments/runInputs";
import { challengeSeed, latestChallenge } from "../../challenges/registry";

export async function checkLearningHistory(harness: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const cookie = harness.cookie;
  const older = ((await harness.request("/challenges")).challenges as ChallengeSummary[]).find((c) => c.id === "first-production-api")!;
  expect(older.latest).not.toBeNull();
  const d = latestChallenge("cache-matters")!;
  const workspace = (await harness.request(`/challenges/${d.definition.id}/workspace`, {}, "POST", 201)).designId; designs.push(workspace);
  const input = captureRunInputs({ ...d.definition.starter!, layoutVersion: 3 }, d.definition.workload, challengeSeed(d.definition));
  const owner = (await harness.sql.query('SELECT "ownerId" FROM "Infrastructure" WHERE id=$1', [workspace])).rows[0].ownerId;
  // Synthetic, inactive records in this owned fixture DB; no worker jobs or simulated results are invented.
  const inserted = await harness.sql.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","challengeId","challengeVersion","challengeSpecHash",
    "challengePrediction","predictionSubmittedAt","evaluationStopAtSimulatedSeconds",status,"runInputs",seed,"workloadProfile","updatedAt")
    SELECT gen_random_uuid()::text,$1,$2,$3,$10,$4,$5,now(),$6,'pending',$7,$8,$9,now() FROM generate_series(1,301) RETURNING id`,
  [workspace, owner, d.definition.id, d.hash, { answers: { database: "healthy", busiest: "Database" }, reasoning: null }, d.definition.evaluationSeconds, input, input.seed, input.workloadProfile, d.definition.version]);
  const ids = inserted.rows.map((r) => r.id as string); runs.push(...ids);
  await harness.sql.query('UPDATE "Deployment" SET status=\'failed\',"runtimeActive"=false WHERE id=ANY($1::text[])', [ids]);
  const listed = (await harness.request("/challenges")).challenges as ChallengeSummary[];
  expect(listed.find((c) => c.id === older.id)?.latest?.runId).toBe(older.latest!.runId);
  expect(listed.find((c) => c.id === older.id)?.attempts).toBe(older.attempts);
  const latest = (await harness.sql.query('SELECT id FROM "Deployment" WHERE "ownerId"=$1 AND "challengeId"=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 1', [owner, d.definition.id])).rows[0].id;
  expect(listed.find((c) => c.id === d.definition.id)?.latest?.runId).toBe(latest);

  // A newer recorded version absent from this release stays unavailable, never re-judged as v1.
  const futureWorkspace = randomUUID(), future = randomUUID(); designs.push(futureWorkspace); runs.push(future);
  await harness.sql.query('INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"challengeId","challengeVersion","updatedAt") VALUES ($1,\'test-user\',$2,\'Future fixture\',$3,$4,99,now())',
    [futureWorkspace, owner, { ...d.definition.starter!, layoutVersion: 3 }, d.definition.id]);
  await harness.sql.query(`INSERT INTO "Deployment" (id,"infrastructureId","ownerId","challengeId","challengeVersion","challengeSpecHash","challengePrediction",
    "predictionSubmittedAt","evaluationStopAtSimulatedSeconds",status,"runInputs",seed,"workloadProfile","updatedAt")
    VALUES ($1,$2,$3,$4,99,$5,$6,now(),$7,'pending',$8,$9,$10,now())`, [future, futureWorkspace, owner, d.definition.id, "b".repeat(64),
    { answers: {}, reasoning: null }, d.definition.evaluationSeconds, input, input.seed, input.workloadProfile]);
  await harness.sql.query('UPDATE "Deployment" SET status=\'failed\' WHERE id=$1', [future]);
  const history: LearningHistory = (await harness.request("/challenges/attempt-history?limit=3")).history;
  expect(history.attempts[0]).toMatchObject({ runId: future, version: 99, status: "unavailable", canRetry: false, predictionMatched: 0 });
  expect(history.attempts.every((a) => a.challengeId)).toBe(true); expect(history.nextCursor).not.toBeNull();
  const next: LearningHistory = (await harness.request(`/challenges/attempt-history?limit=3&before=${history.nextCursor}`)).history;
  expect(next.attempts.some((a) => history.attempts.some((b) => a.runId === b.runId))).toBe(false);
  expect((await harness.request(`/challenges/${d.definition.id}`)).challenge.attempts.every((a: { version: number }) => a.version === d.definition.version)).toBe(true);
  const bob = await sessions.create();
  try {
    harness.cookie = bob.cookie;
    expect((await harness.request("/challenges/attempt-history")).history.attempts).toEqual([]);
    await harness.request(`/challenges/attempt-history?before=${future}`, undefined, "GET", 404);
    expect(((await harness.request("/challenges")).challenges as ChallengeSummary[]).every((c) => c.attempts === 0 && c.latest === null)).toBe(true);
  } finally { harness.cookie = cookie; }
  await harness.request("/challenges/attempt-history?limit=51", undefined, "GET", 400);
  return { olderLatestPreservedBeyondGlobalWindow: true, syntheticRecords: 302, mixedVersionsNotRejudged: true, ownerScoped: true, noFreeformRows: true };
}
