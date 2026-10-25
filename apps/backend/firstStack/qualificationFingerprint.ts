import { createHash } from "node:crypto";
import { lstat, stat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path/posix";
import { cpus, freemem, platform, totalmem } from "node:os";
import { hash } from "./canonical";
import { readVerifierUnit, verifierUnitProperties, type IsolationControl } from "./isolationConnection";
import { accessSync, constants, type BigIntStats } from "node:fs";
import { parse as parseToml } from "smol-toml";

const daemonConfig = "/etc/infraforge/verifier/daemon.json";
const cgroupFiles = ["cgroup.controllers", "cgroup.subtree_control", "cpu.max", "memory.max",
  "memory.swap.max", "pids.max", "cpuset.cpus.effective", "cpuset.mems.effective",
  "memory.high", "memory.low", "memory.min", "memory.oom.group", "cpu.weight"];
const supervisorUnit = "first-stack-verifier.service";
// Effective values, not sysctl configuration files: these can change without
// a reboot. Keep allocation, OOM selection, scheduler and global task/FD limits
// bound to the destructive rehearsal. Unknown policies never inherit evidence.
const kernelPolicies = ["vm/panic_on_oom", "vm/oom_kill_allocating_task", "vm/overcommit_memory",
  "vm/overcommit_ratio", "vm/overcommit_kbytes", "vm/min_free_kbytes", "vm/swappiness",
  "kernel/sched_cfs_bandwidth_slice_us", "kernel/threads-max", "kernel/pid_max",
  "fs/file-max", "fs/nr_open"];
export interface FingerprintHost {
  platform: string; uid: number; executable: string;
  read(path: string): Promise<Buffer>; stat(path: string): Promise<BigIntStats>;
  statTarget(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>; list(path: string): Promise<string[]>;
  which(name: string): string | null; cpuModels(): string[]; memory(): number;
  systemd(unit: "supervisor" | "manager"): Promise<string>;
}
function nativeHost(): FingerprintHost {
  return { platform: platform(), uid: process.getuid!(), executable: process.execPath,
    read: path => readFile(path), stat: path => lstat(path, { bigint: true }), statTarget: path => stat(path, { bigint: true }),
    realpath, list: path => readdir(path), which: name => {
      for (const directory of (process.env.PATH ?? "").split(":")) {
        if (!isAbsolute(directory)) throw Error("Absolute runtime search path required");
        const path = join(directory, name);
        try { accessSync(path, constants.X_OK); return path; }
        catch (error) { if (!["ENOENT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      }
      return null;
    },
    cpuModels: () => cpus().map(cpu => cpu.model), memory: totalmem, systemd: readVerifierUnit };
}

// Cache only unchanged regular files. ctime/inode changes invalidate the cache
// even if an updater preserves mtime. Kernel pseudo-files are always reread.
export function createHostFingerprintReader(control: IsolationControl, host?: FingerprintHost) {
  const files = new Map<string, { stamp: string; digest: string }>();
  // Delay Linux-only APIs until observation, so CI containment mode still runs.
  const machineHost = () => host ??= nativeHost();
  const text = async (path: string) => (await machineHost().read(path)).toString("utf8");
  async function fileIdentity(path: string) {
    const resolved = await machineHost().realpath(path), stat = await machineHost().statTarget(path);
    if (!stat.isFile() || stat.uid !== 0n || stat.size > 256n * 1024n * 1024n || (stat.mode & 0o022n)) {
      throw Error("Unsafe or oversized host identity file");
    }
    const stamp = [resolved, stat.dev, stat.ino, stat.size, stat.ctimeNs, stat.mtimeNs, stat.uid, stat.mode].join(":");
    let cached = files.get(path);
    if (cached?.stamp !== stamp) {
      // Read through the original proc-root/exe path: resolving it and then
      // opening that name in OUR mount namespace can hash a different binary.
      const digest = createHash("sha256").update(await machineHost().read(path)).digest("hex");
      const after = await machineHost().statTarget(path);
      if (after.ctimeNs !== stat.ctimeNs || after.ino !== stat.ino || after.size !== stat.size) throw Error("Host file changed during observation");
      cached = { stamp, digest }; files.set(path, cached);
    }
    return { path: resolved, ...cached };
  }
  async function processIdentity(pid: string) {
    const value = await text(`/proc/${pid}/stat`), fields = value.slice(value.lastIndexOf(")") + 2).split(" ");
    const start = fields[19], parent = fields[1];
    if (!start || !/^[0-9]+$/.test(start) || !parent || !/^[0-9]+$/.test(parent)) throw Error("Daemon start identity Unknown");
    return { pid, start, parent, executable: await fileIdentity(`/proc/${pid}/exe`) };
  }
  async function processPath(pid: string) {
    // Select only the runtime search path. Never retain/log the process environment.
    const environment = (await text(`/proc/${pid}/environ`)).split("\0");
    const paths = environment.filter(value => value.startsWith("PATH="));
    if (paths.length !== 1 || environment.some(value => /^(LD_PRELOAD|LD_LIBRARY_PATH|DOCKER_RAMDISK)=.+/.test(value))) {
      throw Error("Runtime search environment unsupported");
    }
    const directories = paths[0]!.slice(5).split(":");
    if (directories.join(":") !== "/usr/bin:/bin") throw Error("Supported runtime search path required");
    if (await machineHost().realpath(`/proc/${pid}/root/bin`) !== await machineHost().realpath(`/proc/${pid}/root/usr/bin`)) {
      throw Error("Merged protected runtime search directories required");
    }
    for (const directory of directories) {
      let path = directory;
      while (path !== "/") {
        const value = await machineHost().statTarget(`/proc/${pid}/root${path}`);
        if (!value.isDirectory() || value.uid !== 0n || (value.mode & 0o022n)) throw Error("Unprotected runtime search directory");
        path = dirname(path);
      }
    }
    return directories;
  }
  async function runtimeBinary(pid: string, directories: string[], name: string) {
    for (const directory of directories.slice(0, 1)) {
      const path = `/proc/${pid}/root${directory}/${name}`;
      try {
        const value = await machineHost().statTarget(path);
        if (!value.isFile() || !(value.mode & 0o111n)) continue;
        return await fileIdentity(path);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    throw Error("Actual runtime executable unavailable; no fallback");
  }
  async function processGroup(pid: string) {
    const rows = (await text(`/proc/${pid}/cgroup`)).trim().split("\n");
    if (rows.length !== 1 || !rows[0]!.startsWith("0::/")) throw Error("Unified cgroup hierarchy required");
    return rows[0]!.slice(3);
  }
  async function cgroups(group: string) {
    if (!/^\/(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+$/.test(group) ||
      group.split("/").some(part => part === "." || part === "..")) throw Error("Invalid cgroup path");
    let path = join("/sys/fs/cgroup", group);
    const ancestry: Array<{ path: string; controls: Record<string, string> }> = [];
    while (path !== "/sys/fs/cgroup") {
      const controls: Record<string, string> = {};
      for (const name of cgroupFiles) {
        const value = (await text(join(path, name))).trim();
        const valid = name === "cpu.max" ? /^(max|[1-9][0-9]*) [1-9][0-9]*$/.test(value)
          : name.startsWith("cpuset.") ? /^[0-9]+(?:[-,][0-9]+)*$/.test(value)
          : name.startsWith("cgroup.") ? /^(?:[a-z]+(?: [a-z]+)*)?$/.test(value)
          : /^(max|0|[1-9][0-9]*)$/.test(value);
        if (!valid) throw Error("Effective cgroup policy Unknown");
        controls[name] = value;
      }
      ancestry.push({ path, controls }); path = dirname(path);
    }
    return ancestry;
  }
  async function effectiveUnit(unit: "supervisor" | "manager") {
    const properties: Record<string, string> = {};
    for (const row of (await machineHost().systemd(unit)).trim().split("\n")) {
      const at = row.indexOf("=");
      if (at < 1 || row.slice(0, at) in properties) throw Error("Effective systemd policy Unknown");
      properties[row.slice(0, at)] = row.slice(at + 1);
    }
    for (const key of unit === "supervisor" ? verifierUnitProperties : ["ControlGroup"]) {
      if (!(key in properties) || key !== "CapabilityBoundingSet" && !properties[key]) throw Error("Effective systemd policy Unknown");
    }
    return properties;
  }
  return async () => {
    if (platform() !== "linux" && !host || machineHost().platform !== "linux") throw Error("Linux host fingerprint required");
    await control.assertIdentity();
    const info = JSON.parse(await control.run(["info", "--format", "{{json .}}"]));
    const version = JSON.parse(await control.run(["version", "--format", "{{json .Server}}"]));
    const machine = (await text("/sys/devices/virtual/dmi/id/product_name")).trim();
    if (info.OSType !== "linux" || info.CgroupVersion !== "2" || info.CgroupDriver !== "systemd" ||
      !info.SecurityOptions?.includes("name=rootless") || info.NCPU !== 2 || info.Architecture !== "x86_64" ||
      info.MemTotal < 3.5 * 1024 ** 3 || info.MemTotal > 4.5 * 1024 ** 3 || machine !== "c7i-flex.large") {
      throw Error("Qualified rootless c7i-flex.large with delegated cgroup v2 required");
    }
    const knownText = (value: unknown) => typeof value === "string" && value.length > 0;
    if (![version?.Version, info.KernelVersion, info.Architecture, info.DockerRootDir].every(knownText) ||
      !Array.isArray(version.Components) || !version.Components.length ||
      version.Components.some((component: { Name?: unknown; Version?: unknown }) => !knownText(component?.Name) || !knownText(component?.Version)) ||
      !info.Runtimes || info.DefaultRuntime !== "runc" ||
      !["overlay2", "overlayfs"].includes(info.Driver)) throw Error("Runtime identity Unknown or unsupported");
    const cli = machineHost().which("docker");
    if (!cli) throw Error("Required host runtime executable unavailable");
    const binaries: Record<string, unknown> = { docker: await fileIdentity(cli), bun: await fileIdentity(machineHost().executable) };
    const candidates: string[] = [], containers: string[] = [];
    for (const pid of await machineHost().list("/proc")) {
      if (!/^[0-9]+$/.test(pid)) continue;
      try {
        if ((await machineHost().stat(`/proc/${pid}`)).uid === BigInt(machineHost().uid)) {
          const name = (await text(`/proc/${pid}/comm`)).trim();
          if (name === "dockerd") candidates.push(pid);
          if (name === "containerd") containers.push(pid);
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (candidates.length !== 1) throw Error("Exactly one dedicated user daemon required");
    const pid = candidates[0]!, command = (await text(`/proc/${pid}/cmdline`)).split("\0");
    if (command.filter(Boolean).length !== 2 || command[1] !== `--config-file=${daemonConfig}`) throw Error("Dedicated protected daemon configuration required");
    const configIdentity = await fileIdentity(daemonConfig), config = JSON.parse(await text(daemonConfig));
    if (config["cgroup-parent"] !== "user.slice" || command.some(arg => arg.startsWith("--cgroup-parent"))) {
      throw Error("Explicit supported executor cgroup parent required");
    }
    if (config.runtimes || config.containerd || config["containerd-plugins-namespace"] ||
      config["default-runtime"] && config["default-runtime"] !== "runc" ||
      config["init-path"] !== "/usr/bin/docker-init" || config["exec-root"] || info.Runtimes.runc?.path !== "runc" || info.Runtimes.runc?.runtimeArgs?.length) {
      throw Error("Unresolved custom runtime configuration");
    }
    if (containers.length !== 1) throw Error("Exactly one managed containerd required");
    const daemonProcess = await processIdentity(pid), containerd = await processIdentity(containers[0]!);
    // The selected Intel Linux host exposes process start ticks in USER_HZ=100.
    // Require config to predate daemon launch, so an edited-but-not-reloaded
    // cgroup/runtime policy cannot masquerade as the daemon's effective config.
    const bootSeconds = (await text("/proc/stat")).match(/^btime ([0-9]+)$/m)?.[1];
    if (!bootSeconds) throw Error("Daemon configuration load time Unknown");
    const earliestStartNs = BigInt(bootSeconds) * 1_000_000_000n + BigInt(daemonProcess.start) * 10_000_000n;
    if ((await machineHost().statTarget(daemonConfig)).ctimeNs >= earliestStartNs ||
      hash(await fileIdentity(`/proc/${pid}/root${daemonConfig}`)) !== hash(configIdentity)) {
      throw Error("Daemon configuration must be installed before restart in its actual namespace");
    }
    if (containerd.parent !== pid) throw Error("Containerd is not managed by the selected daemon");
    const rootless = await processIdentity(daemonProcess.parent);
    if ((await text(`/proc/${rootless.pid}/comm`)).trim() !== "rootlesskit") throw Error("Actual rootless launcher Unknown");
    const daemonPath = await processPath(pid), runtimePath = await processPath(containerd.pid);
    // Containerd checks the working directory before PATH, and caches the path.
    // Make both resolutions identical; never guess which cached fallback won.
    if (await machineHost().realpath(`/proc/${containerd.pid}/cwd`) !== await machineHost().realpath(`/proc/${containerd.pid}/root/usr/bin`)) {
      throw Error("Runtime working directory cannot establish shim path");
    }
    // Containerd also falls back to shims beside its own executable and caches that choice.
    // Require the loaded executable to be the measured /usr/bin one, so any fallback is the measured shim.
    const loaded = `/proc/${containerd.pid}/exe`, measured = `/proc/${containerd.pid}/root/usr/bin/containerd`;
    const loadedFile = await machineHost().statTarget(loaded), measuredFile = await machineHost().statTarget(measured);
    if (await machineHost().realpath(loaded) !== await machineHost().realpath(measured) ||
      loadedFile.dev !== measuredFile.dev || loadedFile.ino !== measuredFile.ino) {
      throw Error("Runtime must run the measured /usr/bin containerd");
    }
    binaries.dockerd = daemonProcess.executable; binaries.containerd = containerd.executable; binaries.rootlesskit = rootless.executable;
    binaries.runc = await runtimeBinary(containerd.pid, runtimePath, "runc");
    binaries.shim = await runtimeBinary(containerd.pid, runtimePath, "containerd-shim-runc-v2");
    binaries.init = await runtimeBinary(pid, daemonPath, "docker-init");
    // Docker's stock runc must resolve to the same file for feature discovery
    // and shim execution. No alternative runtime or sibling-binary fallback.
    if (hash(await runtimeBinary(pid, daemonPath, "runc")) !== hash(binaries.runc)) throw Error("Runtime resolution disagrees");
    const runtimeConfig = `/run/user/${machineHost().uid}/docker/containerd/containerd.toml`;
    const runtimeCommand = (await text(`/proc/${containerd.pid}/cmdline`)).split("\0").filter(Boolean);
    if (runtimeCommand.length !== 3 || runtimeCommand[1] !== "--config" || runtimeCommand[2] !== runtimeConfig) throw Error("Managed runtime configuration Unknown");
    const runtimeConfigPath = `/proc/${containerd.pid}/root${runtimeConfig}`;
    if ((await machineHost().statTarget(runtimeConfigPath)).size > 65536n) throw Error("Oversized managed runtime configuration");
    const runtimeConfigText = await text(runtimeConfigPath);
    if (Buffer.byteLength(runtimeConfigText) > 65536) throw Error("Oversized managed runtime configuration");
    const runtimeConfigValue = parseToml(runtimeConfigText, { unsafeKeyBehaviour: "throw" }) as Record<string, any>;
    if (runtimeConfigValue.version !== 2 || runtimeConfigValue.imports?.length || runtimeConfigValue.plugin_dir ||
      Object.keys(runtimeConfigValue.proxy_plugins ?? {}).length ||
      Object.keys(runtimeConfigValue.plugins ?? {}).some(key => !["io.containerd.grpc.v1.cri", "io.containerd.runtime.v1.linux"].includes(key))) {
      throw Error("Runtime helper overrides unsupported");
    }
    const supervisor = await effectiveUnit("supervisor"), manager = await effectiveUnit("manager");
    const supervisorGroup = await processGroup("self"), daemonGroup = await processGroup(pid);
    if (supervisorGroup !== `/system.slice/${supervisorUnit}` || supervisor.ControlGroup !== supervisorGroup ||
      !manager.ControlGroup || !daemonGroup.startsWith(manager.ControlGroup + "/")) throw Error("Running service hierarchy unsupported");
    const supervisorGroups = await cgroups(supervisorGroup), executorGroups = await cgroups(`${manager.ControlGroup}/user.slice`);
    const budget = supervisorGroups[0]!.controls;
    if (budget["memory.max"] !== "536870912" || budget["memory.swap.max"] !== "0" ||
      budget["pids.max"] !== "128" || budget["cpu.max"] !== "15000 100000") throw Error("Supervisor budget not enforced");
    const required = { User: "infraforge-verifier", Group: "infraforge-verifier", MemoryMax: "536870912",
      MemorySwapMax: "0", TasksMax: "128", CPUQuotaPerSecUSec: "150ms", CPUQuotaPeriodUSec: "100ms",
      LimitNOFILE: "512", LimitNOFILESoft: "512", NoNewPrivileges: "yes", ProtectSystem: "strict", ProtectHome: "tmpfs",
      PrivateTmp: "yes", PrivateDevices: "yes", RestrictSUIDSGID: "yes", CapabilityBoundingSet: "", KillMode: "control-group", UMask: "0077" };
    for (const [key, value] of Object.entries(required)) if (supervisor[key] !== value) throw Error("Effective supervisor safety policy unsupported");
    if (!(await text("/proc/self/status")).match(/NoNewPrivs:\s+1\b/) ||
      !(await text("/proc/self/status")).match(/CapEff:\s+0+\s/) ||
      !(await text("/proc/self/limits")).match(/Max open files\s+512\s+512\b/)) throw Error("Running supervisor restrictions missing");
    for (const { controls } of executorGroups) {
      const [quota, period] = controls["cpu.max"]!.split(" ");
      if (controls["memory.max"] !== "max" && BigInt(controls["memory.max"]!) < 768n * 1024n ** 2n ||
        controls["pids.max"] !== "max" && BigInt(controls["pids.max"]!) < 64n ||
        quota !== "max" && Number(quota) / Number(period) < 0.5) throw Error("Executor ancestor below qualified budget");
    }
    const policies: Record<string, string> = {};
    for (const name of kernelPolicies) {
      const value = (await text(`/proc/sys/${name}`)).trim();
      if (!/^(0|[1-9][0-9]*)$/.test(value)) throw Error("Live kernel policy Unknown");
      policies[name] = value;
    }
    if (policies["vm/panic_on_oom"] !== "0" || policies["vm/oom_kill_allocating_task"] !== "0" ||
      !["0", "1"].includes(policies["vm/overcommit_memory"]!)) throw Error("Unsupported live OOM policy");
    const observation = {
      schema: "first-stack-fingerprint/2", daemon: control.identity,
      boot: (await text("/proc/sys/kernel/random/boot_id")).trim(),
      kernel: (await text("/proc/version")).trim(), machine, policies,
      cpus: machineHost().cpuModels(), memory: machineHost().memory(),
      docker: { version, kernel: info.KernelVersion, architecture: info.Architecture,
        driver: info.Driver, driverStatus: info.DriverStatus, cgroup: info.CgroupVersion,
        cgroupDriver: info.CgroupDriver, security: info.SecurityOptions, runtimes: info.Runtimes,
        defaultRuntime: info.DefaultRuntime, root: info.DockerRootDir },
      // Debian/Ubuntu package database binds installed libraries and package updates,
      // including live kernel patch packages. Other distributions remain unsupported.
      packages: await fileIdentity("/var/lib/dpkg/status"), binaries,
      config: configIdentity,
      supervisor: { unit: await fileIdentity("/etc/systemd/system/first-stack-verifier.service"),
        effective: supervisor, cgroups: supervisorGroups },
      executorParent: { manager, cgroups: executorGroups },
      runtime: { containerd, rootless, daemonPath, runtimePath, config: hash(runtimeConfigText) },
      daemonProcess: { ...daemonProcess, command: hash(command),
        cgroups: await cgroups(daemonGroup) },
    };
    await control.assertIdentity();
    return { fingerprint: hash(observation), observation };
  };
}

export function assertLiveHeadroom() {
  if (freemem() < 512 * 1024 * 1024) throw Error("Verifier host headroom below qualification threshold");
}
