import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { hash } from "../firstStack/canonical";
import { qualificationChecks, isolationPolicyHash, assertQualified } from "../firstStack/isolationPolicy";
import { readQualificationBaseline, readQualificationCanary, selfCheckIntervalMs, selfCheckLeaseMs, type QualificationBaseline } from "../firstStack/qualificationBaseline";
import { createLiveQualification } from "../firstStack/verifierQualification";
import { createHostFingerprintReader, type FingerprintHost } from "../firstStack/qualificationFingerprint";
import { renewBetweenJobs } from "../firstStack/verifierRenewal";
import type { IsolationConfiguration } from "../firstStack/isolationRunner";
import { submissionFixture } from "./submissionFixture";
import { assertVerifierProductionResponsive } from "../firstStack/verifierProductionProbe";
import { assertIsolationSelfCheck } from "../firstStack/isolationSelfCheck";
import { inputDigest } from "../firstStack/isolationProtocol";

function fixture() {
  let now = Date.now(), fingerprint = "d".repeat(64), canaryFailed = false, headroom = true;
  const baseline: QualificationBaseline = { schema: "first-stack-baseline/2", target: "ec2-c7i-flex.large",
    image: `sha256:${"b".repeat(64)}`, source: "a".repeat(64), daemon: "c".repeat(64),
    policy: isolationPolicyHash, checkedAt: new Date(now - 30 * 86400000).toISOString(),
    fingerprint, canary: "e".repeat(64), capacity: 1, qualified: true,
    checks: Object.fromEntries(qualificationChecks.map(key => [key, true])) as QualificationBaseline["checks"] };
  const configuration: IsolationConfiguration = { image: baseline.image, source: baseline.source, qualification: null };
  const control = { identity: baseline.daemon, assertIdentity: async () => {},
    run: async (_args: string[]) => JSON.stringify([{ Id: baseline.image, Os: "linux" }]), attach: async () => { throw Error("No Docker"); } };
  const dependencies = { load: async () => baseline as unknown, fingerprint: async () => fingerprint,
    now: () => now, headroom: () => { if (!headroom) throw Error("headroom"); },
    canary: async () => { if (canaryFailed) throw Error("canary failed"); } };
  return { baseline, control, configuration, dependencies,
    live: createLiveQualification(configuration, control, dependencies),
    time: (value: number) => { now = value; }, drift: () => { fingerprint = "f".repeat(64); },
    fail: () => { canaryFailed = true; }, lowMemory: () => { headroom = false; }, now };
}

test("old full evidence is reusable only through a fresh short live lease", async () => {
  const f = fixture();
  expect(readQualificationBaseline(f.baseline, f.baseline, f.baseline.fingerprint)).toEqual(f.baseline);
  expect(() => assertQualified(f.baseline as any, f.baseline)).toThrow();
  await f.live.renew();
  expect(f.configuration.qualification).not.toBeNull();
  expect(f.live.due()).toBe(false);
  f.time(f.now + selfCheckIntervalMs); expect(f.live.due()).toBe(true);
  const expires = f.configuration.qualification!.expiresAt;
  await f.live.refresh(); expect(f.configuration.qualification!.expiresAt).toBe(expires);
  f.time(f.now + selfCheckLeaseMs);
  await expect(f.live.refresh()).rejects.toThrow("expired");
  expect(f.configuration.qualification).toBeNull();
});

test("every retained behavior and identity gate remains mandatory", () => {
  const f = fixture(), read = (value: unknown) => readQualificationBaseline(value, f.baseline, f.baseline.fingerprint);
  for (const key of qualificationChecks) {
    expect(() => read({ ...f.baseline, checks: { ...f.baseline.checks, [key]: false } })).toThrow();
    const checks = { ...f.baseline.checks }; delete (checks as any)[key];
    expect(() => read({ ...f.baseline, checks })).toThrow();
  }
  for (const change of [{ schema: "first-stack-host/1" }, { target: "ci-linux" }, { qualified: false },
    { capacity: 2 }, { policy: "0".repeat(64) }, { fingerprint: "0".repeat(64) },
    { image: `sha256:${"0".repeat(64)}` }, { source: "0".repeat(64) }, { daemon: "0".repeat(64) },
    { checkedAt: new Date(Date.now() + 60000).toISOString() }, { expiresAt: "extended" }]) {
    expect(() => read({ ...f.baseline, ...change })).toThrow();
  }
});

