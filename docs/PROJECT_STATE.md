# InfraForge project state

Verified locally 2026-10-13 on `develop`. **Reliable Run Evidence and Honest Rerun +
Compare are implemented.** Hosted production cutover remains **PARKED**. This
milestone did not access Neon, EC2/AWS, hosted PostgreSQL/Nginx, Vercel, DNS, OAuth
settings, production secrets or `main`.

See [local setup](../Readme.md), [authentication](AUTHENTICATION.md),
[integration tests](../apps/backend/tests/integration/README.md) and the existing
[release procedure](DEPLOYMENT.md). This is the main project state; keep evidence
outside Git and do not create executor memories or planning archives.

## Product direction and policy

Complete **Challenge → Build → Predict → Run → Break → Understand → Improve →
Run again** before expanding scope. Preserve the visual identity and use progressive
disclosure. **Observed / Interpreted / Unknown is permanent.** Interpretations need
retained deterministic evidence. Results describe an educational model, not cloud
bills, production sizing, recovery guarantees or statistical proof.

Keep modules small, boundaries explicit, migrations additive and published history
intact. One mutating executor uses the owner Git identity. Approved model policy:
GPT-6.1 Sol, Extra High; INNER NONE. External review needs scoped owner authorization.
Develop work cannot promote/deploy main or operate on production data.

## Accepted architecture and foundation

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | React 19/Vite/Zustand canvas, monitoring, history and reports |
| `apps/backend` | Express, Prisma/PostgreSQL, outbox/BullMQ, worker, WS and report derivation |
| `packages/domain` | Resource/workload types, graph/readiness rules and examples |
| `packages/catalog` | Provider SKU data and lookup |
| `packages/contracts` | Inputs, deployment, actions, telemetry and report DTOs |
| `packages/simulation` | Deterministic engine, runtime, cost, capacity and tuning |

Bun 1.3.14/Turbo 2.11.6 own one root install/lockfile. Browser imports cannot reach
engine/runtime/cost. Prisma 7.9.1 has twelve migrations; the first eleven are
unchanged. Migration 12 is `20261013010000_honest_reruns`. Simulation model remains
`1`, catalog `2026-08`; engine source, RNG consumption and all 30 goldens are unchanged.

Better Auth 1.7.7 uses database sessions, exact HTTP/WS ownership and permitted
Origins. Cookies are host-only, HttpOnly, SameSite=Lax and Secure on HTTPS. WS checks
expiry, revocation and run ownership before subscription/delivery. Ownerless legacy
history stays quarantined. Dry-run-first ownership recovery needs independent
evidence, a verified design owner and inactive unassigned linked runs; detached
ownerless runs remain quarantined. Google/GitHub OAuth still requires owner
credentials and end-to-end verification. No fixture-login endpoint is public.

`bun run dev:setup` prepares labelled PostgreSQL 18/Redis 8 resources. `bun run dev`
migrates/generates and supervises API, worker, WS and frontend with generated local
configuration, ignoring app dotenv/hosted settings. Database/Redis ports 55432/56379
and application ports 3000/3001/3002/5173 bind to loopback. Unknown resource/port
collisions are refused. Accepted listener/four-process smokes preserve developer
storage. Worker ownership requires a session-preserving PostgreSQL connection;
restart explicitly fails interrupted runs/actions rather than resuming checkpoints.

## Reliable inputs, controls and evidence

Creation captures validated topology, fully resolved workload, seed and V2
model/catalog provenance. Gates, initialization and retries use those immutable
inputs. V1 remains readable without invented metadata; incompatible V2 execution
is refused. Saved design, original input and revisioned accepted/applied live
topology stay separate. Duplicate initialization/jobs cannot replace inputs.

Runs own nullable `ownerId` and captured `runName`. Verified linked ownership/name
was backfilled without assigning ownerless history. Backfilled legacy names are
not claimed as original names. SQL/HTTP block design deletion while runs are active;
inactive design deletion uses SET NULL and preserves run/report/action ownership.

`RunAction` durably records load, speed, chaos, vertical/pool scale, topology and
teardown. Owner/live/target/SKU/pool/revision checks precede insertion. A row lock
allocates unique per-run sequence. The worker polls PostgreSQL each second, even
while paused; Redis notifications are optional. Lifecycle is requested → applying
→ running/completed, or failed/cancelled. Failed acknowledgements freeze the exact
memory state and retry its write without reapplying effects. SQL protects request
identity and closed outcomes. Reports bound action disclosure to 500 with omissions
labelled; earlier records remain stored.

