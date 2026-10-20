import { mkdir, writeFile, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { freemem, totalmem, cpus, platform, release } from "node:os";
import { Pool } from "pg";
import { IsolationConnection } from "../../apps/backend/firstStack/isolationConnection";
import { probeFirstStackContainer, type IsolationAuthority } from "../../apps/backend/firstStack/isolationRunner";
import { FIRST_STACK_ISOLATION as limits, isolationDigest, isolationPolicyHash, qualificationChecks, type HostQualification } from "../../apps/backend/firstStack/isolationPolicy";
import { executionSource } from "../../apps/backend/internalModel2/identity";
import { firstStackCompileFixture } from "../fixtures/first-stack-compile";
import { withFirstStackOwnership } from "../../apps/backend/firstStack/isolationOwnership";
import { topology } from "./topology";
import { stressFixture } from "./fixture";
import { orphanChild, orphanProof } from "./orphan";
import { serialProof } from "./serial";

const arg = (key: string) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3);
if (arg("orphan-child")) { await orphanChild(arg("orphan-child")!); process.exit(0); }
const endpoint = arg("endpoint"), image = arg("image"), postgres = arg("postgres"), redis = arg("redis"), output = arg("output"), target = arg("target");
const full = arg("topology") === "full";
if (!endpoint || !image || full && (!postgres || !redis) || !output || !["laptop-desktop", "ec2-c7i-flex.large", "ci-linux"].includes(target ?? "") ||
  full && (target !== "ec2-c7i-flex.large" || !process.argv.includes("--allow-disposable-topology"))) {
  throw Error("Use --endpoint=LOCAL --image=sha256:ID --target=laptop-desktop|ec2-c7i-flex.large --output=NEW_DIRECTORY. Full EC2 proof additionally requires --topology=full --allow-disposable-topology --postgres=sha256:ID --redis=sha256:ID");
}
// Output is new; never overwrite a previous failed or passing observation.
await mkdir(output, { recursive: false });
const control = await IsolationConnection.open(endpoint), started = Date.now();
const report: any = { schema: "first-stack-host-evidence/1", startedAt: new Date().toISOString(), target,
  policy: limits, policyHash: isolationPolicyHash, image, source: executionSource, daemon: control.identity,
  host: { platform: platform(), kernel: release(), logicalCpus: cpus().length, memoryBytes: totalmem(), freeBytes: freemem() },
  checks: Object.fromEntries(qualificationChecks.map(k => [k, false])), observations: {}, activeEngine: "1", model2Active: false,
  productionTouched: false, scope: "Disposable local topology on the selected host; no cloud API, production database, or existing container is modified" };
