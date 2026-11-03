import { expect, test } from "bun:test";
import { MAX_ATTEMPTS, deliver, type DeliveryDeps } from "../src/features/model2Run/browserRunDelivery";
import type { BrowserRunState } from "../src/features/model2Run/browserRunStatus";

// A burst of finished runs against a server whose replay queue is full. Time is virtual, so the 84 seconds of
// retrying takes milliseconds, and nothing leaves this process. The invariant under test is honesty: a tab may only
// say "accepted" when the server really holds the run, and every other run is told it was not saved.
const QUEUE_LIMIT = 20;

async function burst(learners: number, drainEveryMs: number) {
  let now = 0, accepted = 0;
  const sleepers: Array<{ at: number; wake: () => void }> = [];
  const finals: BrowserRunState[] = [], histories: BrowserRunState[][] = [];
  const server = () => accepted - Math.floor(now / drainEveryMs);
  const runs = Array.from({ length: learners }, (_, i) => {
    const history: BrowserRunState[] = [];
    histories[i] = history;
    const deps: DeliveryDeps = {
      send: async () => {
        if (server() >= QUEUE_LIMIT) throw Object.assign(new Error("busy"), { response: { status: 429 } });
        accepted++;
      },
      currentStatus: async () => "browser",
      sleep: (ms) => new Promise<void>((wake) => sleepers.push({ at: now + ms, wake })),
      report: (state) => { history.push(state); finals[i] = state; },
    };
    return deliver(deps);
  });
  let finished = false;
  void Promise.all(runs).then(() => { finished = true; });
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  while (!finished) {
    await tick();
    if (!sleepers.length) continue;
    sleepers.sort((x, y) => x.at - y.at);
    const next = sleepers.shift()!;
    now = next.at; next.wake();
  }
  return { accepted, finals, histories, elapsedMs: now };
}

test("a burst past the queue limit is told the truth: accepted only when the server holds it, otherwise not saved", async () => {
  // The queue drains one run every 20 seconds, so over the 84 seconds of retries only a few more fit.
  const result = await burst(30, 20_000);
  const accepted = result.finals.filter(s => s.kind === "accepted").length, unsent = result.finals.filter(s => s.kind === "unsent");
  expect(accepted).toBe(result.accepted);
  expect(accepted).toBeGreaterThanOrEqual(QUEUE_LIMIT);
  expect(accepted).toBeLessThan(30);
  expect(unsent).toHaveLength(30 - accepted);
  for (const s of unsent) expect(s).toEqual({ kind: "unsent", reason: "The server is busy replaying other runs." });
  // Every refused run was told the server was busy and counted its attempts honestly before giving up.
  for (const history of result.histories.filter((_, i) => result.finals[i]!.kind === "unsent")) {
    expect(history.filter(s => s.kind === "sending")).toHaveLength(MAX_ATTEMPTS);
    expect(history.some(s => s.kind === "sending" && s.busy)).toBe(true);
    expect(history.some(s => s.kind === "accepted")).toBe(false);
  }
  expect(result.elapsedMs).toBeLessThanOrEqual(84_000);
});

test("when the queue drains fast enough every learner in the burst is accepted without anyone being told otherwise", async () => {
  const result = await burst(30, 3_000);
  expect(result.accepted).toBe(30);
  expect(result.finals.every(s => s.kind === "accepted")).toBe(true);
});

test("a burst within the queue is accepted at once without any retry", async () => {
  const result = await burst(QUEUE_LIMIT, 60_000);
  expect(result.accepted).toBe(QUEUE_LIMIT);
  expect(result.elapsedMs).toBe(0);
  expect(result.histories.every(h => h.length === 2)).toBe(true);
});