test("startup needs a canary, and failures latch closed even after inputs are restored", async () => {
  const fresh = fixture(); await expect(fresh.live.refresh()).rejects.toThrow("missing");
  for (const cause of ["drift", "canary", "memory", "record", "clock"] as const) {
    const f = fixture(); await f.live.renew();
    if (cause === "drift") f.drift();
    if (cause === "canary") f.fail();
    if (cause === "memory") f.lowMemory();
    if (cause === "record") f.baseline.canary = "0".repeat(64);
    if (cause === "clock") f.time(f.now - 1);
    await expect(cause === "canary" ? f.live.renew() : f.live.refresh()).rejects.toThrow();
    expect(f.configuration.qualification).toBeNull();
    f.dependencies.fingerprint = async () => f.baseline.fingerprint;
    f.dependencies.headroom = () => {}; f.dependencies.canary = async () => {}; f.time(f.now);
    await expect(f.live.renew()).rejects.toThrow("operator restart");
  }
});

test("drift or revocation during a successful canary cannot publish a lease", async () => {
  for (const changed of [false, true]) {
    const f = fixture(); f.dependencies.canary = async () => { if (changed) f.drift(); else f.live.revoke(); };
    await expect(f.live.renew()).rejects.toThrow();
    expect(f.configuration.qualification).toBeNull();
  }
  const f = fixture(); let release!: () => void;
  f.dependencies.canary = () => new Promise<void>(yes => { release = yes; });
  const pending = f.live.renew();
  await Bun.sleep(1);
  await expect(f.live.renew()).rejects.toThrow("already running");
  release(); await pending;
});

test("canary data is pinned to the full rehearsal and a completed exact-source cut", async () => {
  const f = fixture(), run = await submissionFixture();
  const canary = { input: run.input, expected: run.request.browserCut };
  f.baseline.canary = hash(canary);
  expect(readQualificationCanary(canary, f.baseline).expected).toEqual(canary.expected);
  for (const changed of [{ ...canary, input: "{}" }, { ...canary, expected: { ...canary.expected, source: "0".repeat(64) } },
    { input: canary.input + " ", expected: { ...canary.expected, inputHash: inputDigest(canary.input + " ") } },
    { ...canary, extra: true }]) expect(() => readQualificationCanary(changed, f.baseline)).toThrow();
  const incomplete = structuredClone(canary); incomplete.expected.cut.completeness.horizonReached = false;
  // Independently authenticate the changed record to exercise the cut/horizon guard.
  const { cutFingerprint } = await import("../firstStack/isolationProtocol");
  incomplete.expected.fingerprint = cutFingerprint(incomplete.expected.cut); f.baseline.canary = hash(incomplete);
  expect(() => readQualificationCanary(incomplete, f.baseline)).toThrow("horizon");
});

