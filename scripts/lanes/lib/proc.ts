import { spawnSync } from "node:child_process";
import { ROOT } from "./config";
import type { Current } from "./state";

export const sh = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { cwd, encoding: "utf8" });
export const git = (wt: string, ...args: string[]) => sh("git", ["-C", `${ROOT}/${wt}`, ...args]).stdout.trim();
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A pid only counts if its command line is what we recorded, so a recycled pid is never trusted.
export function aliveAs(pid: number, needle: RegExp): boolean {
  if (!pid) return false;
  const r = sh("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`]);
  return needle.test(r.stdout);
}
export const workerAlive = (c: Current) =>
  aliveAs(c.pid, c.script ? new RegExp(c.script.replace(/^.*[\\/]/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : /detached-/);
