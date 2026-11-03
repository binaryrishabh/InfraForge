import { expect, test } from "bun:test";
import { admitReplay } from "../deployments/admission";
import { readOperationalLimits } from "../deployments/operationalLimits";
import { AppError } from "../utils/errors";

// The browser retries a submission only when the server answers 429, so this refusal is part of the product's
// contract with the learner's tab. These checks use a fake transaction: no database, nothing outside this process.
const limits = readOperationalLimits({});
function transaction(counts: { work: number; pending: number }) {
  const calls: string[] = [];
  return {
    calls,
    tx: {
      $queryRaw: async () => { calls.push("lock"); return []; },
      deployment: { count: async (query: { where: unknown }) => { calls.push("count"); return JSON.stringify(query.where).includes('"pending"') && !JSON.stringify(query.where).includes("running") ? counts.pending : counts.work; } },
    } as never,
  };
}

test("replay admission has the documented defaults", () => {
  expect(limits).toMatchObject({ perOwner: 2, global: 24, queued: 20, active: 2, lifetimeSeconds: 1800 });
});

test("a submission is admitted under the limits, after taking the admission lock", async () => {
  const t = transaction({ work: 23, pending: 19 });
  await admitReplay(t.tx, limits);
  expect(t.calls[0]).toBe("lock");
});

test("a full replay queue or a full server answers 429 with a message that says the run is kept", async () => {
  for (const counts of [{ work: 5, pending: 20 }, { work: 24, pending: 0 }]) {
    const error = await admitReplay(transaction(counts).tx, limits).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(429);
    expect((error as AppError).message).toContain("Your run is kept");
  }
});
