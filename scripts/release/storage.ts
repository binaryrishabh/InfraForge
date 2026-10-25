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
  if (![2, 3].includes(dump.version as number) || dump.version !== defaults.version) return refuse();
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
  if (!absoluteStoragePath(base) || table(dump.grpc).address !== address || dump.state !== defaults.state) return refuse();
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

export type ConfigMetadata = { kind: "file" | "directory" | "other"; ctimeMs: number; identity: string };
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
        return { kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other",
          ctimeMs: value.ctimeMs, identity: `${value.dev}:${value.ino}:${value.size}:${value.ctimeMs}` };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
        const value = await run(["sudo", "-n", "stat", "--format=%F|%Z|%d:%i:%s:%z", "--", path], cwd);
        const [kind, seconds, identity] = value.split("|");
        if (!/^\d+$/.test(seconds ?? "") || !identity) return refuse();
        // stat's seconds are truncated: round UP before comparing with start.
        return { kind: kind === "regular file" ? "file" : kind === "directory" ? "directory" : "other",
          ctimeMs: (Number(seconds) + 1) * 1000, identity };
      }
    },
  };
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

async function configurationEvidence(host: StorageHost, started: number) {
  const evidence = new Map<string, string>();
  const seen = new Set<string>();
  async function inspect(path: string, kind: "file" | "directory") {
    const value = await host.metadata(path);
    if (value && (value.kind !== kind || !Number.isFinite(value.ctimeMs) || value.ctimeMs + 1000 >= started)) return refuse();
    evidence.set(path, value?.identity ?? "missing");
    return value;
  }
  async function visit(path: string, imported = false): Promise<void> {
    // Literal absolute imports only: glob/relative resolution is not qualified.
    if (!absoluteStoragePath(path) || /[*?\[\]{}\\]/.test(path) || posix.normalize(path) !== path || seen.has(path) || seen.size >= 64) return refuse();
    seen.add(path);
    // An absent default file means defaults ONLY when its directory ancestry was
    // unchanged before startup. This also catches deleted/replaced inputs.
    for (let parent = posix.dirname(path);; parent = posix.dirname(parent)) {
      await inspect(parent, "directory");
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
    const bootStat = await host.read("/proc/stat"), ticks = await run(["getconf", "CLK_TCK"], cwd);
    const started = daemonStartMilliseconds(stat, bootStat, ticks);
    const before = await configurationEvidence(host, started);
    // Execute the live inode through proc, even if PATH now resolves another binary.
    const defaults = parseContainerdConfig(await run(["sudo", "-n", `${proc}/exe`, "config", "default"], cwd));
    const dump = parseContainerdConfig(await run(["sudo", "-n", `${proc}/exe`, "config", "dump"], cwd));
    const paths = qualifiedContainerdPaths(dump, defaults, address);
    if (await configurationEvidence(host, started) !== before || await host.link(`${proc}/exe`) !== exe ||
        daemonStartMilliseconds(await host.read(`${proc}/stat`), bootStat, ticks) !== started ||
        await host.link(`${proc}/ns/mnt`) !== namespace ||
        (await run(["systemctl", "show", "containerd.service", "--property=MainPID", "--value"], cwd)).trim() !== pid) return refuse();
    return paths;
  } catch { return refuse(); }
}
