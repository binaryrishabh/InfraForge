// Runs one lane's slice queue: launches a Codex worker through the private launcher, waits for that exact attempt to stop,
// checks the slice really finished (commits + clean tree + the worker's own SLICE_RESULT line), then starts the next one.
// Usage: bun --no-env-file scripts/lanes/lane-controller.ts <lane>      state: <ops>/lanes/<lane>.json   (see README.md)
//
// Rules this keeps (each one fixes a real 4-5 Nov stoppage):
//  - every launch has its OWN log file and start offset; an old quota error or CODEX_DONE can never decide a newer attempt;
//  - a worker is gone only when its recorded process identity is dead; a restarted controller re-attaches to a live worker;
//  - quota exhaustion pauses the lane, then resumes the SAME session at the stated reset time;
//  - blocked / out-of-retries slices are parked and the lane moves to the next independent slice;
//  - the integration branch is merged between slices ONLY if git merges it without conflict (see lib/sync.ts);
//  - an empty queue idles the controller and a slice dropped into <lane>.inbox/ starts within seconds.
import { existsSync, mkdirSync, readFileSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { LANES, LAUNCHER, OPS, POLL_MS, QUOTA_MIN_MS, QUOTA_SLACK_MS, ROOT, SILENT_MS, inboxPath, lane, lockPath } from "./lib/config";
import { doneExit, judge, logAgeMs, logPath, logText } from "./lib/judge";
import { workerGone } from "./lib/liveness";
import { aliveAs, git, sh, sleep, workerAlive } from "./lib/proc";
import { drainInbox, nextSlice, park } from "./lib/queue";
import { event, load, now, save, type Current, type State } from "./lib/state";
import { syncBase } from "./lib/sync";

function takeLock() {
  if (existsSync(lockPath)) {
    const held = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    if (held.pid !== process.pid && aliveAs(held.pid, /lane-controller/)) { console.error(`lane ${lane} is already controlled by pid ${held.pid}`); process.exit(3); }
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, started: now() }));
}
const dropLock = () => { try { unlinkSync(lockPath); } catch {} };

