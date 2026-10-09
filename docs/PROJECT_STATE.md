# InfraForge project state

Verified 2026-10-09. B0.2 establishes reliable run inputs on `develop`, following
B0.1's shipping-baseline repairs. The local regression, integration and browser
checks below passed. Public multi-user release and promotion to `main` remain
blocked by authentication/ownership and release rehearsal.
See [baseline verification](BASELINE_VERIFICATION.md) for historical failures and
[local integration instructions](../Backend/tests/integration/README.md) to repeat
runtime validation.

## Accepted architecture

- Bun 1.3.14 and Turbo 2.11.6 own the root workspace install and `bun.lock`.
  Apps declare their dependencies. `packages/domain` owns resource/workload rules,
  topology, readiness and examples; `packages/catalog` owns dated SKU data.
  `shared` owns simulation and transport contracts during the bounded extraction.
  Exact import allowances, cycle checks and browser checks constrain that transition.
- React 19/Vite/Tailwind/Zustand/dnd-kit implement canvas, deployment and monitoring.
  Drafts stay in localStorage. Explicit save/update and pre-run deploy save persist
  designs. A saved design, original run input and current live topology are distinct.
- Bun/Express/Zod handles commands. PostgreSQL/Prisma persists designs, deployments
  and transactional outbox entries. Redis/BullMQ dispatches jobs. Validate,
  SecurityScan and CostEstimate are the three gates. The worker runs the shared
  deterministic engine and Redis/WebSockets deliver its snapshots.
- At creation, a transaction locks the design, validates its layout and stores
  version-one `runInputs`: ordered resources/connections, fully resolved workload
  and a generated seed. The same transaction stores the outbox reference. Gates,
  startup and retries read these inputs from the deployment; queue topology and
  later design updates have no authority. Database triggers prevent changing the
  input JSON or captured seed/workload. Existing workload defaults remain 3x peak
  and 80% reads; engine tuning, catalog values and golden expectations are unchanged.
- `liveTopology` and `topologyRevision` belong to a run. Edits use an atomic expected
  revision check; stale requests return 409. Runtime polls durable topology, including
  while paused, and ignores old Redis topology payloads. Snapshots carry the applied
  topology/revision. The browser serializes edit requests, preserves newer local edits
  while a request is pending, and requires re-entry after an unconfirmed edit.
  Reattachment reads live topology without sending the saved design back to runtime.
- One worker owns a database through a dedicated PostgreSQL session advisory lock.
  A competing worker exits; ownership loss stops the worker. Initialization has a
  shared in-flight promise and runtime cycles do not overlap. State is constructed
  from original inputs before the LIVE transition. The initial snapshot is tick zero,
  original topology and zero accumulated cost; subsequent snapshots reflect ticks
  and accepted controls. This requires a direct/session-preserving PostgreSQL
  connection. Transaction-pooling URLs are unsupported.
- Design creation/deletion lock the parent row. Deletion rejects pending, running or
  live deployments and waits for runtime stop acknowledgement after teardown. A
  database trigger also protects direct/cascade deletion of active deployments.
  Runtime checks durable status, so losing the Redis stop message cannot leave it
  running indefinitely; failed stop acknowledgements are retried by the host.
- Restart explicitly fails interrupted LIVE runs and preserves original inputs,
  live topology, history and diagnostic checkpoints. It never silently restarts at
  tick one. Legacy pending/running/live records without original inputs fail with a
  clear reason; historical records are retained without guessed inputs or ownership.
  Create a new deployment to run again. Full checkpoint recovery/replay is absent.
- Costs and resource outcomes come from domain/catalog data and simulated time.
  These are documented educational approximations, not cloud guarantees. Identical
  inputs, engine behavior and tick-ordered controls reproduce outcomes; timestamps
  and orchestration timing are not byte-identical replay.

## Verification

B0.1 repaired workspace TypeScript/lint, stale frontend state, malformed layouts,
request parsing, retries, WebSocket cleanup and 30 dependency advisories. Its final
checks and release limits remain recorded in BASELINE_VERIFICATION.md.

B0.2 final checks used the installed tools and disposable local services:

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass; lockfile/dependencies unchanged |
| `bun run typecheck -- --concurrency=1` | Five tasks passed, including Prisma generation |
| `bun run test -- --concurrency=1` | 89 passes, zero failures, two intentionally gated integration skips |
| Engine goldens | All 30 passed; file and expectations unchanged |
| `bun run lint -- --concurrency=1` | Three lint tasks passed; final boundary check covers 815 imports, no cycles/browser runtime leaks |
| `bun run test:tooling` | Eight passes, zero failures, 26 assertions |
| `bun run build -- --concurrency=1` | Three tasks passed; 2,051 modules; JS 563.02 kB / 170.81 kB gzip |
| `bun audit --json` | Exit zero, `{}` |
| `pwsh ./scripts/test-integration.ps1` | Eight passes, zero failures, 266 assertions; lifecycle 94.05s / suite 95.25s |

