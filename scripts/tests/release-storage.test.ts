import { expect, test } from "bun:test";
import { preflightReleaseSpace, minimumReleaseFreeBytes } from "../release/hygiene";
import { daemonStartMilliseconds, localDockerEnvironment, parseContainerdConfig, type StorageHost } from "../release/storage";

const address = "/run/containerd/containerd.sock";
const info = { DockerRootDir: "/var/lib/docker", Driver: "overlayfs", DriverStatus: [["driver-type", "io.containerd.snapshotter.v1"]],
  SecurityOptions: ["name=seccomp,profile=builtin"], Containerd: { Address: address } };
const dump = `version = 3
root = '/var/lib/containerd'
state = '/run/containerd'
[grpc]
address = '${address}'
[plugins.'io.containerd.snapshotter.v1.overlayfs']
root_path = ''
[plugins.'io.containerd.content.v1.content']
`;
const procStat = `812 (containerd) S ${Array(18).fill("0").join(" ")} 10000 0`;
type Change = { info?: object; dump?: string; defaults?: string; pid?: string; argv?: string; exe?: string; namespace?: string;
  sockets?: string; context?: string; endpoint?: string; ctime?: number; config?: string; missing?: boolean; parentCtime?: number;
  importedCtime?: number; fail?: string; duringDump?: boolean; restart?: boolean; importMissing?: boolean; symlink?: boolean };
function host(change: Change = {}) {
  const calls: string[][] = [], paths: string[] = [];
  let dumped = false, systemCalls = 0;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.join(" ").includes(change.fail ?? "NEVER")) throw new Error("PRIVATE_CONFIG_MARKER");
    if (args[1] === "context") return args[2] === "show" ? change.context ?? "default" : JSON.stringify([
      { Name: "default", Endpoints: { docker: { Host: change.endpoint ?? "unix:///var/run/docker.sock" } } }]);
    if (args[0] === "docker") return JSON.stringify({ ...info, ...change.info });
    if (args[0] === "systemctl") return change.restart && systemCalls++ > 0 ? "813" : change.pid ?? "812";
    if (args[0] === "getconf") return "100";
    if (args[2] === "ss") return change.sockets ?? `u_str LISTEN 0 4096 ${address} 123 * 0 users:(("containerd",pid=812,fd=9))`;
    if (args.join(" ") === "sudo -n /proc/812/exe config default") return change.defaults ?? dump;
    if (args.join(" ") === "sudo -n /proc/812/exe config dump") { dumped = true; return change.dump ?? dump; }
    throw new Error("Unexpected command");
  };
  const io: StorageHost = {
    async read(path) {
      if (path.includes(change.fail ?? "NEVER")) throw new Error("PRIVATE_CONFIG_MARKER");
      if (path === "/proc/stat") return "btime 1000\n";
      if (path.endsWith("/stat")) return procStat;
      if (path.endsWith("/cmdline")) return change.argv ?? "/usr/bin/containerd\0";
      if (path === "/etc/containerd/config.toml") return change.config ?? "version = 3";
      if (path === "/etc/containerd/import.toml") return "version = 3";
      throw new Error("Unexpected read");
    },
    async link(path) {
      if (path.endsWith("/exe")) return change.exe ?? "/usr/bin/containerd";
      if (path === "/proc/self/ns/mnt") return "mnt:[123]";
      if (path.endsWith("/ns/mnt")) return change.namespace ?? "mnt:[123]";
      if (path.endsWith("/root")) return "/";
      throw new Error("Unexpected link");
    },
    async metadata(path) {
      if (path.endsWith("config.toml") && change.missing || path.endsWith("import.toml") && change.importMissing) return undefined;
      const file = path.endsWith(".toml");
      return { kind: change.symlink && file ? "other" : file ? "file" : "directory",
        ctimeMs: file ? dumped && change.duringDump ? 1200000 : path.endsWith("import.toml") ? change.importedCtime ?? 900000 : change.ctime ?? 900000 : change.parentCtime ?? 900000,
        identity: dumped && change.duringDump ? "changed" : path };
    },
  };
  const preflight = (env: Record<string, string | undefined> = {}) => preflightReleaseSpace(".", process.cwd(), run,
    async path => { paths.push(path); return minimumReleaseFreeBytes; }, io, env);
  return { run, io, calls, paths, preflight };
}

