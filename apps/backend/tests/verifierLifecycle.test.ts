import { expect, test } from "bun:test";
import { createVerifierLifecycle } from "../firstStack/verifierLifecycle";
import { createVerifierAdmission, engineAvailability } from "../firstStack/verifierAvailability";
import { refreshVerifierQualification, readProtectedJson } from "../firstStack/verifierQualification";
import { boundedVerifierDrain, drainVerifierWorker } from "../firstStack/verifierDrain";
import { verifierExecutionAllowed, createSubmissionFence } from "../firstStack/submissionWorker";
import { createSubmissionService } from "../firstStack/admission";
import { isolationPolicyHash, qualificationChecks, type HostQualification } from "../firstStack/isolationPolicy";
import type { SubmissionVerifier } from "../firstStack/submissionWorker";
import { submissionFixture } from "./submissionFixture";
import { fileURLToPath } from "node:url";

test("host lifecycle resumes a queue left paused before restart, starts once and drains despite Redis loss", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
    fileURLToPath(new URL("./verifierLifecycleHarness.ts", import.meta.url))],
  { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
  expect(output).toContain("Verifier lifecycle ordering and dependency invalidation passed");
});

for (const failure of ["fingerprint", "headroom", "canary", "ownership"]) {
  test(`lifecycle rejects startup and releases ownership after ${failure === "ownership" ? "ownership is lost during the canary" : `${failure} failure`}`, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
      fileURLToPath(new URL("./verifierLifecycleHarness.ts", import.meta.url)), failure], { stdout: "pipe", stderr: "pipe" });
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    expect(output).toContain("Verifier callback failure closes startup");
  });
}

test("shutdown waits for an unfinished renewal after queue drain before closing dependencies", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
    fileURLToPath(new URL("./verifierLifecycleHarness.ts", import.meta.url)), "unfinished-renewal"], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ code, error }).toEqual({ code: 0, error: "" });
  expect(output).toContain("Shutdown keeps dependencies open until renewal settles");
});

function fixture() {
  const source = "a".repeat(64), image = `sha256:${"b".repeat(64)}`, daemon = "c".repeat(64);
  const qualification: HostQualification = { schema: "first-stack-host/1", target: "ec2-c7i-flex.large",
    source, image, daemon, policy: isolationPolicyHash, capacity: 1, qualified: true,
    checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    checks: Object.fromEntries(qualificationChecks.map(k => [k, true])) as HostQualification["checks"] };
  const configuration: SubmissionVerifier = { admission: { enabled: true, engine: { source, image } },
    isolation: { source, image, qualification }, healthy: () => true,
    control: { identity: daemon, assertIdentity: async () => {},
      run: async () => JSON.stringify([{ Id: image, Os: "linux" }]),
      attach: async () => { throw Error("No child"); } } };
  return configuration;
}

test("a disabled lifecycle starts once and cannot open dependencies", async () => {
  const lifecycle = createVerifierLifecycle({ enabled: false, image: "", endpoint: "", qualification: "" }, "", {});
  const first = lifecycle.start(), second = lifecycle.start();
  expect(first).toBe(second);
  await expect(first).rejects.toThrow("disabled");
  expect(lifecycle.start()).toBe(first);
});

test("availability rejects stale, expired, wrong and extra fields and exposes only safe engine budgets", async () => {
  const { admission } = fixture(), now = Date.now();
  const snapshot = { ...admission.engine!, checkedAt: now, expiresAt: now + 5000, qualifiedUntil: now + 60000 };
  const safe = engineAvailability(snapshot, admission.engine, true, now);
  expect(safe.available).toBe(true);
  expect(Object.keys(safe).sort()).toEqual(["available", "capacity", "engine", "executor", "expiresAt"]);
  for (const value of [null, {}, { ...snapshot, expiresAt: now }, { ...snapshot, qualifiedUntil: now },
    { ...snapshot, checkedAt: now - 5000, expiresAt: now - 1 },
    { ...snapshot, checkedAt: now + 1 }, { ...snapshot, expiresAt: now + 5001 },
    { ...snapshot, source: "d".repeat(64) }, { ...snapshot, image: `sha256:${"d".repeat(64)}` },
    { ...snapshot, daemon: "hidden" }]) {
    expect(engineAvailability(value, admission.engine, true, now).available).toBe(false);
  }
  expect(engineAvailability(snapshot, admission.engine, false, now).available).toBe(false);
  expect(engineAvailability(snapshot, null, true, now).available).toBe(false);
  for (const text of [null, "{", "x".repeat(1025)]) {
    const invalid = createVerifierAdmission(true, admission.engine, { get: async () => text });
    expect(await invalid.availability()).toEqual({ available: false, engine: null });
  }
  let lost = false;
  const client = createVerifierAdmission(true, admission.engine,
    { get: async () => { if (lost) throw Error("secret dependency failure"); return JSON.stringify(snapshot); } });
  expect(await client.admission.available!()).toBe(true);
  lost = true;
  expect(await client.availability()).toEqual({ available: false, engine: null });
});

