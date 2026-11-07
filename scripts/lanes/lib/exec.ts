import { spawnSync } from "node:child_process";

export type Ran = { stdout: string; stderr: string; status: number | null; timedOut: boolean; error: string };

// Every external call is bounded: a hung Windows process query or PowerShell start must never freeze the controller.
// stdin is closed so nothing can wait for interactive input; the child is killed when the bound is reached.
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Ran {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", timeout: opts.timeoutMs ?? 60_000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const err = r.error as (NodeJS.ErrnoException & { code?: string }) | undefined;
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status, timedOut: err?.code === "ETIMEDOUT" || (r.signal !== null && r.status === null && !!opts.timeoutMs && r.signal === "SIGKILL"), error: err ? `${err.code ?? "error"}: ${err.message}` : "" };
}