test("renewal drains the whole job, never resumes on failure, and honors shutdown", async () => {
  for (const failure of [false, true]) {
    const events: string[] = []; let finish!: () => void;
    const drained = new Promise<void>(yes => { finish = yes; });
    const work = renewBetweenJobs({ pause: async () => { events.push("pause"); }, getActiveCount: async () => { await drained; return 0; },
      resume: async () => { events.push("resume"); } }, async () => { events.push("canary"); if (failure) throw Error("failed"); }, () => false);
    await Promise.resolve(); expect(events).toEqual(["pause"]); finish();
    if (failure) await expect(work).rejects.toThrow("failed"); else await work;
    expect(events).toEqual(failure ? ["pause", "canary"] : ["pause", "canary", "resume"]);
  }
  let stopping = true, probes = 0, resumes = 0;
  const worker = { pause: async () => {}, getActiveCount: async () => 0, resume: async () => { resumes++; } };
  await renewBetweenJobs(worker, async () => { probes++; }, () => stopping);
  expect(probes).toBe(0); expect(resumes).toBe(0);
  stopping = false;
  await renewBetweenJobs(worker, async () => { probes++; stopping = true; }, () => stopping);
  expect(probes).toBe(1); expect(resumes).toBe(0);
  for (const count of [-1, 2, NaN]) {
    let deadline = false;
    const timer = setTimeout(() => { deadline = true; }, 5);
    try {
      await expect(renewBetweenJobs({ ...worker, getActiveCount: async () => count }, async () => {}, () => deadline))
        .rejects.toThrow("capacity Unknown");
    } finally { clearTimeout(timer); }
  }
});