function launch(s: State, id: string, attempt: number, resumes: number, brief: string, resumeSession: string, quotaRetries = 0) {
  const branch = git(s.worktree, "rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== s.branch) throw new Error(`worktree is on ${branch}, expected ${s.branch}`);
  if (!resumeSession && git(s.worktree, "status", "--porcelain")) {
    sh("git", ["-C", `${ROOT}/${s.worktree}`, "add", "-A"]);
    sh("git", ["-C", `${ROOT}/${s.worktree}`, "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "Checkpoint unfinished work before the next attempt"]);
    event(`CHECKPOINT committed unfinished work in ${s.worktree} before a fresh launch`);
  }
  const log = `${id}-a${attempt}r${resumes}-${Date.now().toString(36)}.log`;
  const cmd = `& pwsh -NoProfile -File '${LAUNCHER}' -Account ${s.account} -Model ${s.model} -Effort ${s.effort} -Worktree ${s.worktree} -Brief ${brief} -Log ${log}` + (resumeSession ? ` -Resume ${resumeSession}` : "");
  const r = sh("powershell.exe", ["-NoProfile", "-Command", cmd]);
  const pid = Number(/started pid (\d+)/.exec(r.stdout)?.[1] ?? 0), script = /script (\S+detached-[0-9a-f]+\.sh)/.exec(r.stdout)?.[1];
  if (!pid) throw new Error(`launcher refused: ${(r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 300)}`);
  const prev = load().current;
  s.current = { id, attempt, resumes, sessionId: resumeSession, baseSha: prev && prev.id === id ? prev.baseSha : git(s.worktree, "rev-parse", "HEAD"),
    startedAt: now(), log, logStart: 0, pid, script, quotaRetries };
  s.stopped = null; save(s); event(`LAUNCH ${id} attempt ${attempt} resume ${resumes} pid ${pid} log ${log}`);
}
// The account may still be finishing a previous worker for a moment; wait a bounded time instead of giving up.
async function launchPatiently(...a: Parameters<typeof launch>) {
  for (let i = 0; ; i++) {
    try { return launch(...a); } catch (e) {
      if (!/already has a running Codex session/.test(String((e as Error).message)) || i >= 10) throw e;
      event(`WAIT account busy, retry ${i + 1}/10`); await sleep(30_000);
    }
  }
}
function trySync(): boolean { const s = load(), changed = syncBase(s); save(s); return changed; }

async function waitForEnd(c: Current) {
  await new Promise<void>((resolve) => {
    let w: ReturnType<typeof watch> | undefined;
    let probing = false;
    const check = async () => {
      if (probing) return;
      probing = true;
      try {
        const marker = doneExit(c) !== null, first = marker ? false : workerAlive(c);
        let second = first;
        if (!marker && !first) { await sleep(8_000); second = workerAlive(c); }
        if (workerGone({ marker, aliveFirst: first, aliveSecond: second, logAgeMs: logAgeMs(c) }, SILENT_MS)) { clearInterval(t); w?.close(); resolve(); }
      } finally { probing = false; }
    };
    const t = setInterval(check, POLL_MS);
    try { w = watch(logPath(c), () => { if (doneExit(c) !== null) void check(); }); } catch {}
    void check();
  });
}
async function idleUntilWork() {
  event("IDLE queue empty; waiting for new slices (inbox or queue edit)");
  const deadline = Date.now() + 12 * 3600_000;
  await new Promise<void>((resolve) => {
    let w: ReturnType<typeof watch> | undefined;
    const check = () => { const s = load(); if (drainInbox(s)) save(s); if (nextSlice(s) || Date.now() > deadline) { clearInterval(t); w?.close(); resolve(); } };
    const t = setInterval(check, 30_000);
    try { mkdirSync(inboxPath, { recursive: true }); w = watch(inboxPath, check); } catch {}
  });
}

const resumeBrief = (id: string, n: number, why: string) => {
  const name = `${id}-resume${n}.md`;
  writeFileSync(`${OPS}/briefs/${name}`, `RESUME ${id}: your previous session stopped before the slice was proven finished (${why}). Re-read briefs/${id}.md and briefs/learn-common.md, inspect git log and git status in your worktree, finish ONLY what is still missing, commit, and make the last line of reports/${id}.md exactly one of: SLICE_RESULT: complete | SLICE_RESULT: partial <what is missing> | SLICE_RESULT: blocked <reason>. Do not redo committed work.\n`);
  return name;
};

async function main() {
  mkdirSync(LANES, { recursive: true }); takeLock(); process.on("exit", dropLock);
  { const s = load(); if (s.stopped) { event(`RESTART clears earlier stop: ${s.stopped.reason.slice(0, 120)}`); s.stopped = null; save(s); } }
  if (load().current) { const c = load().current!; event(`ATTACH ${c.id} pid ${c.pid} ${workerAlive(c) ? "alive" : "not alive (judging from its own log)"}`); }
  for (;;) {
    const s = load();
    if (drainInbox(s)) save(s);
    if (!s.current) {
      const id = nextSlice(s);
      if (!id) { await idleUntilWork(); if (!nextSlice(load())) { event("STOP idle for 12h"); return; } continue; }
      trySync();
      try { await launchPatiently(load(), id, 1, 0, `${id}.md`, ""); } catch (e) { event(`STOP ${(e as Error).message}`); return; }
    }
    const c = load().current!;
    await waitForEnd(c);
    const s2 = load(), j = judge(s2, c);
    s2.current!.sessionId = /session id: ([0-9a-f-]{36})/.exec(logText(c))?.[1] ?? c.sessionId;
    save(s2); event(`END ${c.id} ${j.verdict}: ${j.why}`);
    const sid = s2.current!.sessionId;
    try {
      if (j.verdict === "quota") {
        const retries = (c.quotaRetries ?? 0) + 1;
        if (retries > 6) { event(`STOP ${c.id} quota persisted after ${retries - 1} resumes`); return; }
        const waitMs = Math.min(Math.max((j.resetAt ?? Date.now() + 20 * 60_000) - Date.now() + QUOTA_SLACK_MS, QUOTA_MIN_MS), 6 * 3600_000);
        const qbrief = `${c.id}-quotaresume.md`;
        writeFileSync(`${OPS}/briefs/${qbrief}`, `RESUME ${c.id}: your session was paused by an account usage limit, nothing was lost. Re-read briefs/${c.id}.md, inspect git log and git status, finish what is still missing, commit, and make the last line of reports/${c.id}.md a SLICE_RESULT line.\n`);
        event(`PAUSE account ${s2.account} out of quota (stated reset ${j.resetAt ? new Date(j.resetAt).toISOString() : "unknown"}); resuming ${c.id} at ${new Date(Date.now() + waitMs).toISOString()} (work preserved, session ${sid || "none"})`);
        await sleep(waitMs);
        await launchPatiently(load(), c.id, c.attempt, c.resumes, sid ? qbrief : `${c.id}.md`, sid, retries); continue;
      }
      if (j.verdict === "complete") { s2.done.push({ id: c.id, sha: j.sha, finishedAt: now() }); s2.current = null; save(s2); continue; }
      if (j.verdict === "blocked") {
        // A block that only needed the integration branch is resumed after a conflict-free merge; anything else is parked.
        if (/rebase|merge|base|integration|contract/i.test(j.why) && c.resumes < 2 && sid && trySync()) {
          await launchPatiently(load(), c.id, c.attempt, c.resumes + 1, resumeBrief(c.id, c.resumes + 1, "the integration branch was merged in; no approval needed"), sid); continue;
        }
        park(s2, c, `blocked: ${j.why}`, j.sha); continue;
      }
      if (j.verdict === "incomplete" && c.resumes < 2 && sid) {
        await launchPatiently(load(), c.id, c.attempt, c.resumes + 1, resumeBrief(c.id, c.resumes + 1, j.why), sid); continue;
      }
      if (j.verdict === "failed" && c.attempt < 2) { s2.current = null; save(s2); await launchPatiently(load(), c.id, c.attempt + 1, 0, `${c.id}.md`, ""); continue; }
      park(s2, c, `${j.verdict} after bounded retries: ${j.why}`, j.sha);
    } catch (e) { event(`STOP ${(e as Error).message}`); return; }
  }
}
await main();
