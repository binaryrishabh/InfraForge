import { expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { readOperationalLimits, reservationWhere, serverWorkWhere } from "../../deployments/operationalLimits";
import { readRunInputs } from "../../deployments/runInputs";
import { ReplayQueueStatusSchema } from "../../replay/contract";
import { childEnvironment, until, type LocalHarness } from "./localHarness";
import { spawnOwned } from "./ownedProcess";
import type { SessionFixtures } from "./sessionFixtures";
import { layout, workload } from "./scenario";

// Called with the owned worker stopped: HTTP writes cannot race replay or the periodic sweep.
export async function checkBrowserRunLifecycle(h: LocalHarness, sessions: SessionFixtures, designs: string[], runs: string[]) {
  const cookie = h.cookie;
  const owner = await sessions.create(), other = await sessions.create();
  const limits = readOperationalLimits({}); // The harness child environment uses the default operational policy.
  h.cookie = owner.cookie;
  try {
    const design = (await h.request("/infrastructure", { name: "Browser lifecycle", layout }, "POST", 201)).createdInfrastructure;
    designs.push(design.id);
    const create = async (browser = true) => {
      const run = (await h.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 201)).createdDeployment;
      runs.push(run.id);
      // Admission captures real inputs; only the gate result is a fixture here. checkBrowserRun covers real gates/replay.
      if (browser) await h.sql.query('UPDATE "Deployment" SET status=\'browser\' WHERE id=$1', [run.id]);
      return run.id as string;
    };
    const read = async (id: string) => (await h.sql.query('SELECT * FROM "Deployment" WHERE id=$1', [id])).rows[0];
    const asOther = async (path: string, body: unknown, method: string, status: number) => {
      h.cookie = other.cookie;
      try { await h.request(path, body, method, status); } finally { h.cookie = owner.cookie; }
    };
    const cancel = (id: string, body?: unknown, status = 200) => h.request(`/deployments/${id}/cancel`, body, "POST", status);
    const reservations = () => sessions.prisma.deployment.count({ where: { ...reservationWhere, ownerId: owner.user.id } });
    const replayRows = (id: string) => sessions.prisma.outbox.findMany({ where: {
      eventType: "deployment-replay", payload: { path: ["deploymentId"], equals: id },
    } });
    const expectReplayCapacity = async () => {
      // admitReplay intentionally precedes ownership/status checks; both limits must permit 400/404/409.
      expect(await sessions.prisma.deployment.count({ where: serverWorkWhere })).toBeLessThan(limits.global);
      expect(await sessions.prisma.deployment.count({ where: { status: "pending" } })).toBeLessThan(limits.queued);
    };

    console.info("Browser lifecycle check: response lifetime and ownership");
    const first = await create(), before = await read(first);
    const { lifetimeRemainingSeconds, ...start } = (await h.request(`/deployments/${first}/browser-run`)).browserRun;
    expect(typeof lifetimeRemainingSeconds).toBe("number");
    expect(Number.isInteger(lifetimeRemainingSeconds)).toBe(true);
    expect(lifetimeRemainingSeconds).toBeGreaterThanOrEqual(0);
    expect(lifetimeRemainingSeconds).toBeLessThanOrEqual(limits.lifetimeSeconds);
    expect(start).toEqual({ input: readRunInputs(before.runInputs), horizonSeconds: limits.freeformSeconds, stopAtSecond: limits.freeformSeconds });
    await asOther(`/deployments/${first}/browser-run`, undefined, "GET", 404);
    expect(await read(first)).toEqual(before);

    console.info("Browser lifecycle check: strict cancel reasons and unchanged refused runs");
    for (const body of [{ reason: "unknown" }, { reason: "discarded", extra: true }]) {
      await cancel(first, body, 400);
      expect(await read(first)).toEqual(before);
    }
    await asOther(`/deployments/${first}/cancel`, undefined, "POST", 409);
    expect(await read(first)).toEqual(before);
    const cases = [
      { body: undefined, message: "Stopped before its first simulated second; nothing was recorded." },
      { body: { reason: "browser-error" }, message: "The learner's browser stopped this run unexpectedly; nothing was recorded." },
      { body: { reason: "discarded" }, message: "Discarded by the learner before it finished; nothing was recorded." },
    ];
    for (const [index, item] of cases.entries()) {
      const id = index === 0 ? first : await create(), initial = await read(id);
      await cancel(id, item.body);
      const closed = await read(id);
      expect(closed).toMatchObject({ status: "failed", runtimeActive: false, browserSubmission: null, terminalSnapshot: null });
      expect(closed.timeline).toEqual([...initial.timeline, { timestamp: expect.any(String), event: "Deployment Failed", message: item.message }]);
      expect(await replayRows(id)).toHaveLength(0);
      await cancel(id, item.body, 409);
      await h.request(`/deployments/${id}/browser-run`, undefined, "GET", 409);
      expect(await read(id)).toEqual(closed);
      expect(await replayRows(id)).toHaveLength(0);
    }

    console.info("Browser lifecycle check: cancel releases the owner's admission reservation");
    const reserved: string[] = [];
    for (let i = 0; i < limits.perOwner; i++) reserved.push(await create());
    expect(await reservations()).toBe(limits.perOwner);
    await h.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 429);
    await cancel(reserved[0]!);
    expect(await reservations()).toBe(limits.perOwner - 1);
    reserved[0] = await create();
    expect(await reservations()).toBe(limits.perOwner);
    await h.request("/deployments", { infrastructureId: design.id, workloadProfile: workload }, "POST", 429);
    for (const id of reserved) await cancel(id);
    expect(await reservations()).toBe(0);

    console.info("Browser lifecycle check: submit persists once and rejects malformed/foreign submissions");
    const submitted = await create(false), pending = await read(submitted);
    await cancel(submitted, undefined, 409);
    expect(await read(submitted)).toEqual(pending);
    await h.sql.query('UPDATE "Deployment" SET status=\'browser\' WHERE id=$1', [submitted]);
    const waiting = await read(submitted), submission = { stopAtSecond: 5, actions: [] };
    expect(await replayRows(submitted)).toHaveLength(0);
    await expectReplayCapacity();
    for (const body of [{ stopAtSecond: 0, actions: [] }, { stopAtSecond: 5 }, { ...submission, extra: true }]) {
      await h.request(`/deployments/${submitted}/submit`, body, "POST", 400);
      expect(await read(submitted)).toEqual(waiting);
      expect(await replayRows(submitted)).toHaveLength(0);
    }
    await asOther(`/deployments/${submitted}/submit`, submission, "POST", 404);
    expect(await read(submitted)).toEqual(waiting);
    expect(await replayRows(submitted)).toHaveLength(0);
    await h.request(`/deployments/${submitted}/submit`, submission, "POST", 202);
    const accepted = await read(submitted), outbox = await replayRows(submitted);
    expect(accepted).toMatchObject({ status: "pending", browserSubmission: submission });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ eventType: "deployment-replay", payload: { deploymentId: submitted }, status: "pending" });
    // The owned worker is stopped, so GET must expose the durable pending replay without racing completion.
    const replayResponse = await h.request(`/deployments/${submitted}`);
    const replay = ReplayQueueStatusSchema.parse(replayResponse.replay);
    expect(replay).toMatchObject({ state: "queued", position: expect.any(Number), runsAhead: expect.any(Number) });
    expect(replayResponse.deployment).toMatchObject({ id: submitted, status: "pending" });
    await asOther(`/deployments/${submitted}`, undefined, "GET", 404);
    await expectReplayCapacity();
    await h.request(`/deployments/${submitted}/submit`, submission, "POST", 409);
    expect(await read(submitted)).toEqual(accepted);
    expect(await replayRows(submitted)).toEqual(outbox);
    await cancel(submitted, { reason: "discarded" }, 409);
    expect(await read(submitted)).toEqual(accepted);

    console.info("Browser lifecycle check: injected abandoned-run sweep is selective and idempotent");
    const sweep = await checkAbandonedRuns(h, sessions, design.id, owner.user.id, runs);
    return { lifetimeRemainingSeconds, cancelMessages: cases.map(item => item.message), ownerLimit: limits.perOwner,
      submitStatus: accepted.status, replayRows: outbox.length, sweep };
  } finally { h.cookie = cookie; }
}

