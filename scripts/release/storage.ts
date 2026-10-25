import { lstat, readFile, readlink } from "node:fs/promises";
import { posix } from "node:path";
import { command } from "./process";
import { localDockerEndpoint, localDockerEnvironment } from "./docker-endpoint";
export { localDockerEnvironment } from "./docker-endpoint";

export const unknownStorage = "Release disk preflight refused: image/snapshot storage filesystem is Unknown. " +
  "Only local rootful classic overlay2 or qualified default system containerd overlayfs is supported.";
export const absoluteStoragePath = (value: unknown): value is string => typeof value === "string" &&
  value.startsWith("/") && /[^/]/.test(value) && !value.split("/").includes("..") && !/[\x00-\x20\x7f]/.test(value);
const refuse = (): never => { throw new Error(unknownStorage); };
type Table = Record<string, unknown>;
function table(value: unknown): Table {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse();
  return value as Table;
}
export function parseContainerdConfig(text: string): Table {
  // Bun 1.3.14: node_modules/bun-types/docs/runtime/toml.mdx, Runtime API.
  // Parser diagnostics can contain configuration secrets. Do not retain a cause.
  try { return table(Bun.TOML.parse(text)); } catch { return refuse(); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function qualifiedContainerdPaths(dump: Table, defaults: Table, address: string) {
  if (![2, 3, 4].includes(dump.version as number) || dump.version !== defaults.version) return refuse();
  const known = new Set(["version", "root", "state", "temp", "plugin_dir", "imports", "disabled_plugins", "required_plugins",
    "oom_score", "grpc", "ttrpc", "debug", "metrics", "plugins", "proxy_plugins", "timeouts", "stream_processors", "cgroup"]);
  if (Object.keys(dump).some(key => !known.has(key))) return refuse();
  if (Object.keys(table(dump.proxy_plugins ?? {})).length) return refuse();
  // Compare against this executable's own defaults, including every plugin key.
  // This deliberately refuses even harmless plugin customization until qualified.
  for (const key of ["plugins", "disabled_plugins", "required_plugins", "plugin_dir", "temp", "stream_processors"]) {
    if (canonical(dump[key]) !== canonical(defaults[key])) return refuse();
  }
  const plugins = table(dump.plugins);
  const overlay = table(plugins["io.containerd.snapshotter.v1.overlayfs"]);
  if (overlay.root_path !== undefined && overlay.root_path !== "") return refuse();
  if (Object.keys(plugins).some(key => /snapshotter|content/.test(key) && !(key in table(defaults.plugins)))) return refuse();
  const base = dump.root;
  // Schema 4 migrates server settings into plugins; legacy grpc must not mask
  // a missing or different effective server plugin. All plugins still match defaults.
  const grpc = table(dump.version === 4 ? plugins["io.containerd.server.v1.grpc"] : dump.grpc);
  if (!absoluteStoragePath(base) || grpc.address !== address || dump.state !== defaults.state) return refuse();
  return [base.replace(/\/+$/, ""), `${base.replace(/\/+$/, "")}/io.containerd.content.v1.content`,
    `${base.replace(/\/+$/, "")}/io.containerd.snapshotter.v1.overlayfs`];
}

export async function verifyLocalDocker(root: string, run = command, env = process.env) {
  localDockerEnvironment(env);
  // Check the user's selection before pinning calls. Do not silently redirect a remote context.
  if ((await run(["docker", "context", "show"], root, env)).trim() !== "default") return refuse();
  const contexts = JSON.parse(await run(["docker", "context", "inspect", "default"], root, env));
  if (!Array.isArray(contexts) || contexts.length !== 1 || contexts[0]?.Name !== "default" ||
      contexts[0]?.Endpoints?.docker?.Host !== localDockerEndpoint) return refuse();
}

export type ConfigMetadata = { kind: "file" | "directory" | "socket" | "other"; ctimeMs: number; identity: string; uid: number; mode: number };
export type StorageHost = {
  read: (path: string) => Promise<string>;
  link: (path: string) => Promise<string>;
  metadata: (path: string) => Promise<ConfigMetadata | undefined>;
};
export function storageHost(run = command, cwd = process.cwd()): StorageHost {
  return {
    async read(path) {
      try { return await readFile(path, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
        return run(["sudo", "-n", "cat", "--", path], cwd);
      }
    },
    async link(path) {
      try { return await readlink(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
        return run(["sudo", "-n", "readlink", "--", path], cwd);
      }
    },
    async metadata(path) {
      try {
        const value = await lstat(path);
        return { kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : value.isSocket() ? "socket" : "other",
          ctimeMs: value.ctimeMs, identity: `${value.dev}:${value.ino}:${value.size}:${value.ctimeMs}`, uid: value.uid, mode: value.mode };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
        const value = await run(["sudo", "-n", "stat", "--format=%F|%Z|%d:%i:%s:%z|%u|%a", "--", path], cwd);
        const [kind, seconds, identity, uid, mode] = value.trim().split("|");
        if (!/^\d+$/.test(seconds ?? "") || !identity || !/^\d+$/.test(uid ?? "") || !/^[0-7]+$/.test(mode ?? "")) return refuse();
        // stat's seconds are truncated: round UP before comparing with start.
        return { kind: kind === "regular file" ? "file" : kind === "directory" ? "directory" : kind === "socket" ? "socket" : "other",
          ctimeMs: (Number(seconds) + 1) * 1000, identity, uid: Number(uid), mode: parseInt(mode!, 8) };
      }
    },
  };
}

export async function dockerdEvidence(cwd: string, run = command, host = storageHost(run, cwd), address?: string, containerdPid?: string) {
  try {
    const socket = await host.metadata("/var/run/docker.sock");
    if (socket?.kind !== "socket" || socket.uid !== 0) return refuse();
    const namespace = await host.link("/proc/self/ns/mnt");
    if (!/^mnt:\[\d+\]$/.test(namespace)) return refuse();
    const rows = (await run(["sudo", "-n", "ss", "-H", "-xapn"], cwd)).trim().split("\n").map(line => ({
      fields: line.trim().split(/\s+/), pids: [...line.matchAll(/pid=(\d+),/g)].map(match => match[1]!),
    }));
    // /var/run normally aliases /run. Accept either spelling only for the same inode.
    const alias = await host.metadata("/run/docker.sock");
    const listeners = rows.filter(({ fields }) => fields[1] === "LISTEN" &&
      (fields[4] === "/var/run/docker.sock" || fields[4] === "/run/docker.sock" && alias?.identity === socket.identity));
    if (listeners.length !== 1 || !listeners[0]!.pids.length) return refuse();
    let pid: string | undefined;
    for (const owner of new Set(listeners[0]!.pids)) {
      const exe = await host.link(`/proc/${owner}/exe`);
      // Socket activation can leave systemd holding the listening descriptor.
      if (owner === "1" && exe.endsWith("/systemd")) continue;
      if (!absoluteStoragePath(exe) || !exe.endsWith("/dockerd") || pid) return refuse();
      pid = owner;
    }
    if (!pid) return refuse();
    const proc = `/proc/${pid}`;
    if ((await host.metadata(proc))?.uid !== 0 || await host.link(`${proc}/ns/mnt`) !== namespace ||
        await host.link(`${proc}/root`) !== "/") return refuse();
    if (address) {
      const connected = rows.some(client => client.fields[1] === "ESTAB" && client.pids.includes(pid!) &&
        client.fields[6] === address && /^[1-9]\d*$/.test(client.fields[5] ?? "") &&
        rows.some(server => server.fields[1] === "ESTAB" && server.pids.includes(containerdPid!) &&
          server.fields[4] === address && server.fields[5] === client.fields[7] && server.fields[7] === client.fields[5]));
      if (!connected) return refuse();
    }
    const stat = await host.read(`${proc}/stat`);
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19];
    if (!stat.startsWith(`${pid} (`) || !/^\d+$/.test(start ?? "")) return refuse();
    return canonical({ pid, start, exe: await host.link(`${proc}/exe`), namespace,
      socket: socket.identity });
  } catch { return refuse(); }
}

export function daemonStartMilliseconds(stat: string, bootStat: string, ticks: string) {
  // /proc/PID/stat field 22 is ticks since boot; comm may itself contain spaces/parentheses.
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19];
  const boot = /^btime (\d+)$/m.exec(bootStat)?.[1];
  if (!/^[1-9]\d* \(/.test(stat) || !stat.includes(") ") || !/^\d+$/.test(start ?? "") || !boot || !/^[1-9]\d*$/.test(ticks.trim())) return refuse();
  const result = Number(boot) * 1000 + Number(start) / Number(ticks) * 1000;
  if (!Number.isSafeInteger(Number(start)) || !Number.isFinite(result)) return refuse();
  return result;
}

// mountinfo has no attachment timestamp. Refuse ALL subordinate mounts covering
// an input, including old-looking bind sources; never infer mount age from ctime.
// The only supported backing mount is the same whole-filesystem root as PID 1.
async function inputMount(host: StorageHost, proc: string, path: string) {
  const roots: string[] = [];
  for (const owner of ["/proc/self", proc, "/proc/1"]) {
    const rows = (await host.read(`${owner}/mountinfo`)).trim().split("\n").map(line => {
      const fields = line.trim().split(/\s+/), separator = fields.indexOf("-");
      if (fields.length < 10 || separator < 6 || !/^\d+$/.test(fields[0]!) || !/^\d+:\d+$/.test(fields[2]!)) return refuse();
      const point = fields[4]!.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
      return { fields, point, line };
    });
    const covering = rows.filter(({ point }) => point === "/" || path === point || path.startsWith(`${point}/`));
    if (covering.length !== 1 || covering[0]!.point !== "/" || covering[0]!.fields[3] !== "/") return refuse();
    roots.push(covering[0]!.line);
  }
  if (roots.some(root => root !== roots[0])) return refuse();
  return roots[0]!;
}

async function configurationEvidence(host: StorageHost, started: number, proc: string) {
  const evidence = new Map<string, string>();
  const seen = new Set<string>();
  async function inspect(path: string, kind: "file" | "directory", checkTime = true) {
    const value = await host.metadata(path);
    if (!value && kind === "directory") return refuse();
    if (value && (value.kind !== kind || value.uid !== 0 || !Number.isInteger(value.mode) || (value.mode & 0o022) !== 0 ||
        checkTime && (!Number.isFinite(value.ctimeMs) || value.ctimeMs + 1000 >= started))) return refuse();
    evidence.set(path, value?.identity ?? "missing");
    return value;
  }
  async function visit(path: string, imported = false): Promise<void> {
    // Literal absolute imports only: glob/relative resolution is not qualified.
    if (!absoluteStoragePath(path) || /[*?\[\]{}\\]/.test(path) || posix.normalize(path) !== path || seen.has(path) || seen.size >= 64) return refuse();
    seen.add(path);
    evidence.set(`mount:${path}`, await inputMount(host, proc, path));
    // Only the OWN containing directory must predate startup. Higher ancestors
    // must remain real root-owned, non-writable directories, regardless of ctime.
    for (let parent = posix.dirname(path);; parent = posix.dirname(parent)) {
      await inspect(parent, "directory", parent === posix.dirname(path));
      if (parent === "/") break;
    }
    if (!await inspect(path, "file")) { if (imported) return refuse(); return; }
    const config = parseContainerdConfig(await host.read(path));
    const imports = config.imports ?? [];
    if (!Array.isArray(imports)) return refuse();
    for (const entry of imports) {
      if (typeof entry !== "string") return refuse();
      await visit(entry, true);
    }
  }
  await visit("/etc/containerd/config.toml");
  return canonical(Object.fromEntries(evidence));
}

export async function containerdStorage(info: { Driver?: unknown; Containerd?: unknown }, cwd: string,
  run = command, host = storageHost(run, cwd)) {
  try {
    const address = table(info.Containerd).Address;
    if (info.Driver !== "overlayfs" || !absoluteStoragePath(address)) return refuse();
    const pid = (await run(["systemctl", "show", "containerd.service", "--property=MainPID", "--value"], cwd)).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) return refuse();
    const proc = `/proc/${pid}`, stat = await host.read(`${proc}/stat`);
    const argv = (await host.read(`${proc}/cmdline`)).split("\0").filter(Boolean);
    if (argv.length !== 1 || !/(^|\/)containerd$/.test(argv[0]!)) return refuse();
    const exe = await host.link(`${proc}/exe`);
    if (!absoluteStoragePath(exe) || !exe.endsWith("/containerd")) return refuse();
    const namespace = await host.link("/proc/self/ns/mnt");
    if (!/^mnt:\[\d+\]$/.test(namespace) || await host.link(`${proc}/ns/mnt`) !== namespace || await host.link(`${proc}/root`) !== "/") return refuse();
    const sockets = await run(["sudo", "-n", "ss", "-H", "-xlpn"], cwd);
    const owners = sockets.split("\n").filter(line => line.trim().split(/\s+/)[4] === address);
    if (owners.length !== 1 || !owners[0]!.includes("LISTEN") ||
        [...owners[0]!.matchAll(/pid=(\d+),/g)].map(match => match[1]).some(owner => owner !== pid) ||
        !owners[0]!.includes(`pid=${pid},`)) return refuse();
    const docker = await dockerdEvidence(cwd, run, host, address, pid);
    const bootStat = await host.read("/proc/stat"), ticks = await run(["getconf", "CLK_TCK"], cwd);
    const reconstructed = daemonStartMilliseconds(stat, bootStat, ticks);
    // systemd captured realtime when it created this process. A later boot-epoch
    // correction must not move the cutoff forward and qualify a post-start file.
    const startCommand = ["systemctl", "show", "containerd.service", "--property=ExecMainStartTimestamp", "--value", "--timestamp=unix"];
    const recorded = (await run(startCommand, cwd)).trim();
    if (!/^@\d+(\.\d+)?$/.test(recorded)) return refuse();
    const started = Number(recorded.slice(1)) * 1000;
    if (!Number.isFinite(started) || Math.abs(reconstructed - started) > 1000) return refuse();
    const before = await configurationEvidence(host, started, proc);
    // Execute the live inode through proc, even if PATH now resolves another binary.
    const defaults = parseContainerdConfig(await run(["sudo", "-n", `${proc}/exe`, "config", "default"], cwd));
    const dump = parseContainerdConfig(await run(["sudo", "-n", `${proc}/exe`, "config", "dump"], cwd));
    const paths = qualifiedContainerdPaths(dump, defaults, address);
    if (await configurationEvidence(host, started, proc) !== before || await host.link(`${proc}/exe`) !== exe ||
        await dockerdEvidence(cwd, run, host, address, pid) !== docker ||
        daemonStartMilliseconds(await host.read(`${proc}/stat`), await host.read("/proc/stat"), ticks) !== reconstructed ||
        (await run(startCommand, cwd)).trim() !== recorded ||
        await host.link(`${proc}/ns/mnt`) !== namespace ||
        (await run(["systemctl", "show", "containerd.service", "--property=MainPID", "--value"], cwd)).trim() !== pid) return refuse();
    console.log(`Release containerd instance: ${canonical({ pid, started, exe, namespace, address, docker })}`);
    return paths;
  } catch { return refuse(); }
}