The lifecycle verifies outbox rollback, immutable inputs despite saved edits and
corrupt saved layouts, original tick-zero/tick-one state, gate retry recovery and
exhaustion, stale/duplicate jobs, a competing worker, revision conflicts, live/original/
saved separation, chaos/scaling/cost, checkpoint evidence, crash restart, teardown,
creation/deletion races and worker ownership-connection loss. Existing WebSocket
subscription, pending-close and frame-size checks also pass.
The migration check applies the previous SQL schema to a fresh disposable database,
inserts historical/pending/live records, and verifies that the additive migration
preserves every existing column and design owner without inventing run inputs.

Browser QA used a separate isolated fixture: re-entry loaded a live-only resource,
a browser rename advanced revision 1 to 2 while original/saved inputs remained
unchanged, re-entry loaded revision 3 without writing, and a stale browser did not
overwrite revision 4. Re-entry then showed the current name and real server telemetry.
No redesign or full responsive/accessibility review is claimed.

Initial validation exposed two JSON typing errors and two test typing errors;
all were corrected before final checks. One integration assertion incorrectly waited
on an unsubscribed WebSocket channel; it now observes that fixture's Redis channel.
A later control observer mistook a delayed stale-topology test message for a speed
command; it now matches both deployment and action before asserting the payload.
Windows Bun instability from B0.1 recurred: an illegal instruction during Prisma
CLI generation, a unit child exiting 9, and a worker exiting 9 before its snapshot.
The final serial checks and full native lifecycle passed; this does not establish
long-term host stability. The browser fixture's wrapper exited 1 because an owned
Vite child held its stderr pipe after the Bun parent exited. Its UI assertions and
container cleanup completed; the verified Vite child was stopped separately.
Raw successes, failures, browser observations and resource records remain local.
The official Prisma generator leaves one whitespace-only line in its generated
namespace file; authored source passes the whitespace check.

## Remaining risks and next milestone

1. **Public-use blocker:** HTTP/WS authentication and ownership remain absent.
   Browser-local authentication is a placeholder and `userId` defaults to `test-user`.
   Define and implement real identity, ownership and authenticated HTTP/WS contracts.
2. **Release blocker:** rehearse additive migration before starting the new backend,
   coordinate the frontend revision API, stop old workers, confirm a direct/session
   database connection, and test health, rollback and version compatibility. Old
   workers are incompatible with immutable-input/delete triggers. No production
   database, secrets, deployment or transaction-pooling environment was accessed.
3. **Operations:** worker interruption ends a run. There is no checkpoint recovery,
   replay or high availability. PostgreSQL polling/ownership adds database traffic;
   measure hosted connection and workload limits before release. Single-worker
   enforcement is tested locally, not under production network partitions/poolers.
4. **Development:** intermittent native Bun exits remain unexplained. The successful
   final runs are bounded evidence, not a runtime-version or hardware fix.
5. **Deferred:** load/chaos/scaling/speed controls still lack durable acknowledgement
   and replay. API/WS budgets and proxy-aware rate limits need deployment review.
   Final DB-write failure may leave a pre-LIVE run pending/running until recovery.
6. **Compatibility/product:** legacy layouts were not scanned; semantic SKU validation,
   corrupt draft handling and configuration defaults need focused work. Reports and
   settings remain stubs. Beginner support, narrow-screen usability and modal focus
   need product work. The bundle-size warning and Prisma override compatibility
   follow-up remain.

Next milestone: authentication/ownership, then release migration/readiness/rollback
rehearsal and independent architecture/security review before `develop` to `main`.
B0.2 authorizes neither promotion nor production deployment. Required local tool
configuration and unique evidence are retained; only positively identified disposable
scratch and owned test resources are removed at checkpoint closure.
Cleanup retained 22 evidence files and removed 34 verified disposable/duplicate files
(1,330,804 bytes) and six empty fixture directories. No owned test containers,
volumes, networks, processes or application listeners remained at closure. Three
detached worktrees were inspected read-only; all 291 recorded files in each were
unchanged. Unknown older scratch and required tool configuration were preserved.
Docker Desktop was unavailable on the later publication recheck. The managed
cleanup records and earlier successful resource inventory establish fixture removal;
no fresh Docker inventory is claimed while its daemon is stopped.
