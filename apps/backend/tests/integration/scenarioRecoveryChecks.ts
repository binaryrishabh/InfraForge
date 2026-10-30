import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import type { RunReport } from "@infraforge/contracts/reports";
import { LocalHarness, until } from "./localHarness";
import { submitBrowserRun } from "./browserRunChecks";
import { boundRetriesDuringSlowdownV1 as d } from "../../challenges/definitions/bound-retries-during-slowdown/v1";

// Uses the ordinary learner attempt/submit APIs, real guards and worker restart.
export async function checkScenarioRecovery(h: LocalHarness, workspace: string, runs: string[], queue: Queue) {
  const row = async (id: string) => (await h.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
  const actions = async (id: string) => (await h.sql.query('SELECT * FROM "RunAction" WHERE "deploymentId"=$1 AND "scenarioStepId" IS NOT NULL ORDER BY sequence', [id])).rows;
  const report = async (id: string): Promise<RunReport> => (await h.request(`/deployments/${id}/report`)).report;
  const start = async () => {
    const run = (await h.request(`/challenges/${d.id}/attempts`, {infrastructureId: workspace,
      prediction: {answers: {health: "saturated"}, reasoning: null}}, "POST", 201)).createdDeployment;
    runs.push(run.id);
    await until(async () => (await row(run.id)).status === "browser" || undefined, "scenario retry browser ready", 30000, 200);
    return run.id as string;
  };
  const redeliver = async (id: string) => {
    const before = await actions(id), terminal = await row(id);
    const job = await queue.add("deployment-created", {deploymentId: id}, {jobId: randomUUID()});
    await until(async () => (await job.getState()) === "completed" || undefined, "retired scenario job skipped");
    expect(await actions(id)).toEqual(before);
    expect(await row(id)).toEqual(terminal);
    expect((await report(id)).challenge?.status).toBe("not-evaluated");
  };
  // Persist the uncertain state left by a committed claim whose reply was lost.
  // The local fault-injection test covers the actual lost reply and zero engine actions.
  const lost = await start();
  await h.sql.query('UPDATE "Deployment" SET "actionSequence"=1 WHERE id=$1', [lost]);
  await h.sql.query('INSERT INTO "RunAction" (id,"deploymentId",sequence,kind,parameters,"scenarioStepId") VALUES ($1,$2,1,\'intervention\',$3,$4)',
    [randomUUID(), lost, d.scenario!.steps[0]!.request, d.scenario!.steps[0]!.id]);
  await h.sql.query('UPDATE "RunAction" SET status=\'applying\' WHERE "deploymentId"=$1', [lost]);
  expect((await submitBrowserRun(h, lost, 5)).status).toBe("torn-down");
  expect(await actions(lost)).toMatchObject([{status: "failed", appliedAt: null, appliedSimulatedSeconds: null}]);
  expect((await report(lost)).challenge).toMatchObject({status: "not-evaluated", metCount: 0});
  await redeliver(lost);

  const interrupted = await start(), name = `scenario_probe_${randomUUID().replaceAll("-", "")}`;
  // Fail acknowledgement after the in-memory application. The claim stays applying;
  // acknowledgement retries freeze advancement until we kill the worker.
  await h.sql.query(`CREATE SEQUENCE ${name};
    CREATE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."deploymentId"='${interrupted}' AND NEW."scenarioStepId" IS NOT NULL AND NEW.status='running' THEN
        PERFORM nextval('${name}'); RAISE EXCEPTION 'owned scenario acknowledgement blocked';
      END IF; RETURN NEW; END $$;
    CREATE TRIGGER ${name} BEFORE UPDATE ON "RunAction" FOR EACH ROW EXECUTE FUNCTION ${name}_fn()`);
  try {
    await h.request(`/deployments/${interrupted}/submit`, {stopAtSecond: 5, actions: []}, "POST", 202);
    await until(async () => {
      const state = (await h.sql.query(`SELECT last_value::int, is_called FROM ${name}`)).rows[0];
      return state.is_called && state.last_value >= 2 || undefined;
    }, "scenario acknowledgement frozen", 30000);
    expect(await actions(interrupted)).toMatchObject([{status: "applying", appliedAt: null}]);
    expect(await row(interrupted)).toMatchObject({status: "live", runtimeActive: true, terminalSnapshot: null});
    await h.stop("worker");
  } finally {
    await h.sql.query(`DROP TRIGGER ${name} ON "RunAction"; DROP FUNCTION ${name}_fn(); DROP SEQUENCE ${name}`);
  }
  await h.startWorker();
  await until(async () => (await row(interrupted)).status === "failed" || undefined, "scenario restart retired replay");
  expect(await row(interrupted)).toMatchObject({status: "failed", runtimeActive: false, terminalSnapshot: null});
  expect(await actions(interrupted)).toMatchObject([{status: "failed", appliedAt: null}]);
  expect((await report(interrupted)).challenge?.status).toBe("not-evaluated");
  await redeliver(interrupted);

  // No special recovery API: the same workspace admits and scores a fresh attempt.
  const retry = await start();
  expect((await submitBrowserRun(h, retry, 5)).status).toBe("torn-down");
  expect(await actions(retry)).toMatchObject([{status: "completed", appliedSimulatedSeconds: 2, completedSimulatedSeconds: 5}]);
  expect((await report(retry)).challenge?.status).toBe("met");
  return {lost, interrupted, retry, uncertainAttemptsUnscored: true, redeliverySkipped: true};
}
