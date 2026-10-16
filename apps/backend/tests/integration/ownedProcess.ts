import { constants } from "node:os";
import { reapOwnedZombie } from "./linuxExit";

// Test-parent ownership only. Pinned Bun can miss a child exit after long runs;
// an owned Linux zombie is independently reaped, never relabelled as running.
export function spawnOwned(command: string[], options: { cwd: string; env: Record<string, string> }) {
  let code: number | null = null, signal: NodeJS.Signals | null = null, settled = false, observation = "pending";
  let resolve!: (code: number) => void, reject!: (error: unknown) => void;
  const exited = new Promise<number>((yes, no) => { resolve = yes; reject = no; }); void exited.catch(() => {});
  let polling: ReturnType<typeof setInterval> | undefined;
  const finish = (value: number, by: NodeJS.Signals | null) => { if (settled) return; settled = true; clearInterval(polling); code = value; signal = by; resolve(value); };
  const child = Bun.spawn(command, { ...options, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true,
    onExit(_child, exit, by, error) {
      if (settled) return;
      if (error) { settled = true; clearInterval(polling); reject(error); return; }
      const name = (typeof by === "number" ? Object.entries(constants.signals).find(([, value]) => value === by)?.[0] : by) as NodeJS.Signals | null;
      observation = "runtime exit callback";
      finish(exit ?? 128 + (name ? constants.signals[name] : 0), name ?? null);
    } });
  if (process.platform === "linux" && !settled) {
    polling = setInterval(() => {
      try { const result = reapOwnedZombie(child.pid); if (result) { observation = "owned Linux waitpid"; finish(result.code, result.signal); child.unref(); } }
      catch (error) { settled = true; clearInterval(polling); reject(error); }
    }, 100); polling.unref();
  }
  return { pid: child.pid, exited, stdout: child.stdout, stderr: child.stderr,
    get exitCode() { return code; }, get signalCode() { return signal; }, get killed() { return child.killed; }, get observation() { return observation; },
    kill: (by: NodeJS.Signals) => { if (!settled) child.kill(by); } };
}