test("missing and expired qualification, wrong runtime and failed refresh remove execution authority", async () => {
  const c = fixture(), q = c.isolation.qualification!;
  expect(verifierExecutionAllowed(c)).toBe(true);
  c.isolation.qualification = null; expect(verifierExecutionAllowed(c)).toBe(false);
  c.isolation.qualification = { ...q, expiresAt: new Date(Date.now() - 1).toISOString() };
  expect(verifierExecutionAllowed(c)).toBe(false);
  for (const value of [null, { ...q, target: "ci-linux" }, { ...q, target: "laptop-desktop" },
    { ...q, daemon: "e".repeat(64) }, { ...q, source: "e".repeat(64) },
    { ...q, image: `sha256:${"e".repeat(64)}` }, { ...q, expiresAt: new Date(0).toISOString() }]) {
    await expect(refreshVerifierQualification(c.isolation, c.control, async () => value)).rejects.toThrow();
    expect(c.isolation.qualification).toBeNull();
  }
  await refreshVerifierQualification(c.isolation, c.control, async () => q);
  expect(verifierExecutionAllowed(c)).toBe(true);
  for (const image of [[], [{ Id: q.image, Os: "windows" }], [{ Id: "wrong", Os: "linux" }],
    [{ Id: q.image, Os: "linux" }, { Id: q.image, Os: "linux" }]]) {
    await expect(refreshVerifierQualification(c.isolation,
      { ...c.control, run: async () => JSON.stringify(image) }, async () => q))
      .rejects.toThrow("image unavailable");
    expect(c.isolation.qualification).toBeNull();
  }
  await expect(refreshVerifierQualification(c.isolation,
    { ...c.control, assertIdentity: async () => { throw Error("daemon changed"); } }, async () => q))
    .rejects.toThrow("daemon changed");
  expect(c.isolation.qualification).toBeNull();
  await expect(readProtectedJson("relative.json")).rejects.toThrow("Protected Linux");
});

test("lost dependencies fence visible and hidden commits and admission requires a live provider", async () => {
  const c = fixture(); c.healthy = () => false;
  expect(verifierExecutionAllowed(c)).toBe(false);
  const fence = createSubmissionFence({ id: "run", daemon: "daemon" }, "token", () => verifierExecutionAllowed(c));
  const db: any = { query: async () => ({ rows: [{ status: "running", token: "token", daemon: "daemon",
    authorized: true, cancelRequested: false }] }) };
  await expect(fence.check(db)).rejects.toThrow("lost");
  const pool: any = { connect: () => { throw Error("Must not open DB"); } };
  await expect(createSubmissionService(pool, c.admission).submit("owner", {})).rejects.toThrow("unavailable");
});

test("availability is checked again before reserving a submission after a lock wait", async () => {
  const f = await submissionFixture(); let checks = 0, inserted = false;
  const db: any = { release() {}, query: async (sql: string) => {
    if (sql.startsWith('SELECT id,"requestHash"')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id,layout')) return { rows: [{ id: f.request.infrastructureId,
      layout: f.layout, updatedAt: new Date(f.request.expectedDesignUpdatedAt) }] };
    if (sql.includes("AS live")) return { rows: [{ recorded: "500", live: "0", runs: "0", cuts: "0", results: "0", replays: "0", physical: "0" }] };
    if (sql.includes("AS queued")) return { rows: [{ queued: 0, owned: 0, bytes: 0 }] };
    if (sql.includes('FROM "FirstStackReplay"')) return { rows: [{ queued: 0, owned: 0 }] };
    if (sql.includes("count(*)")) return { rows: [{ count: 0 }] };
    if (sql.startsWith("INSERT")) inserted = true;
    return { rows: [] };
  } };
  const service = createSubmissionService({ connect: async () => db } as any,
    { enabled: true, engine: f.engine, available: async () => ++checks === 1 });
  await expect(service.submit(f.owner, f.request)).rejects.toThrow("Verification unavailable");
  expect(checks).toBe(2); expect(inserted).toBe(false);
});

test("drain waits for the whole serial job and rejects on deadline without claiming success", async () => {
  let complete!: () => void, expired = false, closed = false;
  const wholeJob = new Promise<void>(resolve => { complete = resolve; });
  const draining = boundedVerifierDrain(wholeJob, () => { expired = true; }, 1000).then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  complete(); await draining; expect(closed).toBe(true); expect(expired).toBe(false);
  await expect(boundedVerifierDrain(new Promise(() => {}), () => { expired = true; }, 1))
    .rejects.toThrow("recovery required");
  expect(expired).toBe(true);
});

test("drain keeps blocking connections alive until every hidden workload has finished", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const loop = new Promise<void>(resolve => { finish = resolve; });
  const drain = drainVerifierWorker({ pause: async immediate => { expect(immediate).toBe(true); events.push("pause"); },
    close: async () => { events.push("disconnect"); } }, loop);
  await Promise.resolve(); expect(events).toEqual(["pause"]);
  events.push("hidden-complete"); finish(); await drain;
  expect(events).toEqual(["pause", "hidden-complete", "disconnect"]);
});