// Invented Linux facts exercise collection only. They are never host evidence.
function hostFixture() {
  const f = fixture(), content = new Map<string, string>(), stamps = new Map<string, bigint>();
  const info: any = { OSType: "linux", CgroupVersion: "2", CgroupDriver: "systemd",
    SecurityOptions: ["name=rootless"], NCPU: 2, MemTotal: 4 * 1024 ** 3,
    KernelVersion: "fixture", Architecture: "x86_64", DockerRootDir: "/fixture",
    Runtimes: { runc: { path: "runc" } }, DefaultRuntime: "runc", Driver: "overlay2" };
  const version = { Version: "fixture", Components: [{ Name: "runc", Version: "fixture" }] };
  content.set("/sys/devices/virtual/dmi/id/product_name", "c7i-flex.large");
  content.set("/proc/stat", "btime 1000\n");
  content.set("/proc/42/comm", "dockerd"); content.set("/proc/42/cmdline", "dockerd\0--config-file=/etc/infraforge/verifier/daemon.json\0");
  for (const [pid, name, parent] of [["41", "rootlesskit", "1"], ["42", "dockerd", "41"], ["43", "containerd", "42"]]) {
    content.set(`/proc/${pid}/comm`, name!);
    const fields = Array(20).fill("1"); fields[1] = parent;
    content.set(`/proc/${pid}/stat`, `${pid} (${name}) ${fields.join(" ")}`);
    content.set(`/proc/${pid}/environ`, "PATH=/usr/bin:/bin\0");
  }
  content.set("/proc/43/cmdline", "containerd\0--config\0/run/user/1001/docker/containerd/containerd.toml\0");
  content.set("/run/user/1001/docker/containerd/containerd.toml", "version = 2\n");
  const managerGroup = "/user.slice/user-1001.slice/user@1001.service";
  const supervisorGroup = "/system.slice/first-stack-verifier.service";
  content.set("/proc/42/cgroup", `0::${managerGroup}/app.slice/docker.service`);
  content.set("/proc/self/cgroup", `0::${supervisorGroup}`);
  content.set("/proc/self/status", "NoNewPrivs:\t1\nCapEff:\t00000000\n");
  content.set("/proc/self/limits", "Max open files 512 512 files\n");
  content.set("/etc/infraforge/verifier/daemon.json", '{"cgroup-parent":"user.slice","init-path":"/usr/bin/docker-init"}');
  const supervisor: Record<string, string> = { ControlGroup: supervisorGroup, User: "infraforge-verifier", Group: "infraforge-verifier",
    MemoryMax: "536870912", MemorySwapMax: "0", TasksMax: "128", CPUQuotaPerSecUSec: "150ms", CPUQuotaPeriodUSec: "100ms",
    LimitNOFILE: "512", LimitNOFILESoft: "512", NoNewPrivileges: "yes", ProtectSystem: "strict", ProtectHome: "tmpfs",
    PrivateTmp: "yes", PrivateDevices: "yes", RestrictSUIDSGID: "yes", CapabilityBoundingSet: "", KillMode: "control-group", UMask: "0077",
    RestrictAddressFamilies: "AF_UNIX AF_INET AF_INET6", BindReadOnlyPaths: "/run/user/1001/docker.sock" };
  const manager: Record<string, string> = { ControlGroup: managerGroup };
  for (const group of ["/user.slice", "/user.slice/user-1001.slice", managerGroup,
    `${managerGroup}/app.slice`, `${managerGroup}/app.slice/docker.service`, `${managerGroup}/user.slice`, "/system.slice", supervisorGroup]) {
    for (const [key, value] of Object.entries({ "cpu.max": "max 100000", "memory.max": "max", "memory.swap.max": "max",
      "pids.max": "max", "cpuset.cpus.effective": "0-1", "cpuset.mems.effective": "0", "memory.high": "max",
      "memory.low": "0", "memory.min": "0", "memory.oom.group": "0", "cpu.weight": "100",
      "cgroup.controllers": "cpu memory pids cpuset", "cgroup.subtree_control": "cpu memory pids cpuset" })) {
      content.set(`/sys/fs/cgroup${group}/${key}`, value);
    }
  }
  for (const [key, value] of Object.entries({ "cpu.max": "15000 100000", "memory.max": "536870912", "memory.swap.max": "0", "pids.max": "128" })) {
    content.set(`/sys/fs/cgroup${supervisorGroup}/${key}`, value);
  }
  for (const [name, value] of Object.entries({ "vm/panic_on_oom": "0", "vm/oom_kill_allocating_task": "0",
    "vm/overcommit_memory": "0", "vm/overcommit_ratio": "50", "vm/overcommit_kbytes": "0",
    "vm/min_free_kbytes": "65536", "vm/swappiness": "60", "kernel/sched_cfs_bandwidth_slice_us": "5000",
    "kernel/threads-max": "30000", "kernel/pid_max": "4194304", "fs/file-max": "1000000", "fs/nr_open": "1048576" })) {
    content.set(`/proc/sys/${name}`, value);
  }
  const resolve = (path: string) => {
    const processes: Record<string, string> = { "41": "rootlesskit", "42": "dockerd", "43": "containerd" };
    const executable = path.match(/^\/proc\/(41|42|43)\/exe$/);
    if (executable) return `/usr/bin/${processes[executable[1]!]}`;
    if (path === "/proc/43/cwd") return "/usr/bin";
    return path.replace(/^\/proc\/\d+\/root/, "").replace(/^\/bin(?=\/|$)/, "/usr/bin");
  };
  const directories = ["/usr", "/usr/bin"];
  for (const name of ["bun", "docker", "dockerd", "containerd", "runc", "rootlesskit", "containerd-shim-runc-v2", "docker-init"]) content.set(`/usr/bin/${name}`, `fixture-${name}`);
  const host: FingerprintHost = { platform: "linux", uid: 1001, executable: "/usr/bin/bun",
    read: async path => {
      path = resolve(path);
      if (!content.has(path) && (path.startsWith("/sys/fs/cgroup/") || path.startsWith("/proc/sys/") || path.startsWith("/usr/bin/"))) throw Error("Missing host fact");
      return Buffer.from(content.get(path) ?? "fixture");
    }, realpath: async path => resolve(path),
    statTarget: path => host.stat(resolve(path)),
    systemd: async unit => Object.entries(unit === "supervisor" ? supervisor : manager).map(([k, v]) => `${k}=${v}`).join("\n"),
    list: async () => ["41", "42", "43"], which: name => `/usr/bin/${name}`, cpuModels: () => ["fixture", "fixture"], memory: () => 4 * 1024 ** 3,
    stat: async path => {
      if (path.startsWith("/usr/bin/") && !content.has(path)) throw Object.assign(Error("Missing executable"), { code: "ENOENT" });
      return { isFile: () => !directories.includes(path), isDirectory: () => directories.includes(path), uid: /^\/proc\/(41|42|43)$/.test(path) ? BigInt(1001) : BigInt(0),
        size: BigInt(10), mode: directories.includes(path) ? BigInt(0o40755) : path.startsWith("/usr/bin/") ? BigInt(0o100755) : BigInt(0o100644),
        ctimeNs: stamps.get(path) ?? BigInt(1), mtimeNs: BigInt(1), ino: BigInt(1), dev: BigInt(1) } as any;
    } };
  f.control.run = async args => JSON.stringify(args[0] === "info" ? info : args[0] === "image"
    ? [{ Id: f.baseline.image, Os: "linux" }] : version);
  content.set("/proc/sys/kernel/random/boot_id", "fixture");
  return { ...f, host, info, version, content, stamps, supervisor, manager, managerGroup, supervisorGroup,
    read: createHostFingerprintReader(f.control, host) };
}

