// A remounted page must never start a second worker for a run already delivered, being delivered or lost.
import { beforeEach, expect, test } from "bun:test";
import { createBrowserRuns } from "../src/features/model2Run/browserRuns";
import { takeUnsent, useBrowserRunStatus } from "../src/features/model2Run/browserRunStatus";

// Server run stays 'browser' until /submit is accepted, so a remounted page calls startBrowserRun again mid-delivery.
let workers: Array<{ onDone: (s: unknown) => void }> = [];
let submitGate: Promise<void> = Promise.resolve(); let submitFails = false;
const submits: unknown[] = [];
const runs = createBrowserRuns({ apiUrl: "http://api",
  http: {
    get: async (url: string) => url.endsWith("/browser-run")
      ? { data: { browserRun: { input: {}, horizonSeconds: 60, stopAtSecond: 60 } } } : { data: { deployment: { status: "browser" } } },
    post: async (_url: string, body: unknown) => { submits.push(body); await submitGate; if (submitFails) throw Object.assign(new Error("x"), { response: { status: 401 } }); return { data: {} }; },
  } as never,
  startRun: ((_s: unknown, cb: never) => { workers.push(cb); return { stop() {}, setSpeed() {}, act: async () => ({ ok: true }) }; }) as never,
});
let ID = "r0"; let seq = 0;
const status = () => useBrowserRunStatus.getState().runs[ID];
beforeEach(() => { ID = "r" + ++seq; workers = []; submits.length = 0; submitFails = false; submitGate = Promise.resolve(); useBrowserRunStatus.setState({ runs: {}, deadlines: {} }); });

test("B1: remount while the submission is in flight must not start a second worker or overwrite 'sending'", async () => {
  await runs.startBrowserRun(ID);
  let release!: () => void; submitGate = new Promise<void>((r) => { release = r; });
  workers[0].onDone({ stopAtSecond: 30, actions: [] });
  await new Promise((r) => setTimeout(r, 5));
  expect(status()).toMatchObject({ kind: "sending" });
  await runs.startBrowserRun(ID); // remounted page / 'live' event / poll
  expect({ workers: workers.length, status: status()?.kind }).toEqual({ workers: 1, status: "sending" });
  release();
});

test("B2: after delivery failed (unsent), a remount must not start a second worker or lose the unsent payload", async () => {
  await runs.startBrowserRun(ID);
  submitFails = true;
  workers[0].onDone({ stopAtSecond: 30, actions: [] });
  await new Promise((r) => setTimeout(r, 20));
  expect(status()).toMatchObject({ kind: "unsent" });
  await runs.startBrowserRun(ID);
  expect({ workers: workers.length, status: status()?.kind, kept: takeUnsent(ID) }).toEqual({ workers: 1, status: "unsent", kept: { stopAtSecond: 30, actions: [] } });
});

test("B3: after the server accepted, a stale 'browser' read must not start another worker over 'accepted'", async () => {
  await runs.startBrowserRun(ID);
  workers[0].onDone({ stopAtSecond: 30, actions: [] });
  await new Promise((r) => setTimeout(r, 20));
  expect(status()).toEqual({ kind: "accepted" });
  await runs.startBrowserRun(ID);
  expect({ workers: workers.length, status: status()?.kind }).toEqual({ workers: 1, status: "accepted" });
});
