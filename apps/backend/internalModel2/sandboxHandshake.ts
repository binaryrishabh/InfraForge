import { readFileSync } from "node:fs";
import { executionSource } from "./identity";
export function sandboxReady() {
  const cgroup = (name: string) => readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
  return { kind: "ready", source: executionSource, enforcement: {
    memory: cgroup("memory.max"), swap: cgroup("memory.swap.max"), cpu: cgroup("cpu.max"), pids: cgroup("pids.max"),
    uid: process.getuid!(), env: Object.keys(process.env).sort(), limits: readFileSync("/proc/self/limits", "utf8"),
  } };
}