test("fingerprint observes reboot, kernel, runtime, binary, packages, daemon config and delegated limits", async () => {
  for (const path of ["/proc/sys/kernel/random/boot_id", "/proc/version", "/proc/42/stat",
    "/etc/systemd/system/first-stack-verifier.service",
    "/var/lib/dpkg/status", "/usr/bin/bun", "/usr/bin/docker", "/usr/bin/dockerd", "/usr/bin/containerd", "/usr/bin/runc", "/usr/bin/rootlesskit", "/usr/bin/containerd-shim-runc-v2", "/usr/bin/docker-init",
    "/sys/fs/cgroup/user.slice/cpu.weight"]) {
    const f = hostFixture(), before = await f.read();
    expect((await f.read()).fingerprint).toBe(before.fingerprint);
    f.content.set(path, path === "/proc/42/stat" ? f.content.get(path)!.replace(/1$/, "2") : path.endsWith("cpu.weight") ? "200" : "changed"); f.stamps.set(path, BigInt(2));
    expect((await f.read()).fingerprint).not.toBe(before.fingerprint);
  }
  const f = hostFixture(), before = await f.read(); f.version.Components[0]!.Version = "changed";
  expect((await f.read()).fingerprint).not.toBe(before.fingerprint);
});

test("unknown or unsupported host and daemon facts fail closed", async () => {
  for (const change of [{ OSType: "windows" }, { CgroupVersion: "1" }, { CgroupDriver: "cgroupfs" },
    { SecurityOptions: [] }, { NCPU: 4 }, { MemTotal: 0 }, { MemTotal: 8 * 1024 ** 3 },
    { Runtimes: null }, { DefaultRuntime: "other" }, { Driver: "other" },
    { KernelVersion: undefined }, { Architecture: undefined }, { DockerRootDir: undefined }]) {
    const f = hostFixture(); Object.assign(f.info, change); await expect(f.read()).rejects.toThrow();
  }
  for (const change of ["platform", "machine", "daemon", "command", "binary", "permissions", "cgroup", "read"] as const) {
    const f = hostFixture();
    if (change === "platform") f.host.platform = "win32";
    if (change === "machine") f.content.set("/sys/devices/virtual/dmi/id/product_name", "other");
    if (change === "daemon") f.host.list = async () => [];
    if (change === "command") f.content.set("/proc/42/cmdline", "dockerd");
    if (change === "binary") f.host.which = () => null;
    if (change === "permissions") { const stat = f.host.stat; f.host.stat = async path => ({ ...await stat(path), mode: BigInt(0o100666) }) as any; }
    if (change === "cgroup") f.content.set("/proc/42/cgroup", "0::/../outside");
    if (change === "read") f.host.read = async () => { throw Error("unreadable"); };
    await expect(f.read()).rejects.toThrow();
  }
  for (const change of [{ uid: BigInt(1001) }, { size: BigInt(257) * BigInt(1024) * BigInt(1024) }, { isFile: () => false }]) {
    const f = hostFixture(), stat = f.host.stat;
    f.host.stat = async path => ({ ...await stat(path), ...change }) as any;
    await expect(f.read()).rejects.toThrow("identity file");
  }
  const moving = hostFixture(), stat = moving.host.stat; let reads = 0;
  moving.host.stat = async path => ({ ...await stat(path), ctimeNs: BigInt(++reads) });
  await expect(moving.read()).rejects.toThrow("during observation");
  const malformed = hostFixture(); malformed.content.set("/proc/42/stat", "Unknown");
  await expect(malformed.read()).rejects.toThrow("start identity Unknown");
  const component = hostFixture(); component.version.Components[0]!.Version = "";
  await expect(component.read()).rejects.toThrow("Runtime identity Unknown");
});

