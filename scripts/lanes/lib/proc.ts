import { run, type Ran } from "./exec";
import { ROOT } from "./config";
import type { Current } from "./state";

export { run, type Ran };
export const sh = (cmd: string, args: string[], cwd?: string, timeoutMs?: number) => run(cmd, args, { cwd, timeoutMs });
export const git = (wt: string, ...args: string[]) => sh("git", ["-C", `${ROOT}/${wt}`, ...args]).stdout.trim();
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* Is `pid` the process we recorded? Cheap and definitive first (signal 0), then the command line to rule out a recycled pid.
A process query that fails or times out is "unknown", and unknown counts as alive: a loaded or exhausted machine must never make us
declare a live worker dead (or start a duplicate controller). Only a missing pid, or a command line that is clearly someone else's, is "not it". */
export function aliveAs(pid: number, needle: RegExp, probeMs = 25_000): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") return false; }
  const r = run("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`], { timeoutMs: probeMs });
  if (r.timedOut || r.error || r.status !== 0) return true;
  if (!r.stdout.trim()) return false;
  return needle.test(r.stdout);
}
export const workerAlive = (c: Current) =>
  aliveAs(c.pid, c.script ? new RegExp(c.script.replace(/^.*[\\/]/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : /detached-/);
