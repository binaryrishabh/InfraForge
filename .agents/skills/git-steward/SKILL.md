---
name: git-steward
description: Finish an InfraForge development task by reviewing its complete Git changes and validation, then selectively committing and pushing the current non-protected branch when authorized. Use for a requested commit-and-push handoff, not for implementation or review alone.
---

# Git Steward

Use this skill only to finish already implemented InfraForge work. Read the repository's `AGENTS.md` and relevant task plan before acting. A request to use this skill for a commit-and-push handoff authorizes those actions; a review-only request does not. Never infer permission to merge into `main`.

## Safety gate

1. Identify the repository root, current branch, upstream, `origin`, and full working-tree status. Refuse to proceed if HEAD is detached or the branch is `main` or `safety/pre-agent-setup`. `agent/dev` is an allowed integration branch. Confirm that `origin` is the intended repository before any push.
2. Inventory staged, unstaged, and untracked paths before displaying file contents. Exclude `.env` files, secrets, local credentials, and files outside the task scope from staging. Do not open or print secret contents. If any excluded path is already staged, stop and report it without changing the index.
3. Inspect the complete staged and unstaged diff and the contents of every untracked file proposed for the commit. Review all changed paths to distinguish intended work from unrelated user changes. Check for accidental sensitive content, incomplete edits, and internally inconsistent changes. If any part of the intended change cannot be safely reviewed, stop.
4. Compare the change with the implementing agent's reported validation and the checks required by `AGENTS.md`. Confirm that the required checks passed and that the results apply to the final diff. If required validation is missing, failed, or stale, do not commit or push; report the exact gap. Do not represent an unrun check as passing.

## Finish the change

5. Stage only reviewed, intended files or hunks using explicit paths or interactive staging. Never use broad staging such as `git add .` or `git add -A`. Review the entire staged diff again and verify that it contains exactly the intended change, with no excluded files. Leave unrelated work untouched.
6. Derive a concise conventional commit message (`type(scope): summary` when a scope helps) from the staged diff. Commit only after the safety gate and staged review pass. If nothing qualifies for a commit, stop and report why.
7. Recheck the branch and local HEAD. Push that branch to `origin` with a normal push, setting its upstream if necessary. Do not push any other branch. Verify that the commit at `origin`'s matching branch ref equals local `HEAD`; a successful push command alone is insufficient.
8. Report the branch, full commit hash, exact commit message, pushed remote and branch, and all changes intentionally left uncommitted. If commit, push, or verification fails, report the actual state and stop; do not claim success.

Never run `git reset --hard`, `git clean`, force push, history rewriting commands, branch deletion, or other destructive operations. Never merge into `main` without separate, explicit user approval. Do not use this skill to modify application code, repair validation failures, or silently alter work outside the intended task.
