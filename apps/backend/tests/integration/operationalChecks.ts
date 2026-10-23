import { expect } from "bun:test";
import type { LocalHarness } from "./localHarness";
import { until } from "./localHarness";
import { layout, workload } from "./scenario";

export async function checkOperationalDeadline(h: LocalHarness, designs: string[], runs: string[]) {
  const design = (await h.request("/infrastructure", { name: "Operational deadline", layout }, "POST", 201)).createdInfrastructure;
  designs.push(design.id);
  const create = async () => {
    const run = (await h.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 201)).createdDeployment;
    runs.push(run.id); return run;
  };
  const run = await create();
  const read = async () => (await h.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [run.id])).rows[0];
  await until(async () => (await read()).status === "live" || undefined, "operational run live", 30000);
  const pause = (await h.request(`/deployments/${run.id}/speed`, { speed: 0 }, "POST", 202)).action;
  // Poll durable state directly: HTTP polling here would spend the suite's shared request budget.
  const action = async () => (await h.sql.query('SELECT status FROM "RunAction" WHERE id=$1', [pause.id])).rows[0];
  await until(async () => (await action()).status === "completed" || undefined, "operational pause");
  const paused = (await h.request(`/deployments/${run.id}/actions/${pause.id}`)).action.completedSimulatedSeconds;
  // Advance the durable wall clock fixture, without changing production policy or timers.
  await h.sql.query('UPDATE "Deployment" SET "createdAt"=now()-interval \'31 minutes\' WHERE id=$1', [run.id]);
  const terminal = await until(async () => { const row = await read(); return row.status === "torn-down" ? row : undefined; }, "paused deadline durable stop", 20000);
  expect(terminal.runtimeActive).toBe(false);
  expect(terminal.terminalSnapshot.simulatedSeconds).toBe(paused);
  const actions = (await h.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 AND kind=\'teardown\'', [run.id])).rows;
  expect(actions).toHaveLength(1); expect(actions[0].parameters).toEqual({ trigger: "operational-limit" });
  expect(actions[0].status).toBe("completed");
  // A completed operational stop frees capacity for ordinary public admission.
  const replacement = await create();
  const row = async () => (await h.sql.query('SELECT status, "runtimeActive" FROM "Deployment" WHERE id=$1', [replacement.id])).rows[0];
  await until(async () => (await row()).status === "live" || undefined, "replacement live", 30000);
  expect((await h.request(`/deployments/${replacement.id}`)).deployment.status).toBe("live");
  await h.request(`/deployments/${replacement.id}/teardown`, {}, "POST", 202);
  await until(async () => !(await row()).runtimeActive || undefined, "replacement durable stop");
  expect((await h.request(`/deployments/${replacement.id}`)).deployment.runtimeActive).toBe(false);
  return { pausedSecond: paused, terminalSecond: terminal.terminalSnapshot.simulatedSeconds, trigger: actions[0].parameters.trigger, replacement: replacement.id };
}
