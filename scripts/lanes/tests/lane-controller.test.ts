// Reproduces the real 4-5 Nov lane failures with real processes in a throwaway repo (a fake worker stands in for codex).
// Run (Windows, needs bun, git, powershell.exe and pwsh): bun --no-env-file test ./scripts/lanes/tests/lane-controller.test.ts
import { afterEach, beforeEach, expect, test as bunTest } from "bun:test";
// The controller drives Windows processes; CI runs on Linux, so these only run where they can.
const test = process.platform === "win32" ? bunTest : bunTest.skip;
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = import.meta.dir.replace(/\\/g, "/"), CONTROLLER = `${HERE}/../lane-controller.ts`;
let root = "", ops = "", wt = "", procs: Array<ReturnType<typeof Bun.spawn>> = [];
const sh = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const state = () => JSON.parse(read(`${ops}/lanes/t.json`));
const events = () => read(`${ops}/lanes/t.events.log`);
const ledger = () => read(`${ops}/fake/ledger.txt`).split("\n").filter(Boolean);
process.env.TZ ??= "UTC";
const behavior = (name: string, script: string) => writeFileSync(`${ops}/fake/${name}.sh`, `#!/usr/bin/env bash\ncd "$WT"\n${script}\n`);

// What a finished slice looks like: one commit and a report ending in the result line.
const COMPLETE = (extra = "") => `${extra}\nsleep 1\necho "$SLICE $BRIEF" > "$SLICE-$$.txt"; git add -A; git commit -qm "$SLICE"\nprintf 'SLICE_RESULT: complete\\n' >> "$OPS/reports/$SLICE.md"`;

beforeEach(() => {
  root = mkdtempSync(`${tmpdir().replace(/\\/g, "/")}/lanetest-`); ops = `${root}/InfraForge_Code/.agent/ops`; wt = `${root}/InfraForge_wt_t`;
  for (const d of ["lanes", "reports", "briefs", "fake"]) mkdirSync(`${ops}/${d}`, { recursive: true });
  mkdirSync(wt); sh(wt, "init", "-q", "-b", "local/t"); writeFileSync(`${wt}/base.txt`, "base"); sh(wt, "add", "-A"); sh(wt, "commit", "-qm", "base");
  behavior("default", COMPLETE());
});
afterEach(() => {
  for (const p of procs) try { p.kill(); } catch {}
  procs = [];
  spawnSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${root.split("/").pop()}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  try { rmSync(root, { recursive: true, force: true }); } catch {}
});

