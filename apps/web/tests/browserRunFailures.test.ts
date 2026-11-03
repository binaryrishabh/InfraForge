import { beforeEach, expect, test } from "bun:test";
import { createBrowserRuns } from "../src/features/model2Run/browserRuns";
import { useBrowserRunStatus, type BrowserRunState } from "../src/features/model2Run/browserRunStatus";
import { MAX_ATTEMPTS, autoStopDelay, deliver, retryDelay, type DeliveryDeps } from "../src/features/model2Run/browserRunDelivery";
import { describeBrowserRun } from "../src/features/model2Run/browserRunMessages";

// A fake network: each call to send() consumes the next scripted outcome (an HTTP status, 0 for no response, or "ok").
function network(script: Array<number | "ok">, serverStatus: string | null = null) {
  const states: BrowserRunState[] = [], sleeps: number[] = [];
  let sent = 0;
  const deps: DeliveryDeps = {
    send: async () => {
      const next = script[Math.min(sent++, script.length - 1)];
      if (next === "ok") return;
      throw Object.assign(new Error("request failed"), next === 0 ? {} : { response: { status: next } });
    },
    currentStatus: async () => { if (serverStatus === null) throw new Error("offline"); return serverStatus; },
    sleep: async (ms) => { sleeps.push(ms); },
    report: (state) => states.push(state),
  };
  return { deps, states, sleeps, sends: () => sent };
}

test("a busy replay queue (429) is waited out, said plainly, and ends accepted", async () => {
  const n = network([429, 429, "ok"]);
  expect(await deliver(n.deps)).toBe("accepted");
  expect(n.sleeps).toEqual([retryDelay(1), retryDelay(2)]);
  expect(n.states).toEqual([{ kind: "sending", attempt: 1, busy: false }, { kind: "sending", attempt: 2, busy: true }, { kind: "sending", attempt: 3, busy: true }, { kind: "accepted" }]);
});

test("a lost reply is recognised: the retry is refused as 'not waiting' but the server already holds the run", async () => {
  const n = network([0, 409], "pending");
  expect(await deliver(n.deps)).toBe("accepted");
  expect(n.states.at(-1)).toEqual({ kind: "accepted" });
});

test("a run the server closed is reported as not saved, with the real cause", async () => {
  const n = network([409], "failed");
  expect(await deliver(n.deps)).toBe("closed");
  const last = n.states.at(-1) as Extract<BrowserRunState, { kind: "closed" }>;
  expect(last.kind).toBe("closed"); expect(last.reason).toContain("30 minutes");
});

test("when the server's state cannot be read the 409 is retried, never assumed either way", async () => {
  const n = network([409, 409, "ok"], null);
  expect(await deliver(n.deps)).toBe("accepted");
  expect(n.sends()).toBe(3);
});

test("retries are bounded: network loss leaves the run unsent and says so, without claiming it was saved", async () => {
  const n = network([0]);
  expect(await deliver(n.deps)).toBe("unsent");
  expect(n.sends()).toBe(MAX_ATTEMPTS); expect(n.sleeps).toHaveLength(MAX_ATTEMPTS - 1);
  const last = n.states.at(-1) as Extract<BrowserRunState, { kind: "unsent" }>;
  expect(last).toEqual({ kind: "unsent", reason: "The server could not be reached." });
  expect(n.states.some(s => s.kind === "accepted")).toBe(false);
});

test("exhausted 429 retries and server errors keep the run for sending again", async () => {
  expect((await (async () => { const n = network([429]); await deliver(n.deps); return n.states.at(-1); })())).toEqual({ kind: "unsent", reason: "The server is busy replaying other runs." });
  expect((await (async () => { const n = network([503]); await deliver(n.deps); return n.states.at(-1); })())).toEqual({ kind: "unsent", reason: "The server had a problem receiving it." });
});

test("an ended sign-in is recoverable at once; a refusal that cannot succeed is not retried", async () => {
  const auth = network([401]);
  expect(await deliver(auth.deps)).toBe("unsent");
  expect(auth.sends()).toBe(1); expect((auth.states.at(-1) as { reason: string }).reason).toContain("Sign in again");
  const refused = network([400]);
  expect(await deliver(refused.deps)).toBe("closed");
  expect(refused.sends()).toBe(1); expect((refused.states.at(-1) as { reason: string }).reason).toContain("error 400");
});

test("stopping before the first second cancels instead of submitting and records that nothing was saved", async () => {
  const n = network([409]);
  expect(await deliver(n.deps, { cancel: true })).toBe("closed");
  expect((n.states.at(-1) as { reason: string }).reason).toContain("nothing was recorded");
});

