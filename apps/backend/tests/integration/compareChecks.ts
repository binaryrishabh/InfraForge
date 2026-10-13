import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import type { RunComparison } from "@infraforge/contracts/reports";
import type { LocalHarness } from "./localHarness";
import type { SessionFixtures } from "./sessionFixtures";

export async function checkCompareAccess(harness: LocalHarness, sessions: SessionFixtures, runIds: string[]) {
  const cookie = harness.cookie;
  const [a, b] = runIds;
  if (!a || !b) throw new Error("Two recorded runs required");
  const compare = (x: string, y: string, status = 200) => harness.request(`/deployments/compare?a=${x}&b=${y}`, undefined, "GET", status);
  const first: RunComparison = (await compare(a, b)).comparison;
  expect((await compare(b, a)).comparison).toEqual(first);
  expect(first.runs.map((r) => r.id)).toEqual([...first.runs].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id)).map((r) => r.id));
  await compare(a, a, 400); await compare(a, "bad", 400);
  const bob = await sessions.create();
  const design = randomUUID(), other = randomUUID(), legacy = randomUUID();
  try {
    await harness.sql.query('INSERT INTO "Infrastructure" (id, "userId", "ownerId", name, layout, "updatedAt") VALUES ($1,$2,$2,\'Compare access fixture\',\'{"resources":[],"connectionLines":[]}\',$3)', [design, bob.user.id, new Date()]);
    await harness.sql.query('INSERT INTO "Deployment" (id,"infrastructureId",status,"updatedAt") VALUES ($1,$2,\'failed\',$3)', [other, design, new Date()]);
    await harness.sql.query('INSERT INTO "Deployment" (id,status,"updatedAt") VALUES ($1,\'failed\',$2)', [legacy, new Date()]);
    const before = (await harness.sql.query('SELECT count(*) AS runs, (SELECT count(*) FROM "RunAction") AS actions FROM "Deployment"')).rows[0];
    for (const pair of [[a, other], [other, a], [a, legacy], [legacy, a]]) await compare(pair[0]!, pair[1]!, 404);
    harness.cookie = bob.cookie;
    for (const pair of [[other, a], [a, other], [other, legacy]]) await compare(pair[0]!, pair[1]!, 404);
    await harness.request(`/deployments/${a}/compare-options`, undefined, "GET", 404);
    harness.cookie = cookie;
    const options = (await harness.request(`/deployments/${a}/compare-options`)).runs;
    expect(options.some((r: { id: string }) => r.id === other || r.id === legacy)).toBe(false);
    expect((await harness.sql.query('SELECT count(*) AS runs, (SELECT count(*) FROM "RunAction") AS actions FROM "Deployment"')).rows[0]).toEqual(before);
  } finally {
    harness.cookie = cookie;
    await harness.sql.query('DELETE FROM "Deployment" WHERE id = ANY($1::text[])', [[other, legacy]]);
    await harness.sql.query('DELETE FROM "Infrastructure" WHERE id = $1', [design]);
  }
  return { deterministicOrder: true, bothSidesOwnerScoped: true, ownerless404: true, noMutation: true, comparison: first };
}