test("qualified containerd uses the live executable, provenance and each real storage filesystem", async () => {
  const h = host(); await h.preflight();
  expect(h.paths).toEqual(["/var/lib/docker", "/var/lib/containerd", "/var/lib/containerd/io.containerd.content.v1.content",
    "/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs", process.cwd()]);
  expect(h.calls).toContainEqual(["sudo", "-n", "/proc/812/exe", "config", "dump"]);
  expect(h.calls.some(args => args[2] === "containerd")).toBe(false);
  expect(daemonStartMilliseconds(procStat, "btime 1000", "100")).toBe(1100000);
  await host({ exe: "/opt/containerd/bin/containerd" }).preflight();
  await host({ missing: true }).preflight(); // Proven absent default config means executable defaults.
  await host({ config: "imports = ['/etc/containerd/import.toml']" }).preflight();
});

const refusals: [string, Change][] = [
  ["staged config after daemon start", { ctime: 1200000 }],
  ["config timestamp in uncertain start second", { ctime: 1099500 }],
  ["changed imported config", { config: "imports = ['/etc/containerd/import.toml']", importedCtime: 1200000 }],
  ["deleted default after daemon start", { missing: true, parentCtime: 1200000 }],
  ["changed config during dump", { duringDump: true }],
  ["missing import", { config: "imports = ['/etc/containerd/import.toml']", importMissing: true }],
  ["glob import", { config: "imports = ['/etc/containerd/*.toml']" }],
  ["relative import", { config: "imports = ['import.toml']" }],
  ["cyclic import", { config: "imports = ['/etc/containerd/config.toml']" }],
  ["symlinked config", { symlink: true }],
  ["deleted executable", { exe: "/usr/bin/containerd (deleted)" }],
  ["unrelated executable", { exe: "/usr/bin/other" }],
  ["restarted daemon", { restart: true }],
  ["different mount namespace", { namespace: "mnt:[456]" }],
  ["different socket owner", { sockets: `u_str LISTEN 0 4096 ${address} 123 * 0 users:(("containerd",pid=999,fd=9))` }],
  ["socket owner without process evidence", { sockets: `u_str LISTEN 0 4096 ${address} 123 * 0` }],
  ["socket suffix is not the socket", { sockets: `u_str LISTEN 0 4096 ${address}.other 123 * 0 users:(("containerd",pid=812,fd=9))` }],
  ["remote context with identical storage path strings", { context: "production-on-another-host" }],
  ["remote default endpoint", { endpoint: "ssh://other-host" }],
  ["rootless containerd layout", { info: { SecurityOptions: ["name=rootless"] } }],
  ["rootless classic layout", { info: { Driver: "overlay2", DriverStatus: [], SecurityOptions: ["name=rootless"] } }],
  ["missing security options", { info: { SecurityOptions: null } }],
  ["systemctl failure", { fail: "systemctl" }],
  ["unreadable cmdline", { fail: "cmdline" }],
  ["dump failure", { fail: "config dump" }],
  ["invalid PID", { pid: "0" }],
  ["non-numeric PID", { pid: "12 13" }],
  ["flagged daemon", { argv: "/usr/bin/containerd\0--root\0/data\0" }],
  ["wrong daemon argv", { argv: "/usr/bin/dockerd\0" }],
  ["non-default snapshotter", { info: { Driver: "native" } }],
  ["duplicate driver type", { info: { DriverStatus: [["driver-type", "io.containerd.snapshotter.v1"], ["driver-type", "other"]] } }],
  ["matching relative socket strings", { info: { Containerd: { Address: "relative.sock" } }, dump: dump.replace(address, "relative.sock") }],
  ["socket mismatch", { dump: dump.replace(address, "/run/other.sock") }],
  ["socket traversal", { info: { Containerd: { Address: "/run/../containerd.sock" } }, dump: dump.replace(address, "/run/../containerd.sock") }],
  ["relative root", { dump: dump.replace("/var/lib/containerd", "relative/root") }],
  ["slash-only root", { dump: dump.replace("/var/lib/containerd", "////") }],
  ["parent traversal root", { dump: dump.replace("/var/lib/containerd", "/var/../lib/containerd") }],
  ["typed root", { dump: dump.replace("'/var/lib/containerd'", "123") }],
  ["control character root", { dump: dump.replace("'/var/lib/containerd'", '"/var/lib/\\u0000containerd"') }],
  ["active overlay override despite roomy stale default", { dump: dump.replace("root_path = ''", "root_path = '/snapshots/full'") }],
  ["content override", { dump: dump + "root = '/content/full'\n" }],
  ["proxy provider", { dump: dump + "[proxy_plugins.overlayfs]\ntype = 'snapshot'\naddress = '/proxy.sock'\n" }],
  ["unknown storage key", { dump: "storage_root = '/full'\n" + dump }],
  ["unknown plugin storage key", { dump: dump + "future_storage = '/full'\n" }],
  ["plugin replacement", { dump: dump.replace("io.containerd.content.v1.content", "io.containerd.content.v2.content") }],
  ["duplicate TOML key", { dump: "root = '/wrong/roomy'\n" + dump }],
  ["duplicate TOML table", { dump: dump + "[grpc]\naddress = '/run/other.sock'\n" }],
  ["multiline forged grpc header", { dump: dump.replace(address, "/run/actual.sock") + `note = '''\n[grpc]\naddress = '${address}'\n'''` }],
  ["multiline state cannot forge root", { dump: dump.replace("state = '/run/containerd'", "state = '''\nroot = '/wrong/roomy'\n'''") }],
  ["array-table cannot forge missing top-level root", { dump: dump.replace("root = '/var/lib/containerd'", "") + "\n[[unrelated]]\nroot = '/wrong/roomy'\n" }],
  ["commented table cannot forge root", { dump: dump.replace("root = '/var/lib/containerd'", "") + "\n[unrelated] # comment\nroot = '/wrong/roomy'\n" }],
];
for (const [name, change] of refusals) test(`storage refuses ${name}`, async () => {
  const h = host(change);
  let caught: unknown;
  try { await h.preflight(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain("Unknown");
  expect(Bun.inspect(caught)).not.toContain("PRIVATE_CONFIG_MARKER");
  expect(h.paths).toEqual([]);
});

test("valid TOML syntax preserves field meaning and suppresses parser diagnostics", async () => {
  for (const value of [dump.replaceAll("\n", "\r\n"), dump.replace("root =", '"root" ='),
    dump.replace(`[grpc]\naddress = '${address}'`, "").replace("version = 3", `version = 3\ngrpc = { address = '${address}' }`)]) {
    await host({ dump: value }).preflight();
  }
  const parsed = parseContainerdConfig("root = '/actual/full'\nstate = '''\nroot = '/wrong/roomy'\n'''\n[[unrelated]]\nroot = '/also/wrong'");
  expect(parsed.root).toBe("/actual/full");
  let error: unknown;
  try { parseContainerdConfig("PRIVATE_CONFIG_MARKER = = ="); } catch (caught) { error = caught; }
  expect(Bun.inspect(error)).not.toContain("PRIVATE_CONFIG_MARKER");
  expect((error as Error).cause).toBeUndefined();
});

test("Docker environment rejects remote overrides and pins all ordinary release calls locally", async () => {
  for (const env of [{ DOCKER_HOST: "ssh://other" }, { DOCKER_CONTEXT: "other" }, { DOCKER_TLS_VERIFY: "1" }]) {
    await expect(host().preflight(env)).rejects.toThrow("Unknown");
  }
  expect(localDockerEnvironment({ DOCKER_CONTEXT: "default" })).toMatchObject({ DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: undefined });
});

test("each containerd storage path independently refuses low, missing and unreadable capacity", async () => {
  for (const target of ["/var/lib/containerd", "/var/lib/containerd/io.containerd.content.v1.content", "/var/lib/containerd/io.containerd.snapshotter.v1.overlayfs"]) {
    for (const failure of ["low", "ENOENT", "EACCES"]) {
      const h = host();
      await expect(preflightReleaseSpace(".", process.cwd(), h.run, async path => {
        if (path !== target) return minimumReleaseFreeBytes;
        if (failure === "low") return 7n;
        throw Object.assign(new Error("unavailable"), { code: failure });
      }, h.io, {})).rejects.toThrow(failure === "low" ? "7 bytes available" : "Unknown");
    }
  }
});
