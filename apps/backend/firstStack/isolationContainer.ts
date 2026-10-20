import { FIRST_STACK_ISOLATION as limits, executorName, imagePattern } from "./isolationPolicy";

export function firstStackContainerArguments(image: string, token: string, name = executorName) {
  if (!imagePattern.test(image) || !/^[a-f0-9-]{36}$/.test(token) ||
    name !== executorName) throw Error("Invalid first-stack container identity");
  return ["create", "--pull=never", "--name", name, "--label", `infraforge.first-stack=${token}`,
    "--interactive", "--init", "--network=none", "--cgroupns=private", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--user=1000:1000", "--log-driver=none",
    `--memory=${limits.memoryBytes}`, `--memory-swap=${limits.memoryBytes}`, "--cpus=0.5",
    `--pids-limit=${limits.pids}`, `--ulimit=nofile=${limits.nofile}:${limits.nofile}`,
    `--ulimit=cpu=${limits.cpuSeconds}:${limits.cpuSeconds}`, "--ulimit=core=0:0",
    `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${limits.tmpBytes}`,
    "--workdir=/app/apps/backend", "--env=NODE_ENV=test", "--env=HOME=/tmp", "--entrypoint=timeout",
    image, "--signal=KILL", "--kill-after=1s", `${limits.wallSeconds}s`,
    "bun", "--no-env-file", "--no-install", "firstStack/isolationChild.ts"];
}
export function verifyFirstStackContainer(value: any, image: string, token: string, name = executorName) {
  const host = value?.HostConfig, config = value?.Config;
  const has = (key: string, amount: number) => host?.Ulimits?.some((u: any) => u.Name === key && u.Soft === amount && u.Hard === amount);
  const command = firstStackContainerArguments(image, token, name).slice(-7);
  if (value?.Image !== image || value?.Name !== `/${name}` || config?.Labels?.["infraforge.first-stack"] !== token ||
    config?.User !== "1000:1000" || JSON.stringify(config.Entrypoint) !== '["timeout"]' ||
    JSON.stringify(config.Cmd) !== JSON.stringify(command) || config.WorkingDir !== "/app/apps/backend" ||
    config.Env?.some((v: string) => !/^(PATH|HOME|NODE_ENV|BUN_INSTALL|BUN_INSTALL_BIN|LANG|LC_ALL)=/.test(v) && v !== "BUN_RUNTIME_TRANSPILER_CACHE_PATH=0") ||
    host?.Memory !== limits.memoryBytes || host.MemorySwap !== limits.memoryBytes || host.NanoCpus !== limits.nanoCpus ||
    host.PidsLimit !== limits.pids || host.NetworkMode !== "none" || !host.ReadonlyRootfs || !host.Init ||
    host.Privileged || host.Binds?.length || host.CapAdd?.length || host.Devices?.length ||
    host.PidMode || host.IpcMode === "host" || host.CgroupnsMode !== "private" ||
    host.LogConfig?.Type !== "none" || value.Mounts?.some((m: any) => m.Type !== "tmpfs") ||
    JSON.stringify(host.CapDrop) !== '["ALL"]' || !host.SecurityOpt?.includes("no-new-privileges=true") ||
    host.Tmpfs?.["/tmp"] !== `rw,noexec,nosuid,nodev,size=${limits.tmpBytes}` ||
    !has("nofile", limits.nofile) || !has("cpu", limits.cpuSeconds) || !has("core", 0)) throw Error("First-stack container enforcement inspection failed");
  return { id: value.Id as string, image, token, memory: host.Memory as number, nanoCpus: host.NanoCpus as number };
}
export function verifyFirstStackReady(frame: any, source: string) {
  const e = frame?.enforcement, cpu = String(e?.cpu).split(/\s+/).map(Number);
  if (frame?.kind !== "ready" || frame.source !== source || e?.memory !== String(limits.memoryBytes) ||
    e.swap !== "0" || e.pids !== String(limits.pids) || e.uid !== 1000 || e.gid !== 1000 ||
    cpu.length !== 2 || cpu[0] !== 50_000 || cpu[1] !== 100_000 ||
    !/Max cpu time\s+20\s+20\s+seconds/.test(e.limits) || !/Max open files\s+128\s+128/.test(e.limits) ||
    !/NoNewPrivs:\s+1/.test(e.status) || !/CapEff:\s+0+\s/.test(e.status)) throw Error("First-stack kernel containment handshake failed");
}
