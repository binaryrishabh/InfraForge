# InfraForge project state

Verified 2026-10-09 on `develop`. B0.3 adds real authentication and user ownership
while preserving B0.2 simulation behavior. OAuth provisioning and release rehearsal
remain required before public use or promotion to `main`.
See [authentication setup](AUTHENTICATION.md), [historical baseline evidence](BASELINE_VERIFICATION.md)
and [disposable integration instructions](../Backend/tests/integration/README.md).

## Accepted architecture

- Bun 1.3.14/Turbo 2.11.6 own the root workspace and lockfile. Domain/catalog packages
  own shared rules and SKU data; the bounded `shared` extraction remains constrained
  by exact import allowances, cycle checks and browser runtime boundaries.
- React 19/Vite/Zustand implement the canvas and monitoring. Server sessions establish
  identity. Account changes cancel requests, clear canvas/telemetry/dialog state and
  remount protected pages. Draft keys use the server user ID; old browser password,
  session and ownerless draft keys are removed. Local drafts remain readable by anyone
  with access to the browser profile. Explicit saves/pre-run saves update designs;
  live edits only affect the current simulation.
- Express 5/Better Auth 1.7.7 use Prisma 7.9.1/PostgreSQL database sessions. Configured
  Google/GitHub OAuth is the sign-in direction; passwords, implicit account linking,
  optional plugins, cookie session caching and sliding session refresh are disabled.
  HTTP requires a current session and filters all design/run access by verified owner.
  Unsafe requests require an exact permitted Origin. Cookies are host-only, HttpOnly,
  SameSite=Lax and Secure on HTTPS. Production origins require HTTPS; frontend/API/WS
  must share a site; API and WS also share a hostname for the host-only cookie.
  Provider settings and public origins are configurable.
  Compose keeps Redis private to its service network; no Redis host port is published.
- WebSocket verification checks Origin/session before upgrade and run ownership before
  Redis subscription and each delivery. Database checks also close expired/revoked
  sessions every second. Bun's supported `ws` verification callback sends proper HTTP
  rejection responses; direct writes to its synthetic upgrade socket did not.
- The additive auth migration preserves historical data and adds nullable `ownerId`.
  Ownerless designs/runs are quarantined, invisible to new users and refused by workers.
  Recovery is per-design, requires independent ownership evidence, verified target
  account, matching historical marker and no active runs, and defaults to dry run.
  An owned design cannot be reassigned. No automatic ownership backfill exists.
- PostgreSQL persists deployments/outbox; Redis/BullMQ dispatches jobs. Validate,
  SecurityScan and CostEstimate read immutable versioned inputs captured transactionally
  at deployment creation: validated topology, resolved workload and seed. Retries and
  stale queue payloads cannot replace them. Database triggers preserve captured inputs.
- Saved design, original input and revisioned live topology are distinct. Atomic revision
  checks reject stale live edits; reattachment reads live state without writing it back.
  One worker owns the database through a session advisory lock; initialization and cycles
  do not overlap. Active design deletion waits for runtime stop acknowledgement.
- Worker restart explicitly fails interrupted runs while preserving original inputs,
  history and diagnostic checkpoints. Full checkpoint recovery/replay is absent. Costs
  and outcomes come from the shared deterministic engine/catalog and simulated time;
  timestamps and orchestration timing are not byte-identical replay or cloud guarantees.

## Verification