const save = () => writeFile(join(output, "evidence.json"), JSON.stringify(report, null, 2) + "\n");
let stack: Awaited<ReturnType<typeof topology>> | undefined, db: Pool | undefined, derivative = "", fixtureContainer = "";
const actor = { assertHeld: async () => {}, commit: async () => {} };
const check = (key: string, passed: boolean, evidence: unknown) => { report.checks[key] = passed; report.observations[key] = evidence; };
async function fixtureImage() {
  const codeHash = isolationDigest(stressFixture), file = resolve(output!, "isolationChild.ts");
  await writeFile(file, stressFixture.replace("FIXTURE_SOURCE", codeHash)); await chmod(file, 0o644);
  fixtureContainer = await control.run(["create", "--pull=never", "--network=none", "--label=infraforge.first-stack-fixture=1", image!, "/bin/true"]);
  await control.run(["cp", file, `${fixtureContainer}:/app/apps/backend/firstStack/isolationChild.ts`]);
  derivative = await control.run(["commit", fixtureContainer], 65536, 30000);
  await control.run(["rm", fixtureContainer]); fixtureContainer = "";
  report.fixture = { image: derivative, baseImage: image, templateHash: codeHash, sourceHash: isolationDigest(stressFixture.replace("FIXTURE_SOURCE", codeHash)),
    identity: "Trusted stress fixture hash, not a release execution identity" };
  return { image: derivative, source: codeHash };
}
async function observe<T>(name: string, work: () => Promise<T>) {
  const samples: any[] = []; let stopped = false;
  const collector = (async () => {
    while (!stopped) {
      const begin = Date.now();
      try {
        const health = await Promise.all([stack!.apiUrl + "/health/live", stack!.apiUrl + "/health/ready", stack!.workerUrl + "/health/ready"].map(async url => {
          const at = Date.now(); const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
          return { ok: response.ok, ms: Date.now() - at };
        }));
        const stats = await control.run(["stats", "--no-stream", "--format", "{{json .}}", ...stack!.ids], 65536, 10000);
        samples.push({ atMs: begin - started, health, hostFreeBytes: freemem(), services: stats.split("\n").filter(Boolean).map(line => {
          const value = JSON.parse(line); return { cpu: value.CPUPerc, memory: value.MemUsage, pids: value.PIDs };
        }) });
      } catch { samples.push({ atMs: begin - started, health: null, hostFreeBytes: freemem(), services: null }); }
      if (!stopped) await Bun.sleep(250);
    }
  })();
  try { return await work(); }
  finally { stopped = true; await collector; report.observations[name + "Samples"] = samples; await save(); }
}
try {
  const info = JSON.parse(await control.run(["info", "--format", "{{json .}}"]));
  report.docker = { version: info.ServerVersion, kernel: info.KernelVersion, cpus: info.NCPU, memoryBytes: info.MemTotal, cgroup: info.CgroupVersion, driver: info.CgroupDriver };
  if (full && (platform() !== "linux" || info.NCPU !== 2 || info.MemTotal < 3.5 * 1024 ** 3 || info.MemTotal > 4.5 * 1024 ** 3 ||
      await control.run(["ps", "--quiet"]))) throw Error("Full EC2 proof requires an idle Linux 2-vCPU/4-GiB host; no live deployment overlap");
  if (!full) {
    await serialProof(control, { image, source: executionSource }, report, output, fixtureImage, save);
  } else {
  stack = await topology(control, image, postgres!, redis!); report.topology = { images: { image, postgres, redis }, limits: stack.configured };
  db = new Pool({ connectionString: stack.databaseUrl, max: 3, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  await db.query("CREATE TABLE first_stack_probe (id text primary key, sequence integer NOT NULL, cut jsonb NOT NULL)");
  const f = await firstStackCompileFixture(8), input = JSON.stringify({ owner: "qualification", layout: f.layout, candidate: f.sidecar, recording: f.schedule, policy: f.policy });
  const configuration = { image, source: executionSource };
  const results: any[] = [];
  const run = (key: string, mutate?: (cut: any) => Promise<void>) => withFirstStackOwnership(stack!.databaseUrl, {
    check: async client => { await client.query("SELECT 1"); },
    commit: async (client, cut) => {
      await client.query("INSERT INTO first_stack_probe VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET sequence=$2,cut=$3 WHERE first_stack_probe.sequence=$2-1", [key, cut.cut.sequence, cut]);
      await mutate?.(cut);
    },
  }, (authority, signal) => probeFirstStackContainer(control, configuration, { mode: "execute", input }, authority, signal));
  const one = await observe("one", () => run("one")); results.push(one);
  check("packaging", one.status === "completed" && one.receipt.cleanup === "removed", { status: one.status, receipt: one.receipt, interruption: one.interruption });
  if (!one.durablePrefix) throw Error("No durable first-stack cut; failed packaging/host gate");
  const replay = await observe("replay", () => withFirstStackOwnership(stack!.databaseUrl, { check: async client => { await client.query("SELECT 1"); }, commit: async () => { throw Error("Replay must not write"); } },
    (authority, signal) => probeFirstStackContainer(control, configuration, { mode: "replay", input, expected: one.durablePrefix! }, authority, signal)));
  check("replay", replay.replay?.kind === "MatchesRecordedPrefix" && (await db.query("SELECT sequence FROM first_stack_probe WHERE id='one'")).rows[0].sequence === one.durablePrefix.cut.sequence, replay);
  report.observations.capacity = "One verifier at a time; browser simulations do not consume this capacity";
  const stress = await fixtureImage();
  for (const kind of ["controls", "pids", "quota", "memory", "output", "cpu", "wall"]) {
    console.info(`First-stack host probe: ${kind}`);
    const value = await observe(kind, () => probeFirstStackContainer(control, stress, { mode: "probe", input: JSON.stringify({ probe: kind }) }, actor));
    report.observations[kind] = value;
    if (kind === "controls") check("fds", value.status === "completed" && value.probe?.fdDenied && value.probe.readonly && value.probe.files < 128, value);
    if (kind === "pids") check("pids", value.status === "completed" && value.probe?.denied && value.probe.count > 0 && value.probe.count < 64, value);
    if (kind === "quota") check("cpuQuota", value.status === "completed" && value.probe?.after.nr_throttled > value.probe?.before.nr_throttled &&
      value.probe.after.throttled_usec > value.probe.before.throttled_usec, value);
    if (kind === "memory") check("memory", value.status === "interrupted" && value.receipt.exit?.oom === true, value);
    if (kind === "output") check("output", value.status === "interrupted" && /budget/.test(value.interruption?.reason ?? "") && value.receipt.cleanup === "removed", value);
    if (kind === "cpu") check("cpuTime", value.status === "interrupted" && value.receipt.exit?.code === 137 && value.receipt.exit.oom === false && value.receipt.elapsedMs < 59000, value);
    if (kind === "wall") check("wall", value.status === "interrupted" && value.receipt.elapsedMs >= 59000 && value.receipt.elapsedMs < 75000, value);
    await save();
  }
  for (const kind of ["cancellation", "revocation"]) {
    let committed: any = null, held = true;
    const abort = new AbortController();
    const authority: IsolationAuthority = { assertHeld: async () => { if (!held) throw Error(kind); await db!.query("SELECT 1"); },
      commit: async cut => {
        await db!.query("INSERT INTO first_stack_probe VALUES ($1,$2,$3)", [kind, cut.cut.sequence, cut]); committed = cut;
        if (kind === "cancellation") abort.abort(Error("cancelled"));
        else held = false;
      } };
    const result = await probeFirstStackContainer(control, configuration, { mode: "execute", input }, authority, abort.signal);
    const stored = (await db.query("SELECT cut FROM first_stack_probe WHERE id=$1", [kind])).rows[0]?.cut;
    check(kind, result.status === "interrupted" && committed?.fingerprint === stored?.fingerprint && stored?.cut.sequence === 1 && result.receipt.cleanup === "removed",
      { result, storedFingerprint: stored?.fingerprint ?? null });
  }
  let victim = 0, terminate = false;
  const databaseLoss = await withFirstStackOwnership(stack.databaseUrl, {
    check: async client => {
      if (terminate) { terminate = false; await db!.query("SELECT pg_terminate_backend($1)", [victim]); }
      await client.query("SELECT 1");
    },
    commit: async (client, cut) => {
      victim = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await client.query("INSERT INTO first_stack_probe VALUES ('databaseLoss',$1,$2)", [cut.cut.sequence, cut]);
    },
  }, (authority, signal) => probeFirstStackContainer(control, configuration, { mode: "execute", input }, {
    assertHeld: authority.assertHeld,
    commit: async (cut, abort) => { await authority.commit(cut, abort); terminate = true; },
  }, signal));
  const retained = (await db.query("SELECT cut FROM first_stack_probe WHERE id='databaseLoss'")).rows[0]?.cut;
  check("databaseLoss", databaseLoss.status === "interrupted" && retained?.cut.sequence === 1 && databaseLoss.receipt.cleanup === "removed",
    { result: databaseLoss, retainedFingerprint: retained?.fingerprint ?? null, method: "Terminated the actual dedicated lock-holding PostgreSQL session after commit" });
  // Keep an actual executor occupied while a second caller attempts the atomic
  // reservation. It must neither attach nor remove the occupied container.
  const cancel = new AbortController(); let occupied!: () => void;
  const barrier = new Promise<void>(yes => { occupied = yes; });
  const heldRun = probeFirstStackContainer(control, configuration, { mode: "execute", input }, {
    assertHeld: async () => {}, commit: async () => { occupied(); await new Promise<void>(() => {}); },
  }, cancel.signal);
  try {
    await Promise.race([barrier, heldRun.then(() => { throw Error("Occupied executor ended before its durable cut"); })]);
    const duplicate = await probeFirstStackContainer(control, configuration, { mode: "replay", input, expected: one.durablePrefix! }, actor);
    cancel.abort(); const heldResult = await heldRun;
    check("exclusive", duplicate.status === "interrupted" && duplicate.receipt.container === null && duplicate.receipt.cleanup === "unconfirmed" && heldResult.receipt.cleanup === "removed", { duplicate, held: heldResult });
  } finally { cancel.abort(); await heldRun; }
  const orphan = await observe("workerDeath", () => orphanProof(control, configuration, input, output));
  check("workerDeath", orphan.passed, orphan);
  const allSamples = Object.entries(report.observations).filter(([k]) => k.endsWith("Samples")).flatMap(([, v]) => v as any[]);
  check("apiResponsive", allSamples.length > 0 && allSamples.every(s => s.health?.every((h: any) => h.ok && h.ms < 3000)), { samples: allSamples.length,
    maxMs: Math.max(...allSamples.flatMap(s => s.health?.map((h: any) => h.ms) ?? [Infinity])) });
  check("headroom", allSamples.length > 0 && allSamples.every(s => s.hostFreeBytes >= 512 * 1024 * 1024) && one.status === "completed",
    { minimumHostFreeBytes: Math.min(...allSamples.map(s => s.hostFreeBytes)), capacity: 1,
      daemonOverhead: "Included in whole-host available memory; not separately attributed. Docker Desktop VM and Windows measurements are distinct.",
      limits: "Proof topology <= 1.75 CPUs / 2688 MiB with one verifier; capacity remains one" });
  }
} catch (error) {
  report.failure = error instanceof Error ? error.message : "Qualification failed";
} finally {
  await db?.end();
  if (fixtureContainer) await control.run(["rm", "--force", fixtureContainer]);
  if (derivative) await control.run(["image", "rm", derivative]);
  await stack?.close();
  await control.close();
  report.finishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started;
  const passed = full && qualificationChecks.every(key => report.checks[key] === true) && !report.failure;
  const qualification: HostQualification = { schema: "first-stack-host/1", target: target as HostQualification["target"],
    image, source: executionSource, daemon: report.daemon, policy: isolationPolicyHash, capacity: 1, qualified: passed,
    checkedAt: report.finishedAt, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), checks: report.checks };
  const containmentPassed = qualificationChecks.filter(key => !["databaseLoss", "apiResponsive", "headroom"].includes(key)).every(key => report.checks[key] === true) && !report.failure;
  report.containmentPassed = containmentPassed;
  await save(); await writeFile(join(output, "qualification.json"), JSON.stringify(qualification, null, 2) + "\n");
  console.info(JSON.stringify({ output, qualified: passed, containmentPassed, checks: report.checks, failure: report.failure ?? null }));
  process.exitCode = passed || !full && process.argv.includes("--containment-only") && containmentPassed ? 0 : 1;
}