test("messages never call an unsent or closed run saved, and offer the right recovery", () => {
  const unsent = describeBrowserRun({ kind: "unsent", reason: "The server could not be reached." }, null)!;
  expect(unsent).toMatchObject({ tone: "fail", action: "send-again" });
  expect(unsent.body).toContain("not been verified"); expect(unsent.title).toBe("Your run has not been saved");
  expect(describeBrowserRun({ kind: "closed", reason: "x" }, null)).toMatchObject({ tone: "fail", action: "leave" });
  expect(describeBrowserRun({ kind: "crashed", reason: "boom" }, null)!.body).toContain("Nothing from this run was saved");
  const busy = describeBrowserRun({ kind: "sending", attempt: 2, busy: true }, null)!;
  expect(busy.body).toContain("not saved yet"); expect(busy.body).toContain("Keep this tab open");
  expect(describeBrowserRun({ kind: "accepted" }, null)!.title).toBe("Received by the server");
  expect(describeBrowserRun(undefined, null)).toBeNull();
  expect(describeBrowserRun({ kind: "starting" }, null)).toBeNull();
  expect(describeBrowserRun({ kind: "starting", problem: "Network Error" }, null)!.body).toContain("Network Error");
});

test("the real-time limit is only mentioned near the end and says pausing does not extend it", () => {
  expect(describeBrowserRun({ kind: "running" }, 25 * 60_000)).toBeNull();
  const warning = describeBrowserRun({ kind: "running" }, 7 * 60_000 - 1)!;
  expect(warning.title).toBe("About 7 min of real time left");
  expect(warning.body).toContain("even while the simulation is paused");
  expect(autoStopDelay(100_000, 90_000)).toBe(10_000);
  expect(autoStopDelay(60_000, 90_000)).toBe(0);
});

// The page-level flow with a fake worker and a fake network, in an isolated instance (no global mocks).
const posts: Array<{ url: string; body: unknown }> = [];
let worker: { onDone: (s: unknown) => void; onError: (m: string) => void } | null = null;
let stops = 0;
const state = { remaining: 1800, failPost: undefined as number | undefined, serverStatus: "browser" };
const runs = createBrowserRuns({ apiUrl: "http://api",
  http: {
    get: async (url: string) => {
      if (url.endsWith("/browser-run")) return { data: { browserRun: { input: {}, horizonSeconds: 60, stopAtSecond: 60, lifetimeRemainingSeconds: state.remaining } } };
      return { data: { deployment: { status: state.serverStatus } } };
    },
    post: async (url: string, body: unknown) => {
      posts.push({ url, body });
      if (state.failPost !== undefined) throw Object.assign(new Error("failed"), { response: { status: state.failPost } });
      return { data: {} };
    },
  } as never,
  startRun: ((_start: unknown, callbacks: typeof worker) => { worker = callbacks; return { stop: () => { stops++; }, setSpeed: () => {}, act: async () => ({ ok: true }) }; }) as never,
});

beforeEach(() => {
  posts.length = 0; worker = null; stops = 0; state.remaining = 1800; state.failPost = undefined; state.serverStatus = "browser";
  useBrowserRunStatus.setState({ runs: {}, deadlines: {} });
});

test("a worker crash is shown, the server run is closed with its reason, and controls explain instead of throwing", async () => {
  await runs.startBrowserRun("run-a");
  expect(useBrowserRunStatus.getState().runs["run-a"]).toEqual({ kind: "running" });
  worker!.onError("Out of memory");
  expect(runs.browserRunFor("run-a")).toBeUndefined();
  expect(useBrowserRunStatus.getState().runs["run-a"]).toEqual({ kind: "crashed", reason: "Out of memory" });
  expect(posts).toEqual([{ url: "http://api/deployments/run-a/cancel", body: { reason: "browser-error" } }]);
  await expect(runs.actInBrowser("run-a", { kind: "load", parameters: { targetLoadFraction: 1 } })).rejects.toThrow("stopped unexpectedly in your browser");
  expect((await runs.browserStopStatus("run-a")).status).toBe("failed");
});

test("a failed start is shown with its reason and the next attempt can still start the run", async () => {
  state.remaining = Number.NaN;
  const broken = createBrowserRuns({ apiUrl: "http://api", startRun: (() => { throw new Error("worker unavailable"); }) as never,
    http: { get: async () => { throw Object.assign(new Error("Network Error"), {}); }, post: async () => ({ data: {} }) } as never });
  await expect(broken.startBrowserRun("run-d")).rejects.toThrow();
  expect(useBrowserRunStatus.getState().runs["run-d"]).toEqual({ kind: "starting", problem: "Network Error" });
  expect(broken.browserRunFor("run-d")).toBeUndefined();
});

test("an unsent run is kept in the tab, never reported as saved, and Send again delivers it", async () => {
  await runs.startBrowserRun("run-b");
  state.failPost = 401;
  worker!.onDone({ stopAtSecond: 30, actions: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(useBrowserRunStatus.getState().runs["run-b"]).toMatchObject({ kind: "unsent" });
  const stop = await runs.browserStopStatus("run-b");
  expect(stop.status).toBe("failed"); expect(stop.failureReason).toContain("Sign in again");
  state.failPost = undefined;
  await runs.sendAgain("run-b");
  expect(useBrowserRunStatus.getState().runs["run-b"]).toEqual({ kind: "accepted" });
  expect(posts.filter(p => p.url.endsWith("/submit")).map(p => p.body)).toEqual([{ stopAtSecond: 30, actions: [] }, { stopAtSecond: 30, actions: [] }]);
});

test("a run near the server's real-time limit is stopped by itself so its result is kept", async () => {
  state.remaining = 60;
  await runs.startBrowserRun("run-c");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(stops).toBe(1);
});
