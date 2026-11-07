// One command after a reboot (or any time): start a controller for every lane that has work and no live controller.
//   bun --no-env-file scripts/lanes/start-lanes.ts            lanes with queued or running work
//   bun --no-env-file scripts/lanes/start-lanes.ts learna     only the named lanes
// Safe to repeat: a lane whose controller is alive is skipped, a stale lock is ignored, a worker that is still alive is re-attached
// by the controller (never duplicated), and the launcher itself refuses a second worker on one account.
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./lib/exec";

const slash = (p: string) => p.replace(/\\/g, "/");
const REPO = slash(resolve(import.meta.dir, "../.."));
const ROOT = slash(process.env.LANE_ROOT ?? resolve(REPO, ".."));
const OPS = slash(process.env.LANE_OPS ?? `${ROOT}/InfraForge_Code/.agent/ops`);
const LANES = `${OPS}/lanes`;

type Lane = { current?: { pid: number } | null; queue?: string[]; done?: Array<{ id: string }>; parked?: Array<{ id: string }> | null };
const hasWork = (s: Lane) => !!s.current || (s.queue ?? []).some((q) => !(s.done ?? []).some((d) => d.id === q) && !(s.parked ?? []).some((p) => p.id === q));

// signal 0 answers without PowerShell: a pid that is gone means a stale lock.
function pidExists(pid: number) { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; } }

// PowerShell is needed to start workers. If it does not answer, say so now instead of failing later with an empty message.
const probe = run("powershell.exe", ["-NoProfile", "-Command", "Write-Output ok"], { timeoutMs: 30_000 });
if (probe.stdout.trim() !== "ok") {
  console.error(`PowerShell did not answer (${probe.timedOut ? "timed out after 30 s" : probe.error || `exit ${probe.status}`}); not starting anything.\nThis machine is short of memory or commit space: close heavy programs or reboot, then run this again.`);
  process.exit(2);
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : readdirSync(LANES).filter((f) => /^[a-z0-9]+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ""));
for (const lane of names) {
  const statePath = `${LANES}/${lane}.json`, lockPath = `${LANES}/${lane}.lock`;
  if (!existsSync(statePath)) { console.log(`${lane}: no such lane`); continue; }
  const s = JSON.parse(readFileSync(statePath, "utf8")) as Lane;
  if (!wanted.length && !hasWork(s)) { console.log(`${lane}: nothing queued, skipped`); continue; }
  if (existsSync(lockPath)) {
    const held = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    if (pidExists(held.pid)) { console.log(`${lane}: controller already running (pid ${held.pid}), left alone`); continue; }
    unlinkSync(lockPath); console.log(`${lane}: removed stale lock of dead pid ${held.pid}`);
  }
  const r = run("powershell.exe", ["-NoProfile", "-File", `${REPO}/scripts/lanes/detached.ps1`, "-WorkDir", REPO.replace(/InfraForge_wt_\w+$/, "InfraForge_Code"), "-Log", `${LANES}/${lane}.controller.log`, "-CodexHome", "", "-Command", `bun --no-env-file ${OPS}/lane-controller.ts ${lane}`], { timeoutMs: 60_000 });
  console.log(`${lane}: ${/started pid (\d+)/.exec(r.stdout) ? `controller started (${r.stdout.trim()})` : `could not start controller: exit ${r.status}${r.timedOut ? " (timed out)" : ""} ${(r.stdout + r.stderr).trim().slice(0, 300)}`}`);
}
