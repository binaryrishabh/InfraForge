import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runFirstStackContainer } from "../firstStack/isolationRunner";
import { boundedLines, inputDigest, isolatedCut } from "../firstStack/isolationProtocol";
import { FIRST_STACK_ISOLATION as limits, assertQualified, isolationPolicyHash, qualificationChecks, type HostQualification } from "../firstStack/isolationPolicy";
import { firstStackContainerArguments, verifyFirstStackContainer } from "../firstStack/isolationContainer";

// Software supervision fixtures. These invented kernel values are deliberately
// never emitted by the actual-host producer or accepted as measured evidence.
function fixture() {
  const image = `sha256:${"a".repeat(64)}`, source = "b".repeat(64), daemon = "c".repeat(64);
  const qualification: HostQualification = { schema: "first-stack-host/1", target: "laptop-desktop", image, source, daemon,
    policy: isolationPolicyHash, capacity: 1, qualified: true, checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(), checks: Object.fromEntries(qualificationChecks.map(k => [k, true])) as HostQualification["checks"] };
  const child: any = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => true;
  let removed = 0, creates = 0, busy = false, attached!: () => void;
  const ready = new Promise<void>(yes => { attached = yes; });
  const value: any = { Id: "d".repeat(64), Image: image, Name: "/infraforge-first-stack-executor",
    Config: { User: "1000:1000", Labels: {}, Env: ["HOME=/tmp"], Entrypoint: ["timeout"], WorkingDir: "/app/apps/backend" }, Mounts: [],
    State: { Running: true, ExitCode: 0, OOMKilled: false }, HostConfig: {
      Memory: limits.memoryBytes, MemorySwap: limits.memoryBytes, NanoCpus: limits.nanoCpus, PidsLimit: limits.pids,
      NetworkMode: "none", CgroupnsMode: "private", ReadonlyRootfs: true, Init: true, CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges=true"], LogConfig: { Type: "none" }, Tmpfs: { "/tmp": `rw,noexec,nosuid,nodev,size=${limits.tmpBytes}` },
      Ulimits: [{ Name: "nofile", Soft: 128, Hard: 128 }, { Name: "cpu", Soft: 20, Hard: 20 }, { Name: "core", Soft: 0, Hard: 0 }],
    } };
  const control: any = { identity: daemon, assertIdentity: async () => {}, run: async (args: string[]) => {
    if (args[0] === "create") {
      creates++;
      if (busy) throw Error("name reserved");
      busy = true; value.Config.Labels["infraforge.first-stack"] = args[args.indexOf("--label") + 1]!.split("=")[1];
      value.Config.Cmd = args.slice(-7); return value.Id;
    }
    if (args[0] === "inspect") return JSON.stringify([value]);
    if (args[0] === "rm") { removed++; busy = false; return ""; }
    throw Error("Unexpected Docker command");
  }, attach: async () => { attached(); return child; } };
  const send = (v: unknown) => child.stdout.write(JSON.stringify(v) + "\n");
  const handshake = () => send({ kind: "ready", source, enforcement: { memory: String(limits.memoryBytes), swap: "0", pids: "64",
    uid: 1000, gid: 1000, cpu: "50000 100000", limits: "Max cpu time 20 20 seconds\nMax open files 128 128",
    status: "NoNewPrivs:\t1\nCapEff:\t0000000000000000\n" } });
  const authority = { assertHeld: async () => {}, commit: async () => {} };
  return { control, value, child, ready, handshake, send, authority, config: { image, source, qualification },
    get removed() { return removed; }, get creates() { return creates; } };
}

