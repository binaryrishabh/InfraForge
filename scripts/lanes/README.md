# Lane controller

Keeps one Codex worker lane busy: runs a queue of slices one after another, recovers from crashes and quota limits, and never
decides the outcome of a new attempt from an old one. Development tooling for the machine that runs the lanes; it is not part of
the product, is not packaged, and is not run by CI (it drives Windows processes).

## What is versioned and what is not

Versioned here: the controller (`lane-controller.ts`, `lib/`), a generic detached-process helper (`detached.ps1`) and the
regression tests (`tests/`). Not versioned, by design, in the machine-private `.agent/ops/` directory (excluded from git):
the real launcher (`codex-launch.ps1`, which knows the Codex account homes), lane state, briefs, reports, event logs, locks
and session logs. **Never commit any of those, and never put an account path, token or key in this directory.**

## Layout the controller expects

`<root>` is the folder that holds the `InfraForge_*` checkouts; `<ops>` defaults to `<root>/InfraForge_Code/.agent/ops`.

- `<ops>/lanes/<lane>.json` - state: account, model, effort, worktree, branch, `syncFrom`, queue, done, parked, current.
- `<ops>/briefs/<slice>.md` - the worker brief for each slice. `<ops>/reports/` - one log per attempt, and `<slice>.md` reports.
- `<ops>/codex-launch.ps1` - the launcher (set `LANE_LAUNCHER` to use another one).

Run: `bun --no-env-file scripts/lanes/lane-controller.ts <lane>` (detached with `scripts/lanes/detached.ps1`).
Add work without touching the state file: create `<ops>/briefs/<slice>.md`, then an empty `<ops>/lanes/<lane>.inbox/<slice>.txt`.

## Rules (each fixed a real stoppage)

- Every launch has its own log and start offset; old quota errors, old end markers and old reports can never decide a new attempt.
- A worker is "gone" only when its recorded process identity is dead; a restarted controller re-attaches to a live worker.
- A usage limit pauses the lane until the stated reset (local time; a minute that just passed means it reset), then resumes the same session.
- Blocked or out-of-retries slices are parked and the lane moves on.
- **Integration merges never choose a side.** With `syncFrom` set, the controller merges that branch between slices only when git
  merges it with no conflict. On any conflict it runs `git merge --abort`, leaves both branches and the worktree exactly as they were,
  records `{files, laneHead, integrationHead}` in `syncConflicts` and logs `SYNC CONFLICT ...`. A person (the coordinator) then merges
  by hand, inspects every conflicting file and verifies both sides' changes survive. The lane keeps working meanwhile.

## Tests

Windows only (needs `bun`, `git`, `powershell.exe`, `pwsh`; nothing else is installed or contacted; no Codex quota is used - a fake
worker stands in for Codex):

    bun --no-env-file test ./scripts/lanes/tests/lane-controller.test.ts

Eight scenarios, about 3 minutes: stale logs and reports, controller death and re-attach without a duplicate worker, quota pause and
same-session resume, clean integration merge and parking, worker death while the controller is down, idle inbox start, and
conflicting changes that must never be silently lost. On other platforms the tests are skipped.
