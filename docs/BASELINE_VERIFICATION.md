# B0.1 baseline verification

Recorded 2026-10-09. Source of truth: the repository commands and disposable local
runtime runs described below. This is a `develop` review checkpoint; it is not a
production release approval. See [project state](PROJECT_STATE.md) for architecture
and the next milestone.

## Audit scope and safety

The audit covered all 13 commits from `main` at
`36a570676a11ba6b2d1183e91fa9fbef9c1e7550` through starting `develop` at
`8c164e3b9923ecae8d3a86d84469b0f2b8da7bf5`: the rescued application changes,
development launcher, repository standards, integration baseline, Bun/Turbo
workspace migration and domain/catalog extraction. Source, callers, tests,
manifests, lockfile, Docker context, workflows and documentation were inspected.
Historical workflow changes were distinguished from application changes.

Starting checkout and remote refs matched, with 13 commits ahead and none behind.
Configured Git identity matched the owner and existing commits. The owner confirmed
intentional archive deletion and sole active
writer. The three detached checkouts had stale Git links; their application file
metadata was unchanged across two observations and no process command referenced
them. Final read-only checks compared 291 file metadata records per detached tree,
with zero changes and no other process references. They were left untouched. Environment-file contents,
external secrets and production infrastructure were not accessed.

## Failures reproduced before repairs

| Check from repository root | Initial result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; 467 installs, 524 packages, unchanged manifests/lockfile. |
| `bun run build` | Three tasks passed; frontend chunk exceeded Vite's 500 kB warning. |
| `bun run typecheck` | Failed: six TS1484 errors in shared DeploymentJob, OutboxPayload and TickResult imports. |
| `bun run lint` | Failed: 26 frontend errors and four warnings, including unsafe types, unused bindings and copied state in effects. |
| `bun run test` | 59 passed, zero failed; one explicitly gated lifecycle test skipped. |
| `bun run check:boundaries` | Passed: 729 value/type imports, no file/workspace cycles. |
| `bun run test:tooling` | Eight passed, 26 assertions. |
| `bun audit --json` | Failed: 30 advisories across ten packages: one critical, 19 high, ten moderate. |
| `bun run test:integration` with fresh services | First Windows attempt exited 9 after approximately 112 seconds without a final assertion report/evidence file. |

## Confirmed defects and repairs