| Check | Result |
| --- | --- |
| Frozen root install | Pass; 487 installs/543 packages, no changes |
| Typecheck | Five tasks passed, including Prisma generation |
| Unit tests | 94 passes, zero failures, three intentionally gated integration skips |
| Engine goldens | All 30 passed; source and expectations unchanged |
| Lint/boundaries | Three lint tasks passed; 878 imports, no cycles/browser runtime leaks |
| Tooling tests | Eight passes, 26 assertions |
| Build | Three tasks passed; 2,099 modules; JS 590.18 kB / 180.55 kB gzip |
| Dependency audit | Exit zero, `{}` |
| Disposable integration | Nine passes, 345 assertions; lifecycle 104.40s / suite 108.24s |
| Docker packaging | Final image built; all four backend entrypoints bundle, 1,333 modules |
| Compose security | Rendered config verified; Redis has no published port; API/worker/WS share the internal service network |
| Browser/session QA | Two real database users; isolation, live reattachment/control, sign-out and expiry passed; no console errors |
| Remote CI | Develop validation has eight jobs; the result for the published SHA is recorded with delivery |

Real adapter-created database sessions exercised both users, forbidden HTTP operations
and all seven controls, WebSocket ownership/upgrades, Origin/CSRF checks, tampering,
expiry, revocation, actual sign-out, legacy records/recovery and ownerless worker jobs.
Unauthorized commands caused no domain/outbox mutation or simulator control event.
The full existing input/gate/retry/live-control/checkpoint/restart/deletion/worker-loss
lifecycle passed. Separate migration tests preserve B0.2 legacy-input coverage and
verify that authentication preserves all old fields without inventing ownership.

Initial checks exposed test typing/icon errors and Bun's unsupported WebSocket rejection
interfaces. Three lifecycle attempts timed out; a bounded fourth captured the missing
HTTP response. The supported verification callback passed the complete lifecycle.
Additional recovery regressions exposed a native Bun rejection-matcher stall: the
database had completed BEGIN, but the matcher waited until the transaction-start
timeout. Normal promise awaiting followed by exact error assertions passed the
isolated security sequence and final suite. Timeout increases did not solve it;
the final checks retain normal transaction limits and verify unchanged ownership.
Docker packaging omitted the deployment modules and new auth paths; the Dockerfile and
restricted context allowlist now include them. A private browser fixture stalled when
launching Vite directly under Bun; its exact child was stopped and cleanup confirmed.
Browser QA used real signed database-session fixtures, never a public login bypass:
Alice reattached and controlled her run; Bob saw only his design and an empty canvas.
Sign-out and database session expiry returned to sign-in. Backend telemetry was
observed at simulated second 170 (DNS 278 RPS, database 333 RPS). External OAuth was
not tested without provider credentials. Owned test services, volumes, networks,
processes and the packaging-check image were removed; shared caches and unknown
resources were preserved. Unique sanitized evidence is retained locally; verified
duplicate scratch and temporary evidence copies are removed, never published.

## Remaining risks and next milestone

1. Provision a stable auth secret, exact HTTPS origins and registered Google/GitHub
   credentials/callbacks. Neither external OAuth flow was end-to-end verified without
   credentials. Disabling account linking may require using the original provider.
2. Rehearse additive migration, worker shutdown/startup, quarantine recovery, proxy/TLS,
   same-site cookies, health and rollback before release. Old unauthenticated services
   must not remain exposed. The current deploy workflow does not apply migrations;
   promotion requires an approved migration/startup sequence. No production data,
   secrets or deployment were accessed.
3. Measure hosted database traffic, WS/resource budgets and proxy-aware rate limits;
   limits are process-local. Session revocation is checked before delivery and at most
   one second between idle checks. This is bounded local evidence, not a load/HA audit.
4. Single-worker interruption ends runs; non-topology controls lack durable acknowledgement
   or replay. Session-preserving PostgreSQL connections are required; transaction poolers
   and complete checkpoint recovery remain unsupported.
5. Existing native Windows Bun instability, bundle warning, semantic SKU validation,
   corrupt draft handling and legacy layout compatibility still need focused work.
   Reports/settings remain stubs; beginner UX, narrow screens and modal focus are deferred.

Next milestone: owner-configured OAuth end-to-end tests and independent security/release
review, then migration/proxy/rollback rehearsal before considering `develop` to `main`.
This checkpoint authorizes neither promotion nor production deployment.