function writeState(queue: string[], extra: Record<string, unknown> = {}) {
  writeFileSync(`${ops}/lanes/t.json`, JSON.stringify({ account: "default", model: "gpt-6.1-sol", effort: "high", worktree: "InfraForge_wt_t", branch: "local/t", queue, done: [], current: null, stopped: null, ...extra }, null, 2));
  for (const q of queue) writeFileSync(`${ops}/briefs/${q}.md`, `slice ${q}`);
}
function startController() {
  const p = Bun.spawn(["bun", "--no-env-file", CONTROLLER, "t"], { env: { ...process.env, LANE_ROOT: root, LANE_OPS: ops, LANE_LAUNCHER: `${HERE}/fake-launch.ps1`, TZ: process.env.TZ ?? "UTC", LANE_POLL_MS: "1000", LANE_QUOTA_SLACK_MS: "500", LANE_QUOTA_MIN_MS: "500" }, stdout: "ignore", stderr: "ignore" });
  procs.push(p); return p;
}
async function until(cond: () => boolean, what: string, ms = 90_000) {
  const t = Date.now();
  while (!cond()) { if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}\n--- events\n${events()}\n--- ledger\n${ledger().join("\n")}`); await Bun.sleep(300); }
}
const doneIds = () => (state().done as Array<{ id: string }>).map((d) => d.id);
const ts = (line: string) => Date.parse(line.split(" ")[0]);
const noOverlap = () => { let open = 0; for (const l of ledger()) { open += / start /.test(l) ? 1 : -1; if (open > 1) return false; } return true; };

test("1+4 stale quota error and stale blocked report from an older attempt never decide a healthy new one; finishing hands off to the next slice", async () => {
  writeState(["s1", "s2"]);
  writeFileSync(`${ops}/reports/s1-a1r0-old.log`, "ERROR: You've hit your usage limit. try again at 9:01 PM.\nCODEX_DONE exit=1 account=default\n");
  writeFileSync(`${ops}/reports/s1.md`, "old attempt\nSLICE_RESULT: blocked old reason\n"); const past = new Date(Date.now() - 3600_000); utimesSync(`${ops}/reports/s1.md`, past, past);
  behavior("s1", COMPLETE("sleep 4"));
  startController();
  await until(() => doneIds().length === 2, "both slices done");
  expect(doneIds()).toEqual(["s1", "s2"]);
  expect(events()).not.toMatch(/PAUSE|PARK|STOP/);
  expect(ledger().filter((l) => / start /.test(l))).toHaveLength(2);
  expect(noOverlap()).toBe(true);
  const ev = events().split("\n"), endS1 = ev.find((l) => / END s1 complete/.test(l))!, launchS2 = ev.find((l) => /LAUNCH s2 /.test(l))!;
  expect(ts(launchS2) - ts(endS1)).toBeLessThan(15_000);   // next slice starts within seconds of the previous END
}, 120_000);

test("2+3 the controller dies while its worker continues; the new controller re-attaches and starts no duplicate", async () => {
  writeState(["s1", "s2"]); behavior("s1", COMPLETE("sleep 9"));
  const first = startController();
  await until(() => /LAUNCH s1/.test(events()), "s1 launch");
  first.kill(); await first.exited;
  startController();
  await until(() => doneIds().length === 2, "both slices done after takeover");
  expect(events()).toMatch(/ATTACH s1 pid \d+ alive/);
  expect(ledger().filter((l) => / start s1 /.test(l))).toHaveLength(1);     // never a second s1 worker
  expect(sh(wt, "log", "--oneline", "--grep=^s1$").stdout.trim().split("\n")).toHaveLength(1);
  expect(noOverlap()).toBe(true);
}, 120_000);

test("5 a real quota failure pauses the lane, preserves unfinished work and resumes the same session with no duplicate commit", async () => {
  const reset = new Date(Date.now() + 70_000), hh = reset.getHours() % 12 || 12, mm = String(reset.getMinutes()).padStart(2, "0"), ap = reset.getHours() >= 12 ? "PM" : "AM";
  writeState(["s1"]);
  behavior("s1", `if [ -z "$RESUME" ] || [ "$BRIEF" = "s1.md" ]; then echo wip > wip.txt; echo "ERROR: You've hit your usage limit. Upgrade or try again at ${hh}:${mm} ${ap}."; exit 1; fi\n${COMPLETE()}`);
  startController();
  await until(() => /PAUSE account default/.test(events()), "quota pause");
  expect(existsSync(`${wt}/wip.txt`)).toBe(true);                    // unfinished work untouched while paused
  await until(() => doneIds().length === 1, "resume and completion", 150_000);
  expect(ledger().filter((l) => / start /.test(l)).map((l) => l.split(" ").pop())).toEqual(["s1.md", "s1-quotaresume.md"]);
  expect(events()).toMatch(/LAUNCH s1 attempt 1 resume 0/);
  expect(sh(wt, "log", "--oneline", "--grep=^s1$").stdout.trim().split("\n")).toHaveLength(1);
  expect(readFileSync(`${wt}/wip.txt`, "utf8")).toContain("wip");
}, 200_000);

test("6 a worker blocked for an ordinary integration update is merged and resumed; an unrelated block parks that slice and the lane moves on", async () => {
  writeState(["s1", "s2", "s3"], { syncFrom: "local/sync" });
  sh(wt, "branch", "local/sync"); // same commit for now; advanced while s1 runs
  behavior("s1", `if [ -f sync.txt ]; then ${COMPLETE()}; else sleep 3; printf 'SLICE_RESULT: blocked needs a rebase onto the integration base\\n' >> "$OPS/reports/$SLICE.md"; fi`);
  behavior("s2", `sleep 1; printf 'SLICE_RESULT: blocked needs a human decision\\n' >> "$OPS/reports/$SLICE.md"`);
  startController();
  await until(() => /LAUNCH s1/.test(events()), "s1 launch");
  const syncWt = `${root}/InfraForge_wt_sync`; sh(wt, "worktree", "add", "-q", syncWt, "local/sync");
  writeFileSync(`${syncWt}/sync.txt`, "from integration"); sh(syncWt, "add", "-A"); sh(syncWt, "commit", "-qm", "integration change");
  await until(() => doneIds().includes("s3"), "s3 done", 120_000);
  expect(doneIds()).toEqual(["s1", "s3"]);
  expect(state().parked.map((p: { id: string }) => p.id)).toEqual(["s2"]);
  expect(events()).toMatch(/SYNC merged local\/sync/);
  expect(events()).toMatch(/LAUNCH s1 attempt 1 resume 1/);
  expect(ledger().filter((l) => / start s1 /.test(l))).toHaveLength(2);   // original + one resume, never a third
  expect(noOverlap()).toBe(true);
}, 200_000);

test("7 the worker dies mid-task while the controller is down; the restarted controller recovers the true state and resumes without skipping or repeating", async () => {
  writeState(["s1", "s2"]);
  behavior("s1", `if [ "$BRIEF" = "s1.md" ]; then echo part > part.txt; git add -A; git commit -qm "s1 partial"; sleep 60; fi\n${COMPLETE()}`);
  const first = startController();
  await until(() => /LAUNCH s1/.test(events()) && sh(wt, "log", "--oneline", "--grep=s1 partial").stdout.trim() !== "", "partial commit");
  first.kill(); await first.exited;
  const cur = state().current;
  spawnSync("taskkill", ["/PID", String(cur.pid), "/T", "/F"]);               // the worker dies with the controller down
  await Bun.sleep(1500);
  rmSync(`${ops}/fake/active-default`, { force: true });                       // the real launcher detects dead workers by process; the fake uses this file
  startController();
  await until(() => doneIds().length === 2, "recovery and both slices done", 150_000);
  expect(events()).toMatch(/ATTACH s1 pid \d+ not alive/);
  expect(events()).toMatch(/END s1 incomplete/);
  expect(doneIds()).toEqual(["s1", "s2"]);
  expect(sh(wt, "log", "--oneline", "--grep=s1 partial").stdout.trim().split("\n")).toHaveLength(1);   // partial work kept once
  expect(ledger().filter((l) => / start s2 /.test(l))).toHaveLength(1);
  expect(ledger().filter((l) => / start s1 /.test(l))).toHaveLength(2);   // the killed original and exactly one resume
}, 200_000);

test("an idle lane starts a slice dropped into its inbox within seconds, and a second controller cannot own the lane", async () => {
  writeState([]);
  const c = startController();
  await until(() => /IDLE/.test(events()), "idle");
  writeFileSync(`${ops}/briefs/s9.md`, "slice s9"); mkdirSync(`${ops}/lanes/t.inbox`, { recursive: true }); writeFileSync(`${ops}/lanes/t.inbox/s9.txt`, "");
  const t0 = Date.now();
  await until(() => /LAUNCH s9/.test(events()), "inbox launch", 40_000);
  expect(Date.now() - t0).toBeLessThan(35_000);
  const second = Bun.spawnSync(["bun", "--no-env-file", CONTROLLER, "t"], { env: { ...process.env, LANE_ROOT: root, LANE_OPS: ops, LANE_LAUNCHER: `${HERE}/fake-launch.ps1` } });
  expect(second.exitCode).toBe(3);
  await until(() => doneIds().includes("s9"), "s9 done");
  c.kill();
}, 120_000);

test("8 conflicting worker and integration changes are never auto-resolved: the merge is aborted, both sides survive intact, the conflict is recorded and the lane keeps working", async () => {
  writeState(["s1", "s2", "s3"], { syncFrom: "local/sync" });
  sh(wt, "branch", "local/sync");
  // The worker commits its own version of shared.txt while the coordinator commits a different one on the integration branch.
  behavior("s1", `sleep 4; echo "worker version" > shared.txt; git add -A; git commit -qm "worker shared"
printf 'SLICE_RESULT: complete\n' >> "$OPS/reports/$SLICE.md"`);
  startController();
  await until(() => /LAUNCH s1/.test(events()), "s1 launch");
  const syncWt = `${root}/InfraForge_wt_sync`; sh(wt, "worktree", "add", "-q", syncWt, "local/sync");
  writeFileSync(`${syncWt}/shared.txt`, "integration version\n"); sh(syncWt, "add", "-A"); sh(syncWt, "commit", "-qm", "integration shared");
  await until(() => doneIds().length === 3, "all three slices (the lane must not stop on the conflict)", 150_000);
  expect(doneIds()).toEqual(["s1", "s2", "s3"]);
  expect(events()).toMatch(/SYNC CONFLICT merging local\/sync into InfraForge_wt_t: shared\.txt; merge aborted, both branches untouched/);
  expect(events()).not.toMatch(/SYNC merged/);
  const conflicts = state().syncConflicts;
  expect(conflicts).toHaveLength(1);                                  // the same unresolved pair is reported once, not every slice
  expect(conflicts[0].files).toEqual(["shared.txt"]);
  // Both sides survive: worker commit on the lane, integration commit on its branch, nothing merged or overwritten.
  expect(readFileSync(`${wt}/shared.txt`, "utf8").trim()).toBe("worker version");
  expect(sh(wt, "log", "--format=%s", "local/t").stdout).toContain("worker shared");
  expect(sh(wt, "log", "--format=%s", "local/sync").stdout).toContain("integration shared");
  expect(sh(wt, "show", "local/sync:shared.txt").stdout.trim()).toBe("integration version");
  expect(sh(wt, "merge-base", "--is-ancestor", "local/sync", "local/t").status).not.toBe(0);   // integration NOT silently absorbed
  expect(existsSync(`${wt}/.git/MERGE_HEAD`)).toBe(false);
  expect(sh(wt, "status", "--porcelain").stdout.trim()).toBe("");
}, 200_000);