| Defect | Repair and evidence |
| --- | --- |
| Shared value imports used for TypeScript types | Type-only imports; all workspace typechecks pass. |
| Frontend lint failures and stale copied selection/configuration | Typed drag events, layout counts and errors; resource-derived configuration; keyed selections/modal lifetimes. ESLint passes without disabled rules. Browser checks cover switching resources, retaining SKU/policy values and reopening a cleared modal. |
| Frontend name limit 64 disagreed with API limit 30; API error said 20; whitespace-only short names passed raw length checks | One domain validation rule for trimmed names of 3–30 characters, used by create/update and save/deploy UI. Boundary tests and browser validation pass. |
| Live cards showed healthy/zero values before telemetry arrived | Explicit waiting state; rendered-card regression proves no invented health, CPU or RPS before a snapshot. |
| Failed optimistic speed request left the requested value displayed; a late rollback could overwrite newer telemetry or a reset session | Return a conditional rollback from the store setter and invoke it on request failure. Three store regressions cover ordinary rollback, newer server telemetry and session reset. The API control path is covered by integration; browser network-failure rollback has not been directly exercised. |
| Saved layouts accepted arbitrary records; live topology accepted arbitrary array elements | Validate resource/connection shape, numeric fields and reserved object-property IDs before persistence/reconciliation; preserve JSON metadata and accept empty saved drafts. Deployment creation also rejects malformed legacy saved layouts before creating a run. |
| Invalid/oversized JSON and unsupported content encoding reached the generic 500 handler | Return 400/413/415; the isolated HTTP regression proves the process still accepts subsequent requests. |
| Repeated subscriptions allocated multiple Redis connections; disconnect during asynchronous subscribe could leak one | One coalesced subscription per socket, cancellable pending work, replacement/close cleanup, stale-event suppression and UUID validation. Failed subscriptions close with 1011 so the existing browser client reconnects. |
| Bun 1.3.14 ignored the `ws` server's `maxPayload` setting | Reproduced with a 1,025-byte message that remained open. Check bytes before JSON parsing/subscription allocation; the repaired probe closes with 1009. This limits application message handling, not allocation of the underlying received frame. |
| First transient worker error marked a deployment failed, so later queue attempts were skipped | Keep RUNNING between configured retries and publish failure only on the last attempt. Real SQL-trigger failure recovers on attempt two, with no intermediate failure event. |
| Late jobs could rerun a torn-down deployment or repeat gates for a live deployment | Retired-state guard and idempotent live attachment. Unit policy tests and real post-teardown job check pass. |
| The first retry repair could demote LIVE and overwrite a concurrent retired status in its failure handler | Conditional atomic status updates only affect PENDING/RUNNING; LIVE/retired runs are preserved. |
| Exhausted chaos-notification delivery could mark a live simulation failed | Only failed deployment-created delivery can fail a pending/running deployment; notification exhaustion records its outbox error without inventing simulation failure. |
| New frontend tests could not resolve the source aliases | Central frontend path configuration used by Bun, application and test TypeScript configurations. Tests/build/typecheck pass. |
| Validation omitted dependency audit | Add the root JSON audit command and CI matrix check. |
| Production workflow did not require validation, stopped containers before building and globally pruned images | Reuse validation, serialize deployments, check the triggering SHA, use fast-forward-only pull and build before `compose up`. No production execution was performed. Health, migration and rollback limitations remain below. |
| Documentation claimed nine stages/real-cloud fidelity and included framework template/stub instructions | Document the actual three gates, workspace commands, dated catalogs, educational model and restart limits. |

No engine tuning, SKU numbers, golden expectations or committed migration SQL were
changed. Prisma schema changes remove a stale comment only; the corresponding
tracked generated schema text was refreshed. No database schema migration is added.

## Dependency repairs

| Package | Resulting version/action | Initial advisory count |
| --- | --- | --- |
| axios | 1.20.0 | 12 |
| brace-expansion | 5.0.12 | 3 |
| deepmerge-ts | 8.0.0 override | 1 |
| fast-uri | 3.1.8 | 6 |
| ip | Remove unused backend dependency | 1 |
| mysql2 | 3.23.1 override | 2 |
| nanoid | 3.3.18 | 1 |
| proxy-addr | 2.0.8 | 1 |
| qs | 6.16.0 | 2 |
| source-map-js | 1.2.2 | 1 |

Changes were limited to the affected dependencies. The deepmerge-ts major override
was necessary for its fix; current Prisma configuration uses plain records, and
fresh generation/migration passed. MySQL2 is a Prisma transitive dependency; this
application uses PostgreSQL. Advisory presence does not establish exploitation.
Proxy trust is not enabled in the current API, so its critical advisory's affected
trust configuration was not demonstrated here. The final audit returned `{}` and
exit zero; this does not resolve missing application authentication.

