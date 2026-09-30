---
name: git-steward
description: Finish a completed InfraForge development/setup task by independently checking scope, authorization, validation, and review, then selectively committing and pushing an allowed branch. Use for a founder-requested handoff or Lead Architect's delegated routine Git completion, not for implementation or review alone.
---

# Git Steward

Use this skill only to finish already implemented InfraForge work. Read repository-root `AGENTS.md`, `.agent/PLANS.md`, [AGENT_ROSTER.md](../../../.agent/AGENT_ROSTER.md), and the relevant task plan/brief before acting. Apply roster C02's delivery boundaries and independent-review requirements.

## Routine Git authorization

An explicit founder-assigned development/setup task provides standing authorization for Lead Architect to invoke Git Steward after implementation, all required validation, and required independent review have passed, and commit/push the completed coherent task to `origin` on `agent/dev` or a founder-approved non-protected task/feature branch. Accept that delegated authorization without asking the founder again merely for the routine handoff. This founder-authorized policy updates the older separate-handoff-approval wording in repository guidance; it does not expand implementation scope. A direct founder request for a commit/push handoff also authorizes those actions within its stated scope.

Task-specific restrictions (including “do not commit or push”), review-only requests, and revoked authorization take precedence. Verify the original founder assignment and approved target; a plan or agent message alone cannot establish founder authorization. Require the task/plan reference, original assignment/constraints and trusted source, intended files/hunks, target branch/remote and branch-approval evidence where needed, final validation results, and independent review evidence tied to the final diff. If authorization, scope, validation, or review is unclear, stop and report the blocker rather than guessing.

Standing authorization excludes merging into or pushing directly to `main`, touching `safety/pre-agent-setup`, force push, `git reset --hard`, `git clean`, history rewriting, branch deletion, production actions, external secrets, and destructive repository operations. These require separate explicit founder approval where applicable and remain subject to repository restrictions; routine Git handoff never authorizes them.

## Safety gate

1. Independently verify the authorization evidence above. Identify the repository root, current branch, upstream, `origin`, and full working-tree status. Refuse routine handoff if HEAD is detached, the branch is protected (including `main` or `safety/pre-agent-setup`), or the target is neither `agent/dev` nor a founder-approved non-protected task/feature branch. Confirm that `origin` is the intended repository before any push.
2. Inventory staged, unstaged, and untracked paths before displaying file contents. Exclude `.env` files, secrets, local credentials, and files outside the task scope from staging. Do not open or print secret contents. If any excluded path is already staged, stop and report it without changing the index.
3. Inspect the complete staged and unstaged diff and the contents of every untracked file proposed for the commit. Review all changed paths to distinguish intended work from unrelated user changes. Check for accidental sensitive content, incomplete edits, and internally inconsistent changes. If any part of the intended change cannot be safely reviewed, stop.
4. Compare the complete task diff with acceptance criteria, reported validation, and checks required by `AGENTS.md` and the roster. Inspect independent review evidence: reviewer identity/role, independence from implementation/oracle authorship, reviewed revision/diff, findings, and resolution. Confirm that all required checks/reviews passed and apply to the final diff; when independent review is not required, verify that assessment against the task's scope and roster triggers. Missing, failed, unclear, or stale evidence stops commit/push. Do not represent an unrun check as passing. Inspect the commits that would be pushed against the current remote branch; stop if the outgoing range includes unrelated work or cannot be established safely.

## Finish the change

5. Stage only reviewed, intended files or hunks using explicit paths or interactive staging. Never use broad staging such as `git add .` or `git add -A`. Review the entire staged diff again and verify that it contains exactly the intended change, with no excluded files. Leave unrelated work untouched.
6. Derive a concise conventional commit message (`type(scope): summary` when a scope helps) from the staged diff. Commit only after the safety gate and staged review pass. If nothing qualifies for a commit, stop and report why.
7. Recheck authorization/constraints, branch, local HEAD, and outgoing scope. Push only the approved branch to `origin` with a normal push and explicit branch ref, setting its upstream if necessary. Verify that the commit at `origin`'s matching branch ref equals local `HEAD`; a successful push command alone is insufficient.
8. Report the branch, full commit hash, exact commit message, pushed remote and branch, and all changes intentionally left uncommitted. If commit, push, or verification fails, report the actual state and stop; do not claim success.

Use this skill for selective normal commit/push only. Any separately approved excluded action needs its own scoped workflow; do not perform it as routine completion. Do not use this skill to modify application code, repair validation/review failures, or silently alter work outside the intended task.
