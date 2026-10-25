import { expect, test } from "bun:test";
import { preflightReleaseSpace, minimumReleaseFreeBytes } from "../release/hygiene";
import { daemonStartMilliseconds, localDockerEnvironment, parseContainerdConfig, type StorageHost } from "../release/storage";
import { dockerHost, dockerSockets } from "./fixtures/release-dockerd";

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
  importedCtime?: number; fail?: string; duringDump?: boolean; restart?: boolean; importMissing?: boolean; symlink?: boolean;
  production?: boolean; ancestor?: "writable" | "symlink" | "unowned" | "missing"; mount?: string; daemonMount?: string;
  mountDuringDump?: boolean; boot?: string; recorded?: string; dockerExe?: string; dockerNamespace?: string; dockerRoot?: string;
  dockerSockets?: string; dockerKind?: "file" | "other"; dockerRestart?: boolean; dockerUid?: number };
const rootMount = "29 1 259:1 / / rw,relatime - ext4 /dev/root rw";
function host(change: Change = {}) {
  const calls: string[][] = [], paths: string[] = [];
  let dumped = false, systemCalls = 0;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.join(" ").includes(change.fail ?? "NEVER")) throw new Error("PRIVATE_CONFIG_MARKER");
    if (args[1] === "context") return args[2] === "show" ? change.context ?? "default" : JSON.stringify([
      { Name: "default", Endpoints: { docker: { Host: change.endpoint ?? "unix:///var/run/docker.sock" } } }]);
    if (args[0] === "docker") return JSON.stringify({ ...info, ...change.info });
    if (args.includes("--property=ExecMainStartTimestamp")) return change.recorded ?? (change.production ? "@1792650086.62" : "@1100");
    if (args[0] === "systemctl") return change.restart && systemCalls++ > 0 ? "813" : change.pid ?? "812";
    if (args[0] === "getconf") return "100";
    if (args[2] === "ss") return args.includes("-xapn") ? change.dockerSockets ?? dockerSockets :
      change.sockets ?? `u_str LISTEN 0 4096 ${address} 123 * 0 users:(("containerd",pid=812,fd=9))`;
    if (args[3] === "config" && args[4] === "default") return change.defaults ?? dump;
    if (args[3] === "config" && args[4] === "dump") { dumped = true; return change.dump ?? dump; }
    throw new Error("Unexpected command");
  };
  const io: StorageHost = {
    async read(path) {
      if (path === "/proc/900/stat") return (await dockerHost.read(path)).replace("12000 0", dumped && change.dockerRestart ? "13000 0" : "12000 0");
      if (path.includes(change.fail ?? "NEVER")) throw new Error("PRIVATE_CONFIG_MARKER");
      if (path.endsWith("/mountinfo")) return path === "/proc/812/mountinfo" && change.daemonMount ? change.daemonMount :
        rootMount + (change.mount || dumped && change.mountDuringDump ? `\n55 29 259:1 /prepared ${change.mount ?? "/etc/containerd"} rw - ext4 /dev/root rw` : "");
      if (path === "/proc/stat") return change.boot ?? (change.production ? "btime 1792610199\n" : "btime 1000\n");
      if (path.endsWith("/stat")) return change.production ? procStat.replace("10000 0", "3988762 0") : procStat;
      if (path.endsWith("/cmdline")) return change.argv ?? "/usr/bin/containerd\0";
      if (path === "/etc/containerd/config.toml") return change.config ?? "version = 3";
      if (path === "/etc/containerd/import.toml") return "version = 3";
      throw new Error("Unexpected read");
    },
    async link(path) {
      if (path === "/proc/900/exe") return change.dockerExe ?? dockerHost.link(path);
      if (path === "/proc/900/ns/mnt") return change.dockerNamespace ?? dockerHost.link(path);
      if (path === "/proc/900/root") return change.dockerRoot ?? dockerHost.link(path);
      if (path === "/proc/1/exe") return dockerHost.link(path);
      if (path.endsWith("/exe")) return change.exe ?? "/usr/bin/containerd";
      if (path === "/proc/self/ns/mnt") return "mnt:[123]";
      if (path.endsWith("/ns/mnt")) return change.namespace ?? "mnt:[123]";
      if (path.endsWith("/root")) return "/";
      throw new Error("Unexpected link");
    },
    async metadata(path) {
      if (path.endsWith("docker.sock")) return { ...await dockerHost.metadata(path), kind: change.dockerKind ?? "socket" } as Awaited<ReturnType<StorageHost["metadata"]>>;
      if (path === "/proc/900") return { ...await dockerHost.metadata(path), uid: change.dockerUid ?? 0 } as Awaited<ReturnType<StorageHost["metadata"]>>;
      if (path.endsWith("config.toml") && change.missing || path.endsWith("import.toml") && change.importMissing) return undefined;
      const file = path.endsWith(".toml");
      if (path === "/etc" && change.ancestor === "missing") return undefined;
      if (path === "/etc" && change.ancestor) return { kind: change.ancestor === "symlink" ? "other" : "directory",
        uid: change.ancestor === "unowned" ? 1000 : 0, mode: change.ancestor === "writable" ? 0o777 : 0o755, ctimeMs: 900000, identity: path };
      return { kind: change.symlink && file ? "other" : file ? "file" : "directory",
        uid: 0, mode: file ? 0o644 : 0o755,
        ctimeMs: change.production ? (path === "/" ? 1792610207.998 : path === "/etc" ? 1792823033.81 : 1792610946.53) * 1000 :
          file ? dumped && change.duringDump ? 1200000 : path.endsWith("import.toml") ? change.importedCtime ?? 900000 : change.ctime ?? 900000 : change.parentCtime ?? 900000,
        identity: dumped && change.duringDump ? "changed" : path };
    },
  };
  const preflight = (env: Record<string, string | undefined> = {}) => preflightReleaseSpace(".", process.cwd(), run,
    async path => { paths.push(path); return path === "/snapshots/full" ? 7n : minimumReleaseFreeBytes; }, io, env);
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
  ["local socket forwarding to remote Docker", { dockerExe: "/usr/bin/socat" }],
  ["dockerd in another mount namespace", { dockerNamespace: "mnt:[456]" }],
  ["dockerd in another root", { dockerRoot: "/other" }],
  ["unprivileged dockerd", { dockerUid: 1000 }],
  ["Docker endpoint is a regular file", { dockerKind: "file" }],
  ["Docker endpoint is a symlink", { dockerKind: "other" }],
  ["Docker listener has no owner", { dockerSockets: dockerSockets.replace('users:(("dockerd",pid=900,fd=3))', "") }],
  ["dockerd connects to another containerd socket", { dockerSockets: dockerSockets.replaceAll(address, "/run/other.sock") }],
  ["dockerd peer belongs to another containerd", { dockerSockets: dockerSockets.replace("pid=812", "pid=999") }],
  ["dockerd peer inode does not match", { dockerSockets: dockerSockets.replace("402 * 401", "403 * 401") }],
  ["dockerd restarted during qualification", { dockerRestart: true }],
  ["replaced own directory", { parentCtime: 1200000 }],
  ["writable higher ancestor", { ancestor: "writable" }],
  ["symlinked higher ancestor", { ancestor: "symlink" }],
  ["unowned higher ancestor", { ancestor: "unowned" }],
  ["missing higher ancestor", { ancestor: "missing" }],
  ["old config bind-mounted after startup", { mount: "/etc/containerd/config.toml" }],
  ["old directory bind-mounted after startup", { mount: "/etc/containerd" }],
  ["higher ancestor mounted after startup", { mount: "/etc" }],
  ["old import bind-mounted after startup", { config: "imports = ['/etc/containerd/import.toml']", mount: "/etc/containerd/import.toml" }],
  ["daemon sees another mount ID", { daemonMount: rootMount.replace("29 1", "30 1") }],
  ["mount changes during dump", { mountDuringDump: true }],
  ["clock correction moves reconstructed startup forward", { boot: "btime 2000", ctime: 1150000 }],
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
  ["invalid PID", { pid: "0", sockets: `u_str LISTEN 0 4096 ${address} 123 * 0 users:(("containerd",pid=0,fd=9))` }],
  ["non-numeric PID", { pid: "12 13" }],
  ["flagged daemon", { argv: "/usr/bin/containerd\0--root\0/data\0" }],
  ["wrong daemon argv", { argv: "/usr/bin/dockerd\0" }],
  ["non-default snapshotter", { info: { Driver: "native" } }],
  ["duplicate driver type", { info: { DriverStatus: [["driver-type", "io.containerd.snapshotter.v1"], ["driver-type", "other"]] } }],
  ["matching relative socket strings", { info: { Containerd: { Address: "relative.sock" } }, dump: dump.replace(address, "relative.sock"),
    sockets: 'u_str LISTEN 0 4096 relative.sock 123 * 0 users:(("containerd",pid=812,fd=9))' }],
  ["socket mismatch", { dump: dump.replace(address, "/run/other.sock") }],
  ["socket traversal", { info: { Containerd: { Address: "/run/../containerd.sock" } }, dump: dump.replace(address, "/run/../containerd.sock") }],
  ["relative root", { dump: dump.replace("/var/lib/containerd", "relative/root") }],
  ["slash-only root", { dump: dump.replace("/var/lib/containerd", "////") }],
  ["parent traversal root", { dump: dump.replace("/var/lib/containerd", "/var/../lib/containerd") }],
  ["typed root", { dump: dump.replace("'/var/lib/containerd'", "123") }],
  ["control character root", { dump: dump.replace("'/var/lib/containerd'", '"/var/lib/\\u0000containerd"') }],
  ["active overlay override despite roomy stale default", { dump: dump.replace("root_path = ''", "root_path = '/snapshots/full'") }],
  ["nonempty overlay root even in executable defaults", { dump: dump.replace("root_path = ''", "root_path = '/snapshots/full'"),
    defaults: dump.replace("root_path = ''", "root_path = '/snapshots/full'") }],
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

test("exact production timestamps accept an unrelated later etc change", async () => {
  const h = host({ production: true });
  await h.preflight();
  expect(h.paths).toHaveLength(5);
  expect(daemonStartMilliseconds(procStat.replace("10000 0", "3988762 0"), "btime 1792610199", "100")).toBe(1792650086620);
});

test("classic overlay2 also rejects a forwarded or namespaced Docker endpoint", async () => {
  const classic = { Driver: "overlay2", DriverStatus: [] };
  await host({ info: classic }).preflight();
  for (const change of [{ dockerExe: "/usr/bin/socat" }, { dockerNamespace: "mnt:[456]" }]) {
    const h = host({ info: classic, ...change });
    await expect(h.preflight()).rejects.toThrow("Unknown");
    expect(h.paths).toEqual([]);
  }
});

test("Docker socket activation permits systemd alongside the verified dockerd", async () => {
  await host({ dockerSockets: dockerSockets.replace('pid=900,fd=3))', 'pid=900,fd=3),("systemd",pid=1,fd=4))') }).preflight();
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
