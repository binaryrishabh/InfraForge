import { access, lstat, readFile, readdir, readlink, realpath, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, release, arch } from "node:os";
import { join } from "node:path";
import { command } from "./command";
import type { Snapshot } from "./policy";
export async function collect(image: string): Promise<Snapshot> {
  const s: Snapshot = { platform: process.platform, uid: process.getuid?.(), kernel: release(), arch: arch() };
  if (process.platform !== "linux" || !s.uid) return s;
  const runtime = `/run/user/${s.uid}`, socket = `${runtime}/docker.sock`, endpoint = `unix://${socket}`;
  // Failed reads stay Unknown. Raw errors, hostnames, environment values, command
  // lines and daemon IDs are deliberately absent from the retained snapshot.
  const attempt = async (read: () => Promise<void>) => { try { await read(); } catch { /* Unknown */ } };
  await attempt(async () => {
    const sock = await lstat(socket), directory = await lstat(runtime);
    s.socket = { owner: sock.uid, runtimeOwner: directory.uid, mode: sock.mode & 0o777, runtimeMode: directory.mode & 0o777,
      canonical: await realpath(socket) === socket && await realpath(runtime) === runtime, isSocket: sock.isSocket() };
  });
  await attempt(async () => {
    const context = JSON.parse(await command("docker", ["context", "inspect"]));
    let rootfulAccessible = false;
    try { await access("/var/run/docker.sock", constants.R_OK | constants.W_OK); rootfulAccessible = true; } catch (e) { if (!["ENOENT", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; }
    s.endpoint = { matches: context.length === 1 && context[0]?.Endpoints?.docker?.Host === endpoint,
      overrides: Object.keys(process.env).some((key) => /^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)$/.test(key)), rootfulAccessible };
  });
  const docker = (args: string[]) => command("docker", ["--host", endpoint, ...args]);
  let dataRoot = "", serviceGroup = "";
  await attempt(async () => {
    const info = JSON.parse(await docker(["info", "--format", "{{json .}}"])); dataRoot = info.DockerRootDir;
    s.daemon = { rootless: info.SecurityOptions?.includes("name=rootless") === true, cgroupVersion: info.CgroupVersion,
      driver: info.CgroupDriver, version: info.ServerVersion, kernel: info.KernelVersion, logging: info.LoggingDriver };
  });
  await attempt(async () => {
    const version = JSON.parse(await docker(["version", "--format", "{{json .Server}}"]));
    if (s.daemon) s.daemon.components = version.Components.filter((c: any) => ["Engine", "containerd", "runc", "docker-init"].includes(c.Name)).map((c: any) => ({ name: c.Name, version: c.Version }));
  });
  await attempt(async () => {
    const values = Object.fromEntries((await command("systemctl", ["--user", "show", "docker.service", "--property=ActiveState,Delegate,ControlGroup"], true)).split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
    serviceGroup = values.ControlGroup ?? "";
    if (!serviceGroup.startsWith(`/user.slice/user-${s.uid}.slice/`) || serviceGroup.includes("..")) throw Error("Unexpected service group");
    const userGroup = `/user.slice/user-${s.uid}.slice/user@${s.uid}.service`;
    const controllers = (await readFile(`/sys/fs/cgroup${userGroup}/cgroup.controllers`, "utf8")).trim().split(/\s+/);
    s.service = { active: values.ActiveState!, delegate: values.Delegate!, controllers };
  });
  await attempt(async () => {
    const pids: string[] = [];
    for (const pid of await readdir("/proc")) if (/^\d+$/.test(pid)) {
      try { if ((await lstat(`/proc/${pid}`)).uid === s.uid && (await readFile(`/proc/${pid}/comm`, "utf8")).trim() === "dockerd") pids.push(pid); } catch { /* Process may exit. */ }
    }
    if (pids.length !== 1 || !serviceGroup) throw Error("One owned daemon required");
    const pid = pids[0]!, group = (await readFile(`/proc/${pid}/cgroup`, "utf8")).trim();
    s.owner = { uid: (await lstat(`/proc/${pid}`)).uid, namespaceSeparated: await readlink(`/proc/${pid}/ns/user`) !== await readlink("/proc/self/ns/user"),
      serviceMember: group === `0::${serviceGroup}` || group.startsWith(`0::${serviceGroup}/`) };
  });
  await attempt(async () => {
    const value = JSON.parse(await docker(["image", "inspect", image]))[0], labels = value.Config?.Labels;
    s.image = { id: value.Id, revision: labels?.["org.opencontainers.image.revision"], source: labels?.["org.opencontainers.image.source"], volumes: Object.keys(value.Config?.Volumes ?? {}).length !== 0 };
  });
  await attempt(async () => {
    if (!dataRoot || !dataRoot.startsWith(homedir() + "/")) throw Error("Owned data root required");
    const data = await lstat(dataRoot), fs = await statfs(dataRoot);
    if (data.uid !== s.uid || data.mode & 0o022) throw Error("Private owned data root required");
    const memory = /^MemAvailable:\s+(\d+) kB$/m.exec(await readFile("/proc/meminfo", "utf8"));
    if (!memory) throw Error("Available memory is Unknown");
    s.capacity = { memoryAvailable: Number(memory?.[1]) * 1024, diskAvailable: Number(fs.bavail) * Number(fs.bsize), localDisk: Number(fs.type) !== 0x6969 };
  });
  await attempt(async () => { s.containers = (await docker(["ps", "--all", "--quiet"])).split("\n").filter(Boolean).length; });
  await attempt(async () => {
    let config: Record<string, any> = {};
    try { config = JSON.parse(await readFile(join(homedir(), ".config/docker/daemon.json"), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    // Local driver rotates by default; arbitrary daemon config paths/listeners
    // still need the separate control-plane review, never inferred here.
    s.logs = { bounded: s.daemon?.logging === "local" && config["log-opts"] === undefined, driver: s.daemon?.logging ?? "Unknown" };
  });
  return s;
}
