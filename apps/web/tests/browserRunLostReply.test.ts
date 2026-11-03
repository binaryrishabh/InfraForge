// Races found by independent QA on 31e40ff: each test failed there and now passes.
import { expect, test } from "bun:test";
import { deliver, MAX_ATTEMPTS, type DeliveryDeps } from "../src/features/model2Run/browserRunDelivery";
import type { BrowserRunState } from "../src/features/model2Run/browserRunStatus";

// Fake server mirroring deployment.routes.ts /submit. Attempt `acceptedAt` is accepted (status -> pending) but its
// reply is lost (no response, or a 5xx after commit); every other attempt gets `others` (429 = queue full, 0 = no response).
function run(acceptedAt: number, lostReply: number, others: number) {
  const states: BrowserRunState[] = []; let status = "browser"; let n = 0;
  const err = (s: number) => Object.assign(new Error("x"), s === 0 ? {} : { response: { status: s } });
  const deps: DeliveryDeps = {
    send: async () => { n++; if (n === acceptedAt) { status = "pending"; throw err(lostReply); } throw err(others); },
    currentStatus: async () => status, sleep: async () => {}, report: (s) => states.push(s),
  };
  return { deps, states, status: () => status };
}
const expected = { result: "accepted" as const, final: { kind: "accepted" as const } };
const outcome = async (r: ReturnType<typeof run>) => ({ result: await deliver(r.deps), final: r.states.at(-1) });

test("A: lost reply on #1, then the queue is full (429): must not end unsent while the server holds the run", async () => {
  const r = run(1, 0, 429);
  expect(await outcome(r)).toEqual(expected);
  expect(r.status()).toBe("pending");
});

test("A2: lost reply on the LAST attempt (no response): must not end unsent", async () => {
  expect(await outcome(run(MAX_ATTEMPTS, 0, 0))).toEqual(expected);
});

test("A3: accepted on the last attempt but the reply is a 5xx: must not end unsent", async () => {
  expect(await outcome(run(MAX_ATTEMPTS, 503, 503))).toEqual(expected);
});
