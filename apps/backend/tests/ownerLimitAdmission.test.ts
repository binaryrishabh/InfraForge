import { expect, test } from "bun:test";
import { admitDeployment } from "../deployments/admission";
import { readOperationalLimits } from "../deployments/operationalLimits";
import { AppError } from "../utils/errors";

const limits = readOperationalLimits({});
const data = { id: "new-run", ownerId: "learner" };
function transaction(counts: { owner: number; global: number; queued: number }) {
  const calls: string[] = [];
  const created: unknown[] = [];
  const events: unknown[] = [];
  return {
    calls, created, events,
    tx: {
      $queryRaw: async () => { calls.push("lock"); return []; },
      deployment: {
        count: async ({ where }: { where: { ownerId?: string; status?: string } }) => {
          if (where.ownerId) { calls.push("owner"); return counts.owner; }
          if (where.status === "pending") { calls.push("queued"); return counts.queued; }
          calls.push("global"); return counts.global;
        },
        create: async (query: { data: unknown }) => { created.push(query.data); return data; },
      },
      outbox: { create: async (query: { data: unknown }) => { events.push(query.data); return {}; } },
    } as never,
  };
}

test.each([
  {
    name: "owner limit explains the two unfinished runs and how to continue",
    counts: { owner: 2, global: 0, queued: 0 },
    message: "You already have 2 unfinished runs. Open Home to continue or discard one, then start again.",
  },
  {
    name: "global limit keeps the existing capacity message",
    counts: { owner: 1, global: limits.global, queued: 0 },
    message: "Simulation capacity is busy. Stop an existing run or retry later.",
  },
  {
    name: "queue limit keeps the existing capacity message",
    counts: { owner: 1, global: 1, queued: limits.queued },
    message: "Simulation capacity is busy. Stop an existing run or retry later.",
  },
])("$name", async ({ counts, message }) => {
  const t = transaction(counts);
  const error = await admitDeployment(t.tx, data, limits).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).statusCode).toBe(429);
  expect((error as AppError).message).toBe(message);
  expect(t.calls).toEqual(["lock", "owner", "global", "queued"]);
  expect(t.created).toEqual([]);
  expect(t.events).toEqual([]);
});

test("under-limit admission creates the run and its outbox event after taking the lock", async () => {
  const t = transaction({ owner: limits.perOwner - 1, global: limits.global - 1, queued: limits.queued - 1 });
  expect(await admitDeployment(t.tx, data, limits)).toMatchObject(data);
  expect(t.calls).toEqual(["lock", "owner", "global", "queued"]);
  expect(t.created).toEqual([data]);
  expect(t.events).toEqual([{ eventType: "deployment-created", payload: { deploymentId: data.id } }]);
});