test("live OOM changes and unknown kernel policies cannot retain a lease", async () => {
  for (const value of ["2", "1", "", "Unknown", "-1"]) {
    const f = hostFixture();
    f.dependencies.fingerprint = async () => (await f.read()).fingerprint;
    f.baseline.fingerprint = (await f.read()).fingerprint;
    await f.live.renew();
    f.content.set("/proc/sys/vm/panic_on_oom", value);
    await expect(f.live.refresh()).rejects.toThrow();
    expect(f.configuration.qualification).toBeNull();
    f.content.set("/proc/sys/vm/panic_on_oom", "0");
    await expect(f.live.renew()).rejects.toThrow();
  }
  const reference = hostFixture();
  for (const [path, value] of reference.content) {
    if (!path.startsWith("/proc/sys/") || path.endsWith("boot_id")) continue;
    const f = hostFixture(), before = await f.read();
    f.content.set(path, ""); await expect(f.read()).rejects.toThrow();
    f.content.set(path, String(Number(value) + 1));
    if (path.endsWith("panic_on_oom") || path.endsWith("oom_kill_allocating_task")) await expect(f.read()).rejects.toThrow();
    else expect((await f.read()).fingerprint).not.toBe(before.fingerprint);
  }
});

test("effective supervisor and separate executor ancestry are mandatory live evidence", async () => {
  const reference = hostFixture();
  for (const group of [reference.supervisorGroup, `${reference.managerGroup}/user.slice`, "/system.slice"]) {
    for (const name of ["cpu.max", "memory.max", "memory.swap.max", "pids.max", "memory.high", "memory.oom.group", "cpuset.cpus.effective"]) {
      const f = hostFixture(), path = `/sys/fs/cgroup${group}/${name}`, before = await f.read();
      f.content.delete(path); await expect(f.read()).rejects.toThrow();
      f.content.set(path, name === "cpu.max" ? "20000 100000" : name === "cpuset.cpus.effective" ? "1" : "1");
      const result = await f.read().then(value => value.fingerprint, () => null);
      expect(result).not.toBe(before.fingerprint);
    }
  }
  for (const [name, value] of [["cpu.max", "max 100000"], ["memory.max", "max"]]) {
    const f = hostFixture(); f.content.set(`/sys/fs/cgroup${f.supervisorGroup}/${name}`, value!);
    await expect(f.read()).rejects.toThrow("Supervisor budget");
  }
  const executor = hostFixture();
  executor.content.set(`/sys/fs/cgroup${executor.managerGroup}/user.slice/memory.max`, "536870912");
  await expect(executor.read()).rejects.toThrow("Executor ancestor");
  for (const key of Object.keys(reference.supervisor)) {
    const f = hostFixture(), before = await f.read(); delete f.supervisor[key];
    await expect(f.read()).rejects.toThrow("systemd policy Unknown");
    f.supervisor[key] = "changed";
    const result = await f.read().then(value => value.fingerprint, () => null);
    expect(result).not.toBe(before.fingerprint);
  }
  for (const [path, value] of [["/proc/self/cgroup", "0::/unconstrained"], ["/proc/self/limits", "Max open files 4096 4096 files"],
    ["/proc/self/status", "NoNewPrivs: 0\nCapEff: 00000000\n"],
    ["/etc/infraforge/verifier/daemon.json", '{}'], ["/etc/infraforge/verifier/daemon.json", '{"cgroup-parent":"other.slice"}']]) {
    const f = hostFixture(); f.content.set(path!, value!); await expect(f.read()).rejects.toThrow();
  }
  const unknown = hostFixture(); unknown.manager.ControlGroup = ""; await expect(unknown.read()).rejects.toThrow();
  const outside = hostFixture(), other = "/system.slice/other.service";
  outside.supervisor.ControlGroup = other; outside.content.set("/proc/self/cgroup", `0::${other}`);
  for (const [path, value] of [...outside.content]) {
    if (path.startsWith(`/sys/fs/cgroup${outside.supervisorGroup}/`)) outside.content.set(path.replace(outside.supervisorGroup, other), value);
  }
  await expect(outside.read()).rejects.toThrow("Running service hierarchy");
});