Outcomes retain actual application/completion times, values, installed SKU/online
state, replica transition and accepted/applied topology revisions. Fault end is
not system recovery. Legacy chaos requests remain request-only. Exact teardown
captures state once, then atomically commits terminal evidence, action completion,
unfinished-action cancellation and runtime retirement before removing memory.
Failed writes freeze/retry the same capture. Offline teardown stays requested;
restart fails interrupted work explicitly. No replay or checkpoint recovery exists.

Terminal evidence includes simulated seconds, costs, load, health, measurements,
topology revision, installed SKUs, pools, faults/restarts and measurement time/revision.
Exact state may contain initialized or older measurements; freshness is labelled.
Diagnostic checkpoints retain actual capture time when available; `updatedAt` never
stands in for measurement time. Timestamp-less legacy checkpoints remain unknown.

## Honest Rerun + Compare

One backend classifier separates starting inputs, durable action conduct and
exact-terminal/checkpoint/missing evidence; React renders its source-backed facts.
Grades are **same starting point**, **one design change**, **one workload change**,
**same setup/different seed**, **several changes**, or **side-by-side only**. Missing
or different input/model/catalog provenance and ambiguous topology allow descriptive
comparison only. Conduct compares actual simulated application/completion and
outcomes; malformed, truncated or uncertain effects cannot establish equality.
Speed is displayed separately: it does not change tick math by itself but can change
when later human actions land in simulated time.

Final deltas require two exact terminal captures. Accumulated-cost delta additionally
requires equal simulated duration; gate monthly estimates require compatible catalog
provenance. Hourly burn, accumulated cost and monthly estimate stay distinct. Units
and later-minus-earlier signs imply no winner. Same-start/no-affecting-action/equal-stop
model-1 pairs compare normalized deterministic state and surface mismatches explicitly.

Model 1 reseeds each simulated second and consumes jitter in resource iteration
order. Shared starting resources at equal captured positions have aligned draws;
appending preserves them, while insertion/removal/reordering shifts displaced
resources. Alignment does not imply identical measurements or controlled causality.
Dynamic resources/future models are ungraded; non-preserved numeric object-key order
is unknown. An engine regression isolates jitter from traffic distribution.
Connection order is also retained as a starting-design and topology-action difference.
Model 1 builds ordered adjacency and uses the first pool VM as its autoscaling
template; reversing connections can change spawned identity/SKU even with aligned
starting jitter. A direct engine regression proves this without changing the model.

Exact rerun copies supported V2 input in the current model/catalog, even after design
deletion. Current-design rerun requires the original owned design and captures its
current topology with source workload/seed and current provenance. Neither replays
original actions. Server preview/hash verification refuses a changed design before
creation. Migration 12 adds immutable source/mode/stop target and a bounded one-hop
family, verifies inactive same-owner sources and permits owned designless creation
only for verified identical-input exact reruns. Legacy records stay untouched; source
deletion clears its FK without deleting child evidence. No family graph table exists.

Matched stop defaults on for exact source duration 1–604,800 seconds. The worker
checks every simulated tick, records action completions first and never overshoots
inside 1×/10×/60× batches. At the target it captures once, creates an audited
`trigger: matched-stop` teardown and uses the existing terminal transaction. An earlier
user stop remains valid; later requests cannot relabel a frozen capture or occupy
the unique open-teardown slot. Failed action/terminal writes retain the original
capture while frozen. Retry also emits terminal notifications; HTTP terminal polling
supports the UI when Redis delivery is unavailable.

History selects exactly two eligible runs; report picker prioritizes related runs,
then the surviving design, then other owned history. Reports show source/direct
reruns and offer Run again/Open design to improve. Live context shows source, mode
and stop countdown; finished runs retain comparison/report links until deliberate
return to Designer. Improve previews the actual unsaved canvas, explicitly saves
that canvas first and then verifies its hash before capturing the rerun. Source
workload/seed are fixed. Changed context/preview or account is refused. Keyboard
selection, native disclosures, real table headers/captions, focus return, readable
portal text, reduced motion and narrow metric blocks preserve the existing design.

## Verification, failures and cleanup

