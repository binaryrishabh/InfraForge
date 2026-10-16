import type { DockerConnection } from "./dockerConnection";
import { LESSON_SANDBOX as limits } from "./lessonLimits";
export const containerName = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid sandbox identity");
  return `infraforge-model2-${id}`;
};
export function createArguments(name: string, image: string, origin?: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error("An immutable installed image ID is required");
  if (origin && !/^[a-f0-9-]{36}$/.test(origin)) throw Error("Invalid originating run");
  return ["create", "--pull=never", "--name", name, "--label", `infraforge.model2=${name}`, ...(origin ? ["--label", `infraforge.model2.origin=${origin}`] : []), "--interactive", "--init", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--user=1000:1000",
    `--memory=${limits.memoryBytes}`, `--memory-swap=${limits.memoryBytes}`, "--cpus=1", `--pids-limit=${limits.pids}`, `--ulimit=nofile=${limits.nofile}:${limits.nofile}`, `--ulimit=cpu=${limits.cpuSeconds}:${limits.cpuSeconds}`, "--ulimit=core=0:0", "--tmpfs=/tmp:rw,noexec,nosuid,size=16777216", "--workdir=/app/apps/backend",
    "--env=NODE_ENV=test", "--env=HOME=/tmp", image, "timeout", "--signal=KILL", "--kill-after=1s", `${limits.wallSeconds}s`, "bun", "--no-env-file", "--no-install", "internalModel2/sandboxChild.ts"];
}
export function verifyContainer(value: any, name: string, image: string) {
  const host = value?.HostConfig, config = value?.Config, u = host?.Ulimits;
  const has = (name: string, n: number) => Array.isArray(u) && u.some((v: any) => v.Name === name && v.Soft === n && v.Hard === n);
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || value?.Image !== image || value?.Name !== `/${name}` || config?.Labels?.["infraforge.model2"] !== name ||
    config.User !== "1000:1000" || host.Memory !== limits.memoryBytes || host.MemorySwap !== limits.memoryBytes || host.NanoCpus !== limits.nanoCpus || host.PidsLimit !== limits.pids ||
    host.NetworkMode !== "none" || !host.ReadonlyRootfs || !host.Init || host.Privileged || host.Binds?.length || value.Mounts?.some((m: any) => m.Type !== "tmpfs") ||
    JSON.stringify(host.CapDrop) !== '["ALL"]' || !host.SecurityOpt?.includes("no-new-privileges=true") || !has("nofile", limits.nofile) || !has("cpu", limits.cpuSeconds) || !has("core", 0)) throw Error("Sandbox enforcement inspection failed before execution");
  return { container: value.Id, image, memoryBytes: host.Memory, memorySwapBytes: host.MemorySwap, nanoCpus: host.NanoCpus, pids: host.PidsLimit, nofile: limits.nofile, cpuSeconds: limits.cpuSeconds, network: host.NetworkMode, readOnly: true, uid: config.User, capabilities: host.CapDrop, security: host.SecurityOpt };
}
export const inspectContainer = async (control: DockerConnection, id: string) => JSON.parse(await control.run(["inspect", id]))[0];
export async function removeContainer(control: DockerConnection, name: string, image: string) {
  try {
    const value = await inspectContainer(control, name);
    if (value.Config?.Labels?.["infraforge.model2"] !== name || value.Image !== image) throw Error("Refusing to remove an unrelated container");
    await control.run(["rm", "--force", value.Id]);
  } catch (error) {
    // A missing container is already reaped. Other cleanup failures remain visible.
    if ((await control.run(["ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])).length) throw error;
  }
}
