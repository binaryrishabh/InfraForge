import { readFileSync, readdirSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";

export function read(path: string) { try { return readFileSync(path, "utf8"); } catch { return null; } }
export function telemetry() {
  return {
    atUs: performance.now() * 1000, cpu: process.cpuUsage(), memory: process.memoryUsage(),
    fdCount: (() => { try { return readdirSync("/proc/self/fd").length; } catch { return null; } })(),
    cpuStat: read("/sys/fs/cgroup/cpu.stat"), cpuPressure: read("/sys/fs/cgroup/cpu.pressure"),
    memoryCurrent: read("/sys/fs/cgroup/memory.current"), memoryEvents: read("/sys/fs/cgroup/memory.events"),
    ioStat: read("/sys/fs/cgroup/io.stat"), ioPressure: read("/sys/fs/cgroup/io.pressure"),
    sockets: read("/proc/net/sockstat"), netDev: read("/proc/net/dev"),
  };
}
export function environment() {
  return { bun: Bun.version, versions: process.versions, kernel: release(), cpu: cpus()[0]?.model ?? null,
    visibleLogicalCpus: cpus().length, visibleRam: totalmem(), topology: read("/proc/cpuinfo"),
    cpuMax: read("/sys/fs/cgroup/cpu.max"), cpuset: read("/sys/fs/cgroup/cpuset.cpus.effective"),
    memoryMax: read("/sys/fs/cgroup/memory.max"), mounts: read("/proc/mounts"),
    clock: "performance.now monotonic microseconds; process-local origins; never subtract across processes",
  };
}
