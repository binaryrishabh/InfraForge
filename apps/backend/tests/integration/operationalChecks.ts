import { expect } from "bun:test";
import type { LocalHarness } from "./localHarness";
import { until } from "./localHarness";
import { layout, workload } from "./scenario";
import { submitBrowserRun } from "./browserRunChecks";

/* A run the browser never submits (the tab was closed) is closed after the run lifetime with its reason,
and a new run is admitted and recorded as usual. */
export async function checkOperationalDeadline(h: LocalHarness, designs: string[], runs: string[]) {
  const design = (await h.request("/infrastructure", { name: "Operational deadline", layout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const create = async () => {
    const run = (await h.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 201)).createdDeployment;
    runs.push(run.id); return run;
  };
  const run = await create();
  const read = async () => (await h.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [run.id])).rows[0];
  await until(async () => (await read()).status === "browser" || undefined, "operational run in the browser", 30000);
  // Advance the durable wall clock fixture, without changing production policy or timers. The sweep runs once a minute.
  await h.sql.query('UPDATE "Deployment" SET "createdAt"=now()-interval \'31 minutes\' WHERE id=$1', [run.id]);
  const closed = await until(async () => { const row = await read(); return row.status === "failed" ? row : undefined; }, "abandoned browser run closed", 90000, 1000);
  expect(closed.runtimeActive).toBe(false);
  expect(closed.terminalSnapshot).toBeNull();
  expect(closed.timeline.at(-1)).toMatchObject({ event: "Deployment Failed", message: expect.stringContaining("never submitted") });
  await h.request(`/deployments/${run.id}/submit`, { stopAtSecond: 5, actions: [] }, "POST", 409);
  // Capacity is unaffected: a new run is admitted, run and recorded.
  const replacement = await create();
  const recorded = await submitBrowserRun(h, replacement.id, 5);
  expect(recorded).toMatchObject({ status: "torn-down", runtimeActive: false });
  expect(recorded.terminalSnapshot.simulatedSeconds).toBe(5);
  return { closedStatus: closed.status, replacement: replacement.id };
}
