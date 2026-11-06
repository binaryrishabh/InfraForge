// Decides how ONE attempt ended. Only that attempt's own log region and its own (newer) report count.
import { readFileSync, statSync } from "node:fs";
import { OPS } from "./config";
import { git } from "./proc";
import type { Current, State } from "./state";

export type Verdict = "complete" | "blocked" | "quota" | "incomplete" | "failed";
export type Judgement = { verdict: Verdict; why: string; sha: string; resetAt: number | null };

export const logPath = (c: Current) => `${OPS}/reports/${c.log}`;
export function logText(c: Current): string {
  try { return readFileSync(logPath(c)).subarray(c.logStart ?? 0).toString("utf8"); } catch { return ""; }
}
// null = no end marker in this attempt's region (still running, or the worker vanished).
export const doneExit = (c: Current): number | null => {
  const m = [...logText(c).matchAll(/^CODEX_DONE exit=(\d+)/gm)].pop();
  return m ? Number(m[1]) : null;
};

// "try again at 9:01 PM" is local time. A minute that just passed means the quota already reset;
// only a time more than an hour behind means tomorrow.
export function quotaResetAt(tail: string, nowMs = Date.now()): number | null {
  const m = /try again at (\d{1,2}):(\d{2}) ?(AM|PM)/i.exec(tail);
  if (!m) return null;
  const d = new Date(nowMs);
  d.setHours((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0), Number(m[2]), 0, 0);
  if (d.getTime() < nowMs - 60 * 60_000) d.setDate(d.getDate() + 1);
  return Math.max(d.getTime(), nowMs);
}

export function judge(s: State, c: Current): Judgement {
  const tail = logText(c).split("\n").slice(-40).join("\n");
  const exit = doneExit(c);
  const sha = git(s.worktree, "rev-parse", "HEAD");
  const commits = Number(git(s.worktree, "rev-list", "--count", `${c.baseSha}..HEAD`) || 0);
  const dirty = git(s.worktree, "status", "--porcelain").split("\n").filter(Boolean).length;
  let report = "";
  try { const p = `${OPS}/reports/${c.id}.md`; if (statSync(p).mtimeMs >= Date.parse(c.startedAt) - 5000) report = readFileSync(p, "utf8"); } catch {}
  const result = [...report.matchAll(/^SLICE_RESULT:\s*(complete|partial|blocked)\b(.*)$/gm)].pop();
  const facts = `exit=${exit ?? "none"} commits=${commits} dirty=${dirty} result=${result?.[1] ?? "none(this attempt)"}`;
  if (exit !== 0 && /usage limit|try again at/i.test(tail)) return { verdict: "quota", why: facts, sha, resetAt: quotaResetAt(tail) };
  if (result?.[1] === "blocked") return { verdict: "blocked", why: `${facts} ${result[2].trim()}`, sha, resetAt: null };
  if (result?.[1] === "complete" && commits > 0 && dirty === 0 && exit === 0) return { verdict: "complete", why: facts, sha, resetAt: null };
  if (exit !== 0 && commits === 0) return { verdict: "failed", why: facts, sha, resetAt: null };
  return { verdict: "incomplete", why: facts, sha, resetAt: null };
}

export const logAgeMs = (c: Current, nowMs = Date.now()): number => {
  try { return nowMs - statSync(logPath(c)).mtimeMs; } catch { return Number.POSITIVE_INFINITY; }
};
