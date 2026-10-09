# InfraForge project state

Verified 2026-10-09. B0.1 is the validated repair checkpoint for `develop`.
The final local review and required checks are complete. Promotion remains blocked by the
identity, run-persistence and release-safety decisions below.
See [verification evidence](BASELINE_VERIFICATION.md) for exact checks, failures and limits.
Validated source checkpoint: `309815a07e122bf6f8a32ada157f0e764061eb4e`.

## Accepted architecture

- Bun 1.3.14 and Turbo 2.11.6 own the root workspace install and single `bun.lock`.
  Frontend/backend declare their package dependencies. Domain/catalog export TypeScript
  source, have no emitted build, and remain narrow, browser-safe packages.
- `packages/domain` owns resource/workload vocabulary, topology, readiness and examples;
  `packages/catalog` owns dated AWS/DigitalOcean SKU data. `shared` still owns simulation
  and transport contracts during extraction. Exact legacy allowances and cycle/browser
  checks constrain that transition; further extraction is a separate milestone.
- React 19/Vite/Tailwind/Zustand/dnd-kit implement the canvas, deployment and monitoring.
  Drafts persist locally. Explicit save/update and pre-run deploy save use the API;
  live topology edits change runtime state without saving the architecture.
- Bun/Express/Zod handles commands. PostgreSQL/Prisma stores layouts, deployments and
  a transactional outbox. BullMQ/Redis dispatches worker jobs. Validate, SecurityScan
  and CostEstimate are the three gates. The worker hosts the shared deterministic
  engine; Redis events are forwarded through WebSockets to browser stores.
- Costs and resource behavior come from catalog/shared model data. Capacity, generic
  costs and failure/scaling behavior are educational approximations, not cloud guarantees.
  Same seed/input/tick controls reproduce engine outcomes; wall-time metadata does not.
  Checkpoints are written but current restart starts again from saved layout and seed,
  resetting simulated time/cost. The first published snapshot is tick one, speed one,
  with one tick's cost. Full checkpoint recovery is not implemented.

## B0.1 repairs and checks

Repairs cover six TypeScript import errors, frontend lint and stale state, shared
name validation, absent-telemetry presentation, malformed saved/live layouts,
JSON parser errors, deployment retries/retired jobs and WebSocket subscription cleanup.
Failed speed requests restore the preceding value only while their optimistic state
is current; late failures preserve newer snapshots and reset monitoring sessions.
Failure handling now preserves LIVE/retired statuses and does not turn notification
delivery failure into simulation failure. Bun's ignored WebSocket payload setting
has an application byte guard before subscription parsing.
Targeted dependency changes removed the 30 reported advisories; framework versions,
catalog numbers, engine tuning, golden expectations and committed SQL are preserved.
CI now audits dependencies. Production deployment requires validation, checks the
triggering SHA, serializes releases and builds before replacing containers.

Final native Windows frozen install, serial build/typecheck, lint, unit/golden tests,
import boundaries, tooling tests and JSON audit passed: 82 unit passes, zero failures,
one deliberately gated lifecycle skip, 30 unchanged engine goldens, 773 import edges
and eight tooling tests. The frontend build processed 2,051 modules and emitted
561.69 kB JavaScript / 170.51 kB gzip; the large-chunk warning remains.
The full managed Windows disposable lifecycle passed seven tests/205 assertions,
zero failures, in 100.43 seconds, including post-gate retries,
notification failure, pending subscription cleanup, frame rejection, checkpoint/restart
and teardown. Its runner exited zero and disposed of both test containers, the named
volume and network; a separate inventory check confirmed no fixtures or test listeners
remained and all 11 existing containers were preserved. Earlier Linux lifecycle
validation also passed. The actual backend Dockerfile previously built; API/WS health returned 200,
the worker stayed running, and image event forwarding/cleanup/frame rejection passed.
Browser save/deploy/telemetry/chaos/scaling,
live-only edits, explicit update, rerun and teardown passed against isolated services.
Earlier Windows native runtime failures remain documented; this successful run does
not establish long-term host stability. Final local review covered all 67 changed/new
files and the retained verification evidence. The earlier supplied-material review's
LIVE-status finding was repaired, and its gate-retry hypothesis was checked against
actual post-gate recovery/exhaustion tests. No additional external review was invoked.
No independent runtime or full visual/accessibility review is claimed. Keyboard modal
return focus remains an accessibility gap.

Temporary test/build resources follow Create → Use → Capture Evidence → Verify →
Remove → Confirm Cleanup. The local integration runner labels each run, preserves
logs and checks ownership/references before disposal. See the
[integration guide](../Backend/tests/integration/README.md). Cleanup-runner checks
include success, expected failure, interruption, conservative recovery and the final
complete Windows lifecycle.

## Release blockers and next milestone

1. **Critical for public multi-user use:** API and WebSocket requests have no backend
   authentication or ownership checks. Browser-local password/session storage is a
   placeholder; `userId` defaults to `test-user`. Define identity, ownership and
   authenticated HTTP/WS contracts before implementation.
2. **High:** gates use the queued layout snapshot, while simulation startup loads the
   current saved layout. Define an immutable, versioned run snapshot and its relation
   to explicit saves, live edits, checkpoints, replay and restart before changing storage.
3. **High for Windows development:** investigate intermittent Bun native crashes and
   host resource exhaustion. Final Linux validation and one complete native Windows
   lifecycle passed; intermittent failures remain unexplained. Do not change runtime
   versions without evidence.
4. **High for release:** define/rehearse migration order, health/readiness, rollback,
   frontend/backend compatibility and the single-worker operating limit. Production was
   not accessed or deployed. Existing SSH/Compose infrastructure is preserved.
5. **Medium:** no durable control acknowledgement/log, overlapping checkpoint work can
   lag under I/O stalls, and reconnecting through the dashboard can replace live-only
   topology with the saved layout. API/WS resource budgets and proxy-aware rate limits
   need a deployment-specific review. The frontend bundle remains above Vite's 500 kB warning.
6. **Operational/compatibility:** default job retries can spend about 85 minutes in
   backoff. Final database-write failure can leave stale RUNNING rows, and startup
   failure can leave LIVE without a simulator. Pre-await registry checks can race.
   Legacy layouts were not scanned, Prisma dependency overrides need future compatibility
   checks, and audit severity/hotfix and image-retention policies remain unresolved.

Next milestone: resolve identity/ownership and immutable run-snapshot/recovery
contracts, implement their regression coverage, and rehearse release migration,
readiness and rollback. Obtain independent architecture/security review before
promotion to `main`. B0.1 does not authorize production deployment.