| Check | Actual result |
| --- | --- |
| Frozen install | 491 installs/545 packages checked; lockfile unchanged |
| Typecheck | Seven workspace tasks and release compiler passed; correction recheck passed |
| Lint/boundaries | Five ESLint tasks; 1,389 imports, no cycles/runtime leaks |
| Workspace unit tests | 162 passed, 1,151 assertions in final serialized run; seven DB cases skipped here and executed below |
| Engine | All 30 goldens plus jitter/connection-order regressions passed; source/goldens unchanged |
| Tooling | 23 passed, 279 assertions |
| PostgreSQL 18/Redis integration | 13 passed, 1,123 assertions across seven files; no cleanup errors |
| Docker | Commit-labelled image, five entrypoints compiled and explicit fixture Compose config passed |
| Frontend build | Passed; existing bundle-size warning remains |
| Dependency audit | Exit zero, `{}` |

Real database sessions prove two-user/ownerless HTTP/WS denial, expiry/revocation/
sign-out, no unauthorized control event or mutation, and legacy quarantine/recovery.
Full existing lifecycle also covers gates, duplicate jobs, live controls, pause,
topology, optional Redis delivery, exact teardown, restart and ownership loss.
Rerun proof records five exact stops at 620, identical-input normalized state,
current-design changes, detached exact rerun, manual early stop, frozen insertion/
terminal failures, original capture retention and retry notifications. Unsaved
canvas preview writes nothing; creation before save is refused, and saving that
exact canvas permits the matching rerun. Migration proofs preserve legacy fields,
ownerless records, identity/lineage immutability and normal designless refusal.

Browser QA used actual components/CSS and retained disposable integration evidence:
keyboard selection/max-two, rerun controls, default matched stop, focus return,
native disclosure, desktop headers and 375 px blocks/dialog without page overflow.
The rerun UI was explicitly a fixture with no creation/OAuth API. Authenticated SPA
and external OAuth flows were not browser-verified; API/WS creation/session evidence
comes from the real database-backed integration suite.

Failed attempts remain separately recorded. Windows Bun 1.3.14 repeatedly crashed
in native startup/generation/tests; some attempts explicitly reported memory
exhaustion. Final serialized checks passed, but Windows integration stability is
not established. Speculative launch/JIT changes were removed. Linux Docker runs
passed. Final QA found and fixed late teardown contention during a frozen matched
stop, low-contrast portalled text and sorting away meaningful connection order.
The security test now asserts no delivery
from confirmed invalidation onward, excluding legitimate telemetry during the
in-flight invalidation request. No authorization or golden requirement was weakened.

Sanitized final/failed evidence and browser screenshot stay outside Git under OS
temporary `infraforge-compare-20261013` and labelled integration run records; final
integration run is `10151e0558b84d2484109e757a0dd4b6`. Owned test containers, volumes,
networks, sessions and child processes were removed. The temporary unit source bundle
and QA folder were removed (1,018,993 bytes of QA scratch), along with four unused
owned test image tags. Shared caches, persistent developer storage/configuration and owner files
remain intentionally. No agent-memory folder or permanent scratch archive was added.

## Parked hosted work and remaining limits

B0.6E stopped before database access with identity/reset-credential gates unfinished.
A retained hosted rehearsal child/private operator record needs future authorized
inspection/cleanup. Historical hosted facts: legacy SHA `6b465c6`, Neon PostgreSQL
18.6, migrations 1–8, 28 `test-user` designs, 331 deployments (223 completed, 8 failed,
4 live, 96 torn-down), 348 completed outbox rows; three simulations advanced and the
fourth was unknown. Public API/WS had maintenance containment while legacy writers
remained. This is historical evidence, not a fresh census. Future cutover requires
renewed writer fencing, database/restore truth, session-preserving worker connections
and verified OAuth/TLS configuration.

A single pair establishes no statistical significance, production reliability, real
cloud behavior or general superiority across seeds. Continuous telemetry, all
automatic scaling events, replay/checkpoint recovery and multi-seed experiments
remain absent. Model-2 resource-keyed RNG is deferred to an explicit simulation
milestone. Windows runtime stability, authenticated browser/OAuth QA, broader
beginner UX and bundle size remain open. Local/CI proof is not production readiness.

Next product milestone: **Challenge + Predict**, completing the learning loop while
hosted production work stays parked.