Primary references: [Axios release](https://github.com/axios/axios/releases/tag/v1.20.0),
[proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
[deepmerge-ts advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[deepmerge-ts compatibility changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[MySQL2 advisory](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3),
[unused ip advisory](https://github.com/advisories/GHSA-2p57-rm9w-gvfp).

The deepmerge-ts and MySQL2 overrides exceed Prisma's pinned versions. Successful
generation/migration covers the exercised PostgreSQL path; it is not upstream
compatibility certification. Recheck those overrides when Prisma changes. The
WebSocket runtime finding has an [upstream report](https://github.com/oven-sh/bun/issues/36116);
the local Bun 1.3.14 probe, rather than the report's different runtime version,
establishes the behavior used for this repair.

## Final validation

The final Linux application checkpoint contains public source only, with a fresh frozen
install using Bun 1.3.14. It contains no environment files or existing generated
Prisma client; generation uses the repository command. Windows results are kept
separate where a later Linux check supplies the final evidence.

| Check | Result |
| --- | --- |
| Frozen install | Windows: 465 installs/522 packages, unchanged lockfile. Fresh Linux install: 465 packages. Final Linux recheck: 469 installs across 522 packages, no changes. |
| Typecheck | Final Linux serial run: five tasks passed, including fresh Prisma generation and frontend test types. |
| Unit/golden tests | Final Linux: 79 passed (backend 50, domain 15, catalog nine, frontend five), zero failed, one deliberately gated lifecycle skip. All 30 engine goldens passed unchanged. |
| Lint/boundaries | Final Linux lint: three tasks passed; 771 imports with no cycles. Backend has no ESLint task; its TypeScript/tests are checked separately. |
| Tooling tests | Final Linux: eight passed, 26 assertions. |
| Build | Final Linux serial: three tasks passed; 2,053 frontend modules, 564.48 kB JS / 171.31 kB gzip. Windows earlier serial build passed; large-chunk warning remains. |
| JSON audit | Final Linux: `{}`, exit zero. |
| Disposable integration | Final Linux: seven passed, zero failed, 205 assertions, 95.62 seconds; two Turbo tasks passed in 102.598 seconds. |
| Actual backend Dockerfile | Passed: frozen install, fresh Prisma generation and export/unpack; image `afa614bf4f93b125d25b11681510c1824d65cc4d6cb0597101369c8a7a38800f`. API/WS health 200; worker running; Redis event forwarding, 1009 frame rejection and zero subscribers after close passed. |
| Browser | Passed against separate disposable services: save/deploy/live telemetry, pause/speed, crash injection, vertical-scale command, live-only rename, teardown, explicit update, second run and second teardown. Save/confirmation modal reset and SKU/autoscale selection retention passed. |
| Final diff/Git checks | `git diff --check` passed. The final local review and delivery checks are recorded below; no additional external review was invoked. |

Hash comparisons confirmed all 262 authored application/test/configuration files
matched the final Linux copy at that checkpoint; generated clients and documentation
were excluded. A later comparison found 261 still identical and only `package.json`
changed to add the managed local integration command. That runner and its documentation
were added afterward and checked separately below; application source is unchanged.
The normal unit command intentionally skips the destructive-to-fixture lifecycle
until explicit disposable settings are supplied. The separate integration command
executed it against fresh PostgreSQL 17 and Redis 8 in an owned Linux container
network. After preserving evidence, all 18 owned test containers and their disposable
anonymous volumes were removed; images/logs were initially retained. The later closure
audit removed six unused test images and redundant build/install copies while preserving
the logs, JSON results, screenshots, source hashes and review records. No existing development
database was migrated or reset.

## Temporary-resource closure

The five reported B0.1 container names were absent both before and after the closure
audit. Their screenshot time was not available, so its relation to cleanup cannot be
proved. The 11 older, unrelated/development containers remained untouched and stopped.
All 16 existing volumes and common build cache were preserved, including two unreferenced
anonymous volumes whose B0.1 ownership could not be proved. Only six positively identified,
unused B0.1 image tags and two redundant temporary install/build directories were removed.
Docker reported image storage falling from 5.033 GB to 3.230 GB; retained cache still
occupied 5.431 GB. Removing image references increased cache classified as reclaimable;
it did not reclaim that cache. Windows free space increased by about 787 MB during the
measured deletion interval. This observed change includes possible background activity
and is separate from Docker's logical/reclaimable figures; no disk compaction was performed.

The new `test:integration:local` runner follows the
[temporary-resource lifecycle](../Backend/tests/integration/README.md). Final checks:

- PowerShell syntax parse passed. Frozen install checked 465 installs/522 packages,
  with no manifest/lockfile changes. Boundaries passed again at 771; JSON audit returned `{}`.
- Normal guard run: six passed, zero failed, 40 assertions; exit zero and no cleanup errors.
- Deliberately occupied WebSocket port: six guards passed and the lifecycle failed before
  migration, as expected; exit one, preserved evidence, no cleanup errors or fixtures left.
- Ctrl+C after child startup: exit one, recorded interruption, owned process gone,
  test ports free, logs retained and no Docker fixtures left.
- Recovery preserved mismatched container/network labels and a referenced volume,
  reported errors and exit one. Those separately owned test sentinels were then removed.
- Repeated recovery on a completed run passed and left the original evidence hash unchanged.

The final closure below also ran the complete lifecycle through this Windows wrapper.
Its provisioning, failure, interruption and refusal paths retain the separate checks
above. Abrupt host termination cannot guarantee `finally`; labeled recovery remains
available after checking no run is active.

## Final local closure on the delivery tree

The final local review covered all 67 changed/new project files, their callers,
the previous supplied-material findings and retained runtime evidence. The small
additional speed rollback repair preserves newer snapshots/session resets; controlled
sequences reproduced the preceding handler overwriting speeds 60 and 1 with 10.
The three corrected regressions pass. No additional external review was invoked;
independent architecture/security and production review remain promotion requirements.

All commands below ran from the repository root on native Windows with Bun 1.3.14.
Heavy checks ran serially. Generation used an explicit nonsecret placeholder URL and
a nonexistent dotenv path; integration used fresh labeled loopback-only services.

| Command | Final result |
| --- | --- |
| `bun install --frozen-lockfile` | Exit 0; 465 installs/522 packages, no changes. |
| `bun run typecheck --concurrency=1` | Exit 0; five tasks including fresh Prisma generation and frontend test types, 57.74 seconds. |
| `bun run test --concurrency=1` | Exit 0; 82 passes: backend 50, domain 15, catalog nine, frontend eight; zero failures, one deliberately gated lifecycle skip. All 30 engine goldens remain unchanged. |
| `bun run lint --concurrency=1` | Exit 0; three tasks, no suppressed lint rules. |
| `bun run check:boundaries` | Exit 0; 773 imports, no file/workspace cycles. The final speed repair did not widen legacy allowances. |
| `bun run test:tooling` | Exit 0; eight tests/26 assertions. |
| `bun run build --concurrency=1` | Exit 0; three tasks, 2,051 frontend modules, 561.69 kB JS / 170.51 kB gzip. The 500 kB chunk warning remains. |
| `bun audit --json` | Exit 0; `{}`. |
| `bun run test:integration:local` | Exit 0; seven tests, zero failures, 205 assertions; test command 100.43 seconds, lifecycle case 99.29 seconds, two Turbo tasks 113.487 seconds. Wrapper provisioning/test/disposal completed in 134.913 seconds. |

An intermediate boundary check saw a temporary test-only shared type import while
the speed regression was being prepared. The import was removed; allowances were
not widened, and the complete final suite above passed afterward.

Of the 262 earlier Linux source-manifest entries, 259 still match. The three later
changes are the root local-runner command and the two frontend speed files; the new
speed regression is additional coverage. All backend runtime/test source still
matches the earlier image/Linux evidence and was exercised again by the full native
Windows run. The earlier service-backed browser flow remains evidence for unchanged
save/deploy/chaos/scaling/live-edit behavior; no new full browser or independent
visual/accessibility sign-off is claimed for this closure.

The Windows run verified transactions/outbox rollback, all three gates, transient
and exhausted retries, LIVE/retired status preservation, notification delivery failure,
deterministic first snapshots, live controls, saved/live separation, checkpoint/restart,
teardown, duplicate/pending subscription cleanup and oversized-frame close 1009.
Both the harness and wrapper reported no cleanup errors. A separate inventory check
confirmed all 11 existing containers and 16 existing volumes were preserved; the two
test containers, their named volume and network were gone, ports 3001/3100 were free,
and the recorded root test process had exited. No test image was created or pulled.
The three detached checkouts still matched all 291 prior metadata records each,
with no process references; they were not modified. Important results/logs/review
evidence remain local, outside Git delivery.
Seven verified disposable files (813,307 logical bytes) and one empty temporary
directory were removed after retaining byte-identical runtime evidence and review
scope/fingerprint records. These were redundant test evidence copies, canceled unsent
review drafts and a one-time rollback probe. Earlier approved/rejected review evidence
and all important runtime results were preserved. No broad prune or disk compaction ran.

## Runtime evidence and failed attempts

The earlier final Linux evidence file is preserved locally.
It records the architecture, seed, command ticks, Redis and WebSocket events,
process lifecycle, checkpoints and cleanup. Result: `passed`; cleanup errors: none.

The run verified save/read/update, transactional outbox rollback, duplicate delivery,
three ordered gates, transient retry recovery, readiness failure, outbox retry
exhaustion, malformed requests, one Redis subscription per socket, live listing,
engine/host equivalence, load, chaos, vertical/pool scaling, pause/speed, live topology,
saved/live separation, disconnect/reconnect, worker restart and active teardown.
An additional retired job completed without resurrecting the deployment. Failure
after LIVE preserved LIVE without repeating gates. A gate write failure recovered
on attempt two without duplicate stages/timeline entries; permanent gate failure
exhausted two fixture attempts and published one failure. Started events repeated
on retry, as expected. A failed notification outbox left the main simulation LIVE;
the dedicated Redis's temporary PUBLISH restriction was restored. Closing during
a Redis-paused pending subscribe left zero subscribers. A 1,025-byte message closed
with 1009, and WebSocket HTTP health remained 200.

Checkpoint: simulated second 2,803 and accumulated cost 0.3877572488584603 USD.
Restart: simulated second one, speed one and cost 0.00010960806697108064 USD, matching
the original first snapshot. Live-only storage disappeared on restart. These are
evidence of the current restart limitation, not proof of checkpoint restoration.

Earlier Windows lifecycle rerun passed seven tests/172 assertions in 83.76 seconds.
The expanded Windows rerun later failed with six guard tests passing and one lifecycle
failure after its API child exited 3 with a native illegal-instruction diagnostic;
the next request received ECONNRESET. Another attempt was blocked before test startup
by Docker API failure. Concurrent typechecking encountered out-of-memory, a tooling
run crashed natively before passing on retry, and plain `bun audit` had a native
stack-overflow failure; JSON audit passed. Docker builds lost the engine with EOF
during export before the engine recovered. These failures are preserved as test-host
risks; their exact cause has not been proved. Minimal child-stop probes and an isolated
HTTP parser sequence passed. Linux completion does not prove Windows runtime stability.

The first post-review Linux transport test timed out at 180 seconds (six guards
passed, one lifecycle failed, 203 assertions) because Bun ignored `maxPayload` and
the client never received the expected close. That timeout interrupted fixture
cleanup; its services remained isolated and owned. A bounded probe reproduced the
ignored limit before the application byte guard was added. The corrected full
rerun above passed and reported no cleanup errors. No timeout was increased to
hide the defect.

Browser evidence: nine saved nodes, all three completed gates and live monitoring.
The paused failure view at tick 972 showed vm-1 FAILED and the other VM SATURATED.
A live-only rename left the saved VM name absent in PostgreSQL; the later explicit
update stored it. A second deployment became LIVE with that saved name, and both
runs were torn down. No browser errors/warnings were recorded during the service-backed
flow. Screenshot `browser-live-failure.png` and database evidence are preserved locally.
This is functional desktop QA, not an independent visual/accessibility sign-off.
Keyboard closing of the confirmation modal returned focus to BODY rather than the
opener. The common modal has no attached trigger; this accessibility gap remains.

## Open defects, limits and promotion decision

- **Critical for public multi-user release:** API/WS lack authentication and ownership;
  browser SHA-256/localStorage authentication is a placeholder, `userId` defaults to
  `test-user`, and CORS is unrestricted. Do not expose this baseline as a secure service.
- **High:** queued snapshot gates and startup's current saved layout can disagree.
  Define immutable run identity/snapshot/replay/recovery contracts before changing storage.
- **High:** checkpoints are not restored. One worker owns the live registry; multiple
  workers can duplicate simulations. Controls have no durable acknowledgement/log.
- **Operational:** the default ten-attempt exponential queue policy waits up to
  5,110 seconds in backoff (about 85 minutes), and started notifications repeat.
  A final failure write during a database outage can leave RUNNING stale. A run
  can remain LIVE without a simulator after startup fails; LIVE/retired status is
  now preserved rather than silently demoted. Registry checks before asynchronous
  startup can race. Define failure/recovery budgets with the run contract.
- **High for release:** production migration order, readiness/health checks, rollback
  and frontend/backend version compatibility have not been rehearsed. The SSH/Compose
  workflow's static repairs do not establish safe production operation.
- **Medium:** checkpoint I/O can overlap; requests and subscriptions lack application
  resource budgets. The in-process 1,000-request/15-minute limiter needs a deployment
  review for proxy behavior and aggregate traffic.
- **Medium:** dashboard reattachment sends saved topology back into the live run and
  can lose live-only edits; refresh does not fully recover the monitor session.
- **Medium:** corrupted localStorage JSON can break draft loading. SKU/category and
  topology semantic validation remain incomplete; unknown SKUs use generic estimates.
  Autoscale UI defaults 2/6 can differ from engine defaults for a non-two-node pool.
  Configuration semantics and default sourcing need a focused domain milestone.
- **Compatibility/operations:** existing development or production layouts were not
  scanned. Legacy malformed layouts can fail resave and now return 400 on deployment.
  Dependency overrides need Prisma compatibility checks. All audit findings currently
  block validation/deployment, even new development-only advisories; a hotfix severity
  policy is unresolved. Removing global image pruning leaves disk retention to release
  operations. Speed rollback now preserves newer state, but there is no durable
  server acknowledgement.
- **UI/documentation:** reports/settings are stubs, beginner journey support is incomplete,
  narrow-screen canvas/toolbar usability needs design work, and an existing footer
  repository link points to a different owner. No full responsive/accessibility or
  independent visual-polish review is claimed. Bundle size warning remains.
- The supplied-material independent review accepted a develop review checkpoint
  conditionally and blocked main/public release. Its LIVE failure-handler finding
  was repaired. It ran no commands and did not independently verify runtime results.
  Final local review checked the current corrections and evidence; no further external
  transfer was made, and no identity/storage/vendor choice was guessed.

Production deployment, external secrets, multiple-worker behavior, complete checkpoint
recovery and full visual/accessibility review were not tested. `develop` → `main`
promotion is not approved by this baseline. Resolve the release contracts above and
obtain independent review before that stage.

## Git delivery state

Original 13 commits remain intact. The starting and pre-delivery remote `develop`
were `8c164e3b9923ecae8d3a86d84469b0f2b8da7bf5`; remote `main` remained
`36a570676a11ba6b2d1183e91fa9fbef9c1e7550`. Corrective commits are limited to reviewed
public project files on `develop`, with the verified owner identity. Final publication
requires a normal push and an actual remote-SHA comparison; the delivery report records
that result. No `main` change or production deployment is part of this checkpoint.
Source/test/configuration repairs are commit
`309815a07e122bf6f8a32ada157f0e764061eb4e`; the companion documentation commit records
the final results above. Neither commit changes the original 13-commit history.

## B0.2 follow-up

The results above describe B0.1. B0.2 stores immutable deployment inputs, orders
durable live topology edits, guards active deletion, enforces one worker per database
and explicitly fails interrupted runs instead of resetting at tick one. Its final
unit, migration, runtime and browser results are recorded in
[PROJECT_STATE.md](PROJECT_STATE.md). Authentication/ownership and release rehearsal
remain required before promotion to `main`; checkpoint recovery is still absent.