test("actual runtime helpers are measured even with unchanged versions and a different supervisor PATH", async () => {
  const f = hostFixture();
  // The supervisor's PATH only selects its Docker CLI, never runc or the shim.
  f.host.which = name => name === "docker" ? "/usr/bin/docker" : `/unrelated/${name}`;
  f.dependencies.fingerprint = async () => (await f.read()).fingerprint;
  f.baseline.fingerprint = (await f.read()).fingerprint;
  await f.live.renew();
  f.content.set("/usr/bin/containerd-shim-runc-v2", "same-version replacement");
  f.stamps.set("/usr/bin/containerd-shim-runc-v2", BigInt(2));
  await expect(f.live.refresh()).rejects.toThrow(); expect(f.configuration.qualification).toBeNull();

  const namespace = hostFixture(), before = await namespace.read(), read = namespace.host.read, stat = namespace.host.statTarget;
  // realpath names agree, but the runtime namespace mounts different bytes.
  const actual = "/proc/43/root/usr/bin/containerd-shim-runc-v2";
  namespace.host.read = async path => path === actual ? Buffer.from("namespace replacement") : read(path);
  namespace.host.statTarget = async path => path === actual ? { ...await stat(path), ctimeNs: BigInt(2) } as any : stat(path);
  const changed = await namespace.read();
  expect(changed.fingerprint).not.toBe(before.fingerprint);
  expect((changed.observation.binaries.shim as { digest: string }).digest)
    .toBe(createHash("sha256").update("namespace replacement").digest("hex"));
});

test("loaded containerd must match the measured executable device and inode even when paths agree", async () => {
  for (const field of ["dev", "ino"] as const) {
    const f = hostFixture(), stat = f.host.statTarget;
    f.host.statTarget = async path => ({ ...await stat(path), ...(path === "/proc/43/exe" ? { [field]: BigInt(2) } : {}) });
    await expect(f.read()).rejects.toThrow("Runtime must run the measured /usr/bin containerd");
  }
});