async function checkAbandonedRuns(h: LocalHarness, sessions: SessionFixtures, designId: string, ownerId: string, runs: string[]) {
  // Historical dates isolate the injected clock from every other fixture; the worker is stopped.
  const now = Date.UTC(2000, 0, 1), lifetimeSeconds = 60;
  const timeline = [{ timestamp: new Date(now - 120000).toISOString(), event: "Deployment Created", message: "Waiting for the browser." }];
  const fixture = async (status: string, ageSeconds: number) => {
    const id = crypto.randomUUID(); runs.push(id);
    await sessions.prisma.deployment.create({ data: { id, infrastructureId: designId, ownerId, status,
      createdAt: new Date(now - ageSeconds * 1000), timeline } });
    return id;
  };
  const old = await fixture("browser", lifetimeSeconds + 1);
  const untouched = [await fixture("browser", lifetimeSeconds - 1), await fixture("browser", lifetimeSeconds)];
  for (const status of ["pending", "running", "live", "completed", "failed", "torn-down"]) {
    untouched.push(await fixture(status, lifetimeSeconds + 1));
  }
  const read = async () => (await h.sql.query('SELECT * FROM "Deployment" WHERE id=ANY($1::text[]) ORDER BY id', [[old, ...untouched]])).rows;
  const before = await read();
  // Import the production singleton only in an owned child with the harness's guarded database environment.
  const child = spawnOwned([process.execPath, "--no-env-file", "--no-install", "-e", `
    import { closeAbandonedBrowserRuns, ABANDONED_RUN_MESSAGE } from "./browserRuns/abandon";
    import { readOperationalLimits } from "./deployments/operationalLimits";
    import { prisma } from "./lib/prisma";
    try {
      const limits = { ...readOperationalLimits({}), lifetimeSeconds: 60 };
      const now = Date.UTC(2000, 0, 1);
      const closed = await closeAbandonedBrowserRuns(now, limits);
      const repeated = await closeAbandonedBrowserRuns(now, limits);
      console.log(JSON.stringify({ closed, repeated, message: ABANDONED_RUN_MESSAGE }));
    } finally { await prisma.$disconnect(); }
  `], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: childEnvironment(h.settings, process.env) });
  const output = new Response(child.stdout).text();
  const errors = new Response(child.stderr).text();
  let result: { closed: number; repeated: number; message: string };
  try {
    const exit = await until(async () => child.exitCode === null ? undefined : child.exitCode, "injected abandoned-run sweep", 30000, 100);
    expect(exit).toBe(0);
    result = JSON.parse(await output);
  } finally {
    child.kill("SIGKILL");
    await until(async () => child.exitCode === null ? undefined : child.exitCode, "sweep child exit", 10000, 100);
    await Promise.all([output, errors]);
  }
  expect(result).toEqual({ closed: 1, repeated: 0, message: "The browser never submitted this run within its lifetime (the tab was closed or lost its connection), so it has no recorded result." });
  const after = await read();
  for (const id of untouched) expect(after.find(row => row.id === id)).toEqual(before.find(row => row.id === id));
  const closed = after.find(row => row.id === old), initial = before.find(row => row.id === old);
  expect(closed).toEqual({ ...initial, status: "failed", updatedAt: expect.any(Date),
    timeline: [...timeline, { timestamp: expect.any(String), event: "Deployment Failed", message: result.message }] });
  return { closed: result.closed, repeated: result.repeated, unchanged: untouched.length };
}