test("missing, failed, stale, changed-host and capacity-two qualifications refuse before create", async () => {
  for (const mutate of [
    (q: any) => { q.qualified = false; }, (q: any) => { q.checks.memory = false; },
    (q: any) => { q.expiresAt = "invalid"; }, (q: any) => { q.capacity = 2; }, (q: any) => { q.daemon = "0".repeat(64); },
  ]) {
    const f = fixture(); mutate(f.config.qualification);
    await expect(runFirstStackContainer(f.control, f.config, { mode: "execute", input: "{}" }, f.authority)).rejects.toThrow("disabled");
    expect(f.creates).toBe(0);
  }
  expect(() => assertQualified(null, { image: "", source: "", daemon: "" })).toThrow("disabled");
});
test("atomic create conflict never removes or attaches the other executor", async () => {
  const f = fixture(), stop = new AbortController();
  const first = runFirstStackContainer(f.control, f.config, { mode: "execute", input: "{}" }, f.authority, stop.signal);
  await f.ready;
  const second = await runFirstStackContainer(f.control, f.config, { mode: "execute", input: "{}" }, f.authority);
  expect(second.status).toBe("interrupted"); expect(second.receipt.cleanup).toBe("unconfirmed"); expect(f.removed).toBe(0);
  stop.abort(); expect((await first).receipt.cleanup).toBe("removed");
});
test("cancellation breaks a silent pipe without close and database loss breaks hung authority", async () => {
  const f = fixture(), stop = new AbortController();
  const run = runFirstStackContainer(f.control, f.config, { mode: "execute", input: "{}" }, f.authority, stop.signal);
  await f.ready; stop.abort();
  expect((await run).status).toBe("interrupted"); expect(f.removed).toBe(1);
  const g = fixture(); let held = true;
  g.authority.assertHeld = async () => { if (!held) throw Error("Database ownership lost"); };
  const lost = runFirstStackContainer(g.control, g.config, { mode: "execute", input: "{}" }, g.authority);
  await g.ready; held = false;
  expect((await lost).interruption).toMatchObject({ classification: "executor-interrupted", reason: "Database ownership lost" });
}, 3000);
test("OOM state is authoritative without EOF; zero exit without done is never success", async () => {
  const f = fixture();
  const run = runFirstStackContainer(f.control, f.config, { mode: "execute", input: "{}" }, f.authority);
  await f.ready; f.value.State = { Running: false, ExitCode: 137, OOMKilled: true };
  const result = await run; expect(result.status).toBe("interrupted"); expect(result.receipt.exit?.oom).toBe(true);
  const g = fixture();
  const missing = runFirstStackContainer(g.control, g.config, { mode: "execute", input: "{}" }, g.authority);
  await g.ready; await Bun.sleep(10); g.handshake(); g.child.stdout.end(); g.value.State.Running = false; g.child.emit("close", 0);
  expect((await missing).status).toBe("interrupted");
}, 3000);
test("inspect rejects unbounded memory, writable mounts, changed command and image credentials", () => {
  const f = fixture(), token = "00000000-0000-4000-8000-000000000000";
  f.value.Config.Labels["infraforge.first-stack"] = token;
  f.value.Config.Cmd = firstStackContainerArguments(f.config.image, token).slice(-7);
  verifyFirstStackContainer(f.value, f.config.image, token);
  for (const mutate of [
    (v: any) => { v.HostConfig.Memory = 0; }, (v: any) => { v.Mounts = [{ Type: "bind" }]; },
    (v: any) => { v.Config.Cmd = ["sleep", "infinity"]; }, (v: any) => { v.Config.Env = ["DATABASE_URL=fixture"]; },
  ]) { const v = structuredClone(f.value); mutate(v); expect(() => verifyFirstStackContainer(v, f.config.image, token)).toThrow("inspection"); }
});
test("stream framing bounds unfinished lines, total bytes, frame count and trailing fragments", async () => {
  for (const chunks of [[Buffer.alloc(9)], [Buffer.from("1234\n1234\n")], [Buffer.from("\n\n\n")], [Buffer.from("unfinished")]]) {
    const work = async () => { for await (const _line of boundedLines((async function* () { yield* chunks; })(), 8, 9, 2)) { /* consume */ } };
    await expect(work()).rejects.toThrow();
  }
});
test("persistence failure and revocation retain the acknowledged prefix without another ACK", async () => {
  for (const mode of ["persistence", "revocation"]) {
    const f = fixture(); let commits = 0, held = true, writes = "";
    f.child.stdin.on("data", (chunk: Buffer) => { writes += chunk.toString(); });
    const cut = (sequence: number) => isolatedCut({
      schema: "first-stack-cut/1", sequence, throughUs: sequence, envelope: "first-stack-envelope/1",
      effectiveLimits: { wallMs: 60000, cpuUs: 20000000, rssBytes: 536870912, frameBytes: 1048576, summaryBytes: 10485760, captureBytes: 33554432 },
      lock: {} as any, timestampComplete: false, unfinished: { notYetOffered: 1, callers: 0, pendingEvents: 1 },
      counts: {}, execution: { processed: sequence, pending: 1, cancelled: 0, peakPending: 1 },
      completeness: { horizonReached: false, allRootsTerminal: false, aggregates: "observed-prefix", usage: "prefix-only", journalComplete: true },
      distributions: null, omissions: { raw: 0, samples: 0, journal: 0 }, interruption: null,
    }, f.config.source, inputDigest("{}"));
    const run = runFirstStackContainer(f.control, f.config, { mode: "execute", input: "{}" }, {
      assertHeld: async () => { if (!held) throw Error("revoked"); },
      commit: async () => { commits++; if (mode === "revocation") held = false; else if (commits === 2) throw Error("database unavailable"); },
    });
    await f.ready; await Bun.sleep(10); f.handshake(); f.send({ kind: "cut", value: cut(1) });
    if (mode === "persistence") f.send({ kind: "cut", value: cut(2) });
    const result = await run;
    expect(result.status).toBe("interrupted"); expect(result.durablePrefix?.cut.sequence).toBe(1);
    expect(result.summary).toBeNull(); expect(result.receipt.cleanup).toBe("removed");
    expect(writes.split("\n").filter(line => line.includes('"kind":"ack"')).length).toBe(mode === "persistence" ? 1 : 0);
  }
});
