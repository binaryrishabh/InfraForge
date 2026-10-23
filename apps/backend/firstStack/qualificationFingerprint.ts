import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path/posix";
import { cpus, freemem, platform, totalmem } from "node:os";
import { hash } from "./canonical";
import type { IsolationControl } from "./isolationConnection";
import { accessSync, constants, type BigIntStats } from "node:fs";

const daemonConfig = "/etc/infraforge/verifier/daemon.json";
const binaryNames = ["docker", "dockerd", "containerd", "runc", "rootlesskit"] as const;
const cgroupFiles = ["cgroup.controllers", "cgroup.subtree_control", "cpu.max", "memory.max",
  "memory.swap.max", "pids.max", "cpuset.cpus.effective", "cpuset.mems.effective"];
export interface FingerprintHost {
  platform: string; uid: number; executable: string;
  read(path: string): Promise<Buffer>; stat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>; list(path: string): Promise<string[]>;
  which(name: string): string | null; cpuModels(): string[]; memory(): number;
}
function nativeHost(): FingerprintHost {
  return { platform: platform(), uid: process.getuid!(), executable: process.execPath,
    read: path => readFile(path), stat: path => lstat(path, { bigint: true }),
    realpath, list: path => readdir(path), which: name => {
      for (const directory of (process.env.PATH ?? "").split(":")) {
        if (!isAbsolute(directory)) throw Error("Absolute runtime search path required");
        const path = join(directory, name);
        try { accessSync(path, constants.X_OK); return path; }
        catch (error) { if (!["ENOENT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      }
      return null;
    },
    cpuModels: () => cpus().map(cpu => cpu.model), memory: totalmem };
}

// Cache only unchanged regular files. ctime/inode changes invalidate the cache
// even if an updater preserves mtime. Kernel pseudo-files are always reread.
export function createHostFingerprintReader(control: IsolationControl, host?: FingerprintHost) {
  const files = new Map<string, { stamp: string; digest: string }>();
  // Delay Linux-only APIs until observation, so CI containment mode still runs.
  const machineHost = () => host ??= nativeHost();
  const text = async (path: string) => (await machineHost().read(path)).toString("utf8");
  async function fileIdentity(path: string) {
    const resolved = await machineHost().realpath(path), stat = await machineHost().stat(resolved);
    if (!stat.isFile() || stat.uid !== 0n || stat.size > 256n * 1024n * 1024n || (stat.mode & 0o022n)) {
      throw Error("Unsafe or oversized host identity file");
    }
    const stamp = [resolved, stat.dev, stat.ino, stat.size, stat.ctimeNs, stat.mtimeNs, stat.uid, stat.mode].join(":");
    let cached = files.get(path);
    if (cached?.stamp !== stamp) {
      const digest = createHash("sha256").update(await machineHost().read(resolved)).digest("hex");
      const after = await machineHost().stat(resolved);
      if (after.ctimeNs !== stat.ctimeNs || after.ino !== stat.ino || after.size !== stat.size) throw Error("Host file changed during observation");
      cached = { stamp, digest }; files.set(path, cached);
    }
    return { path: resolved, ...cached };
  }
  async function cgroups(pid: string) {
    const rows = (await text(`/proc/${pid}/cgroup`)).trim().split("\n");
    if (rows.length !== 1 || !rows[0]!.startsWith("0::/")) throw Error("Unified cgroup hierarchy required");
    const relative = rows[0]!.slice(4);
    if (relative.split("/").includes("..")) throw Error("Invalid daemon cgroup path");
    let path = join("/sys/fs/cgroup", relative);
    const ancestry: Array<{ path: string; controls: Record<string, string> }> = [];
    while (path !== "/sys/fs/cgroup") {
      const controls: Record<string, string> = {};
      for (const name of cgroupFiles) controls[name] = (await text(join(path, name))).trim();
      ancestry.push({ path, controls }); path = dirname(path);
    }
    return ancestry;
  }
  return async () => {
    if (platform() !== "linux" && !host || machineHost().platform !== "linux") throw Error("Linux host fingerprint required");
    await control.assertIdentity();
    const info = JSON.parse(await control.run(["info", "--format", "{{json .}}"]));
    const version = JSON.parse(await control.run(["version", "--format", "{{json .Server}}"]));
    const machine = (await text("/sys/devices/virtual/dmi/id/product_name")).trim();
    if (info.OSType !== "linux" || info.CgroupVersion !== "2" || info.CgroupDriver !== "systemd" ||
      !info.SecurityOptions?.includes("name=rootless") || info.NCPU !== 2 ||
      info.MemTotal < 3.5 * 1024 ** 3 || info.MemTotal > 4.5 * 1024 ** 3 || machine !== "c7i-flex.large") {
      throw Error("Qualified rootless c7i-flex.large with delegated cgroup v2 required");
    }
    const knownText = (value: unknown) => typeof value === "string" && value.length > 0;
    if (![version?.Version, info.KernelVersion, info.Architecture, info.DockerRootDir].every(knownText) ||
      !Array.isArray(version.Components) || !version.Components.length ||
      version.Components.some((component: { Name?: unknown; Version?: unknown }) => !knownText(component?.Name) || !knownText(component?.Version)) ||
      !info.Runtimes || info.DefaultRuntime !== "runc" ||
      !["overlay2", "overlayfs"].includes(info.Driver)) throw Error("Runtime identity Unknown or unsupported");
    const binaries: Record<string, unknown> = {};
    for (const name of binaryNames) {
      const path = machineHost().which(name);
      if (!path) throw Error("Required host runtime executable unavailable");
      binaries[name] = await fileIdentity(path);
    }
    binaries.bun = await fileIdentity(machineHost().executable);
    const candidates: string[] = [];
    for (const pid of await machineHost().list("/proc")) {
      if (!/^[0-9]+$/.test(pid)) continue;
      try {
        if ((await machineHost().stat(`/proc/${pid}`)).uid === BigInt(machineHost().uid) &&
          (await text(`/proc/${pid}/comm`)).trim() === "dockerd") candidates.push(pid);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (candidates.length !== 1) throw Error("Exactly one dedicated user daemon required");
    const pid = candidates[0]!, command = (await text(`/proc/${pid}/cmdline`)).split("\0");
    if (!command.includes(`--config-file=${daemonConfig}`)) throw Error("Dedicated protected daemon configuration required");
    const stat = await text(`/proc/${pid}/stat`);
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    if (!start || !/^[0-9]+$/.test(start)) throw Error("Daemon start identity Unknown");
    const observation = {
      schema: "first-stack-fingerprint/2", daemon: control.identity,
      boot: (await text("/proc/sys/kernel/random/boot_id")).trim(),
      kernel: (await text("/proc/version")).trim(), machine,
      cpus: machineHost().cpuModels(), memory: machineHost().memory(),
      docker: { version, kernel: info.KernelVersion, architecture: info.Architecture,
        driver: info.Driver, driverStatus: info.DriverStatus, cgroup: info.CgroupVersion,
        cgroupDriver: info.CgroupDriver, security: info.SecurityOptions, runtimes: info.Runtimes,
        defaultRuntime: info.DefaultRuntime, root: info.DockerRootDir },
      // Debian/Ubuntu package database binds installed libraries and package updates,
      // including live kernel patch packages. Other distributions remain unsupported.
      packages: await fileIdentity("/var/lib/dpkg/status"), binaries,
      config: await fileIdentity(daemonConfig),
      supervisor: await fileIdentity("/etc/systemd/system/first-stack-verifier.service"),
      daemonProcess: { pid, start,
        executable: await fileIdentity(`/proc/${pid}/exe`), command: hash(command),
        cgroups: await cgroups(pid) },
    };
    await control.assertIdentity();
    return { fingerprint: hash(observation), observation };
  };
}

export function assertLiveHeadroom() {
  if (freemem() < 512 * 1024 * 1024) throw Error("Verifier host headroom below qualification threshold");
}