test("unknown or unsafe runtime resolution fails closed instead of hashing a PATH substitute", async () => {
  const edited = hostFixture(); edited.stamps.set("/etc/infraforge/verifier/daemon.json", BigInt(1002_000_000_000));
  await expect(edited.read()).rejects.toThrow("before restart");
  for (const value of ["invalid toml [", "version = 2\n" + "#".repeat(65536)]) {
    const f = hostFixture(); f.content.set("/run/user/1001/docker/containerd/containerd.toml", value);
    await expect(f.read()).rejects.toThrow();
  }
  const oversized = hostFixture(), statConfig = oversized.host.statTarget;
  oversized.host.statTarget = async path => path.endsWith("/containerd.toml") ? { ...await statConfig(path), size: BigInt(65537) } as any : statConfig(path);
  await expect(oversized.read()).rejects.toThrow("Oversized");
  for (const name of ["runc", "containerd-shim-runc-v2", "docker-init"]) {
    const f = hostFixture(); f.content.delete(`/usr/bin/${name}`);
    await expect(f.read()).rejects.toThrow("executable unavailable");
    for (const change of [{ uid: BigInt(1001) }, { mode: BigInt(0o100777) }]) {
      const f = hostFixture(), stat = f.host.statTarget;
      f.host.statTarget = async path => path.endsWith(`/${name}`) ? { ...await stat(path), ...change } as any : stat(path);
      await expect(f.read()).rejects.toThrow("identity file");
    }
  }
  for (const pid of ["42", "43"]) {
    for (const value of ["", "PATH=relative\0", "PATH=/opt/bin:/usr/bin:/bin\0", "PATH=/usr/bin:/bin:/usr/bin\0", "PATH=/usr/bin:/bin\0LD_PRELOAD=/unsafe\0"]) {
      const f = hostFixture(); f.content.set(`/proc/${pid}/environ`, value); await expect(f.read()).rejects.toThrow();
    }
  }
  for (const change of ["cwd", "directory", "manager", "configuration", "custom-runtime", "shim-env", "imports", "containerd-path"] as const) {
    const f = hostFixture();
    if (change === "cwd") { const realpath = f.host.realpath; f.host.realpath = async path => path === "/proc/43/cwd" ? "/tmp" : realpath(path); }
    if (change === "directory") { const stat = f.host.statTarget; f.host.statTarget = async path => path.endsWith("/root/usr/bin") ? { ...await stat(path), mode: BigInt(0o40777) } as any : stat(path); }
    if (change === "manager") f.host.list = async () => ["41", "42"];
    if (change === "configuration") f.content.set("/proc/43/cmdline", "containerd\0--config\0/unknown.toml\0");
    if (change === "custom-runtime") f.info.Runtimes.runc.path = "/opt/runc";
    if (change === "shim-env") f.content.set("/run/user/1001/docker/containerd/containerd.toml", 'version = 2\n[plugins."io.containerd.shim.v1.manager"]\nenv=["PATH=/tmp"]\n');
    // A containerd loaded outside /usr/bin could use an unmeasured cached sibling shim.
    if (change === "containerd-path") { const realpath = f.host.realpath; f.host.realpath = async path => path === "/proc/43/exe" ? "/opt/runtime/containerd" : realpath(path); }
    if (change === "imports") f.content.set("/run/user/1001/docker/containerd/containerd.toml", 'version = 2\nimports=["/unknown.toml"]\n');
    await expect(f.read()).rejects.toThrow();
  }
});

test("live production health requires successful responses from all three fixed probes", async () => {
  const urls: string[] = [];
  const request = (async (url: string, options: RequestInit) => {
    urls.push(url); expect(options.redirect).toBe("error"); expect(options.signal).toBeDefined();
    return new Response("ok");
  }) as typeof fetch;
  await assertVerifierProductionResponsive(request); expect(urls).toHaveLength(3);
  for (const failedUrl of urls) {
    await expect(assertVerifierProductionResponsive((async (url: string) =>
      new Response("fixture", { status: url === failedUrl ? 503 : 200 })) as typeof fetch)).rejects.toThrow();
  }
  await expect(assertVerifierProductionResponsive((async () => { throw Error("timeout"); }) as unknown as typeof fetch)).rejects.toThrow("timeout");
});

test("live limit probes need actual denials, isolated network and increasing throttling counters", () => {
  const value = { readonly: true, fdDenied: true, files: 120, interfaces: ["lo"],
    before: { nr_throttled: 1, throttled_usec: 10 }, after: { nr_throttled: 2, throttled_usec: 20 } };
  assertIsolationSelfCheck(value);
  for (const change of [{ readonly: false }, { fdDenied: false }, { files: 128 }, { interfaces: ["lo", "eth0"] },
    { after: { nr_throttled: 1, throttled_usec: 20 } }, { after: { nr_throttled: 2, throttled_usec: 10 } },
    { after: {} as Record<string, number> }]) expect(() => assertIsolationSelfCheck({ ...value, ...change })).toThrow("limit probe");
});
