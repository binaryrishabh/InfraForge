// Brings the coordinator's integration branch into a lane's worktree between slices.
// It merges ONLY when git can do so without any conflict. A conflict is aborted, never resolved automatically:
// neither side's commits are touched, the conflicting files are recorded for the coordinator, and the lane keeps working.
import { existsSync } from "node:fs";
import { ROOT } from "./config";
import { git, sh } from "./proc";
import { event, now, type State } from "./state";

const gitIn = (s: State, ...args: string[]) => sh("git", ["-C", `${ROOT}/${s.worktree}`, "-c", "core.hooksPath=/dev/null", ...args]);

export function syncBase(s: State): boolean {
  if (!s.syncFrom || git(s.worktree, "status", "--porcelain")) return false;
  // Already contained: nothing to merge.
  if (gitIn(s, "merge-base", "--is-ancestor", s.syncFrom, "HEAD").status === 0) return false;
  const before = git(s.worktree, "rev-parse", "HEAD"), theirs = git(s.worktree, "rev-parse", s.syncFrom);
  const r = gitIn(s, "merge", "--no-edit", s.syncFrom);
  if (r.status === 0) {
    const after = git(s.worktree, "rev-parse", "HEAD");
    event(`SYNC merged ${s.syncFrom}: ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
    return after !== before;
  }
  const files = git(s.worktree, "diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  gitIn(s, "merge", "--abort");
  // The abort must leave the lane exactly where it was.
  const intact = git(s.worktree, "rev-parse", "HEAD") === before && !git(s.worktree, "status", "--porcelain") && !existsSync(`${ROOT}/${s.worktree}/.git/MERGE_HEAD`);
  // One report per unresolved integration commit and file set; the lane head moves after every slice.
  const seen = (s.syncConflicts ?? []).some((c) => c.integrationHead === theirs && c.files.join() === files.join());
  if (!seen) {
    (s.syncConflicts ??= []).push({ at: now(), from: s.syncFrom, laneHead: before, integrationHead: theirs, files });
    event(`SYNC CONFLICT merging ${s.syncFrom} into ${s.worktree}: ${files.join(", ") || "unknown files"}; merge aborted, both branches untouched${intact ? "" : " (WARNING: tree not clean after abort)"}; coordinator must resolve`);
  }
  return false;
}
