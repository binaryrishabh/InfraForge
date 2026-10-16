import { spawn } from "node:child_process";
import { constants } from "node:os";

// Register the exit observer at spawn time. The harness must reap real exits,
// including signal deaths, rather than depend on a later Bun.exited getter.
export function spawnOwned(command: string[], options: { cwd: string; env: Record<string, string> }) {
  if (!command.length) throw Error("Missing owned process command");
  const child = spawn(command[0]!, command.slice(1), { ...options, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)));
  });
  void exited.catch(() => {});
  if (!child.pid) throw Error("Owned process could not start");
  return { pid: child.pid, exited, stdout: child.stdout, stderr: child.stderr,
    get exitCode() { return child.exitCode; }, get signalCode() { return child.signalCode; }, get killed() { return child.killed; },
    kill: (signal: NodeJS.Signals) => child.kill(signal) };
}
