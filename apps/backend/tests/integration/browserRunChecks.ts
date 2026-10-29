import { expect } from "bun:test";
import { DEFAULT_RETRY_SETTINGS } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { readRunInputs } from "../../deployments/runInputs";
import { LocalHarness, until } from "./localHarness";
import { layout, workload } from "./scenario";

/* What the learner's browser does when a run ends: it submits the second it stopped at and the actions it took.
The server replays that, and only the replay is recorded. Returns the recorded run. */
export async function submitBrowserRun(h: LocalHarness, id: string, stopAtSecond: number, actions: unknown[] = []) {
  const read = async () => (await h.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  await until(async () => (await read()).status === "browser" || undefined, "run waiting for the browser", 60000, 200);
  await h.request(`/deployments/${id}/submit`, { stopAtSecond, actions }, "POST", 202);
  return until(async () => { const r = await read(); return ["torn-down", "completed", "failed"].includes(r.status) && !r.runtimeActive ? r : undefined; },
    "browser run replayed", 180000, 250);
}

/* The browser-run path end to end. A run passes the gates and waits for the browser; the
"browser" (here the same shared run module the web worker uses) runs it with one action and submits; the server
replays it, and the official record equals what the browser showed. */
export async function checkBrowserRun(h: LocalHarness, designs: string[], runs: string[]) {
  const retryLayout = structuredClone(layout);
  retryLayout.resources.find((r) => r.type === "Load Balancer")!.retry = { ...DEFAULT_RETRY_SETTINGS };
  const design = (await h.request("/infrastructure", { name: "Browser run", layout: retryLayout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const run = (await h.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 201)).createdDeployment;
  runs.push(run.id);
  const read = async () => (await h.request(`/deployments/${run.id}`)).deployment;
  const waiting = await until(async () => { const r = await read(); return r.status === "browser" ? r : undefined; }, "browser run ready", 30000, 200);
  const input = readRunInputs(waiting.runInputs);
  expect(input.version === 2 ? input.simulationModelVersion : null).toBe("2");
  const start = (await h.request(`/deployments/${run.id}/browser-run`)).browserRun;
  expect(start).toMatchObject({ horizonSeconds: 900, stopAtSecond: 900 });

  // The browser side: an action at second 5, another at second 12, then stop at 12 before any further second.
  const browser = createModel2Run(start.input, start.horizonSeconds);
  for (let s = 0; s < 5; s++) browser.advance();
  browser.apply({ kind: "load", parameters: { targetLoadFraction: 1.5 } });
  for (let s = 5; s < 12; s++) browser.advance();
  browser.apply({ kind: "load", parameters: { targetLoadFraction: 0.8 } });
  const shown = browser.view();

  await h.request(`/deployments/${run.id}/load`, { targetLoadFraction: 1 }, "POST", 409); // no server controls during a browser run
  await h.request(`/deployments/${run.id}/submit`, { stopAtSecond: 12,
    actions: [{ atSecond: 5, request: { kind: "load", parameters: { targetLoadFraction: 1.5 } } },
      { atSecond: 12, request: { kind: "load", parameters: { targetLoadFraction: 0.8 } } }] }, "POST", 202);
  const done = await until(async () => { const r = await read(); return r.status === "torn-down" ? r : undefined; }, "browser run replayed", 60000, 250);
  expect(done.terminalSnapshot.simulatedSeconds).toBe(12);
  expect(done.terminalSnapshot.metrics).toEqual(JSON.parse(JSON.stringify(shown.metrics))); // official record = what the browser showed
  expect(done.terminalSnapshot.overallHealth).toBe(shown.overallHealth);
  expect(done.terminalSnapshot.loadFraction).toBe(0.8); // the action at the stop second is in the record
  const actions = (await h.sql.query('SELECT kind, status, "appliedSimulatedSeconds" AS at FROM "RunAction" WHERE "deploymentId"=$1 ORDER BY sequence', [run.id])).rows;
  expect(actions).toEqual([{ kind: "load", status: "completed", at: 5 }, { kind: "load", status: "completed", at: 12 }, { kind: "teardown", status: "completed", at: 12 }]);
  await h.request(`/deployments/${run.id}/submit`, { stopAtSecond: 12, actions: [] }, "POST", 409); // a run is replayed once
}
