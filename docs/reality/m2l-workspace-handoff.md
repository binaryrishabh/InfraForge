# M2L internal workspace and redesign handoff

Implementation checkpoint; final exact-SHA browser/CI evidence is required before
claiming completion. Issue #3 remains open for independent Lead review.

## User journey and source boundaries

`/internal/model2` is a protected React route inside the existing AppShell. Navigation
appears after the authenticated server confirms the operator grant. Hidden navigation
is not authorization: every internal API route still checks the session, explicit
InternalModel2Grant and owner. No grant creation control exists. Normal designs,
Free Mode and challenges continue to use Model 1; production remains parked.

The journey is saved design → supported-shape explanation → guided authored fields
→ authoritative server compilation → exact value/contract review and consent →
M2K admission → durable report/history → cancellation or read-only replay.
The saved design is never silently rewritten. Legacy controls, challenge workspaces
and unsupported shapes show concrete refusal reasons.

`packages/contracts/src/internal-model2/` owns browser-safe field metadata, units,
DTOs and the optional explicit educational example. It imports no simulation engine.
`apps/backend/internalModel2/authoring.ts` validates guided input and builds a complete
versioned ProductContract with traceable authored provenance. `workspace.ts` checks
saved ownership/revision and calls the unchanged M2K compileEnvelope. It exposes
grant-protected GET `/workspace` (latest 100 owned designs) and POST `/validate`.
Validation writes no run or Outbox. Its returned exact request goes through the
existing POST `/runs`; admission checks all rules/revision again. Client prechecks
are structural guidance and never labelled authoritative compiler validation.

The existing M2K immutable envelope, worker ownership, atomic evidence, bounded
retention, prefix interruption/replay and report contracts are unchanged. No schema
migration, runtime dependency, compiler relaxation, provider profile or physical
performance assumption was added. A pinned Playwright installation is confined
to disposable CI test tooling; the application lockfile remains unchanged.

## Supported authoring and explicit meanings

Exactly one standalone VM and one atomic-current-object store, with one directed
VM-to-object saved connection. All saved SKU/region/size/public/encryption/openPorts/
autoscaling fields are refused even when false or empty. Other compositions, TLS,
firewalls, autoscaling, provider binding and broader fault kinds remain outside this
guided subset. A different saved design must be reviewed explicitly; no field is
removed automatically to make a design pass.

Numeric fields start blank. The user supplies steady requests/minute, read fraction,
payload bytes, timeline, read/write CPU demand, blocking waits, cores/workers/queues/
parallelism, object capacity/concurrency/service demand, per-direction transport
bandwidth/propagation/buffer, protocol envelope sizes, connection pool limits and
timeouts, caller deadline and evidence budgets. All field labels include units.
Authored addresses/zones, reviewed plain TCP and listener port are explicit.

The supported profile fixes named algorithmic choices, presented before consent:
capped equal-fluid CPU scheduler, serial reusable pools, per-path FIFO message
links, cooperative request cancellation and no automatic retries; partial resident
memory observation with complete memory Unknown; initially empty current-object
storage; separate VM application arrivals and scheduled VM-to-object commands.
Object commands use the authored CPU execution profile; put/delete are write
operations, get/head read operations. No request is a physical user/session trace.

Up to 16 explicit put/get/head/delete commands can be edited as rows. Put size and
content, namespace/key and simulated time are visible. Read/head/delete have no
object body. An optional single object-process crash specifies start/duration/
restart delay and logical retention. This does not establish real reliability,
durability or cloud recovery time. Physical throughput/timing and full pricing remain
Unknown. All numerical origins are explicitly educational authored assertions,
never provider measurements. The optional example is loaded only by a labelled
user action and reviewed before admission; production code imports no test fixture.

Review displays the exact saved revision, compiler-recorded arrival count, every
quantity/value/unit/origin, command/fault schedule, endpoint assumptions, Unknowns,
software limits, exact request identity and an inspectable full generated contract.
Consent enables execution; validation alone never executes.

## Reliability and accessibility contract

Edits, review and uncertain submission identity are saved per account in tab-scoped
sessionStorage. Submission requires successful storage first. Double clicks are
guarded synchronously. A network timeout or lost response preserves the exact
request/key for retry, including refresh. No background auto-submit occurs. Definitive
400/409/422 responses require correction/revalidation. Identical admission returns
the original M2K run, even if the first response was lost. Clearing browser data or
closing the tab removes this recovery draft; retained runs remain in owner history.

Unmount aborts requests; user/session change aborts existing user requests and remounts
workspace state by owner. API 401 follows existing sign-in handling. Grant/record
404 gives a safe unavailable view and hides retained evidence. Form errors identify
exact server paths and correction text, link fields through aria-describedby and
aria-invalid, and focus an error summary. Review receives focus; fields/buttons
use the existing Field/Input/Select/Button/Notice/Page primitives. Keyboard access,
visible labels, responsive grids and scroll-contained tables must survive redesign.

Reports show queued/running/completed/failed/interrupted/cancelled, last committed
sequence/time, reason, Observed modeled facts, stored Interpreted meanings, Unknown,
actual service/command/object/fault state, usage and checkpoint history. A running
record is not a worker liveness assertion. Missing evidence is not zero. Partial
reports and incompatible history must stay readable; replay is disabled when
incompatible and the server remains authoritative. Replay comparison never mutates
the run. Cancellation is cooperative, not instantaneous; it retains a real prefix.

Only the selected run polls: at most 60 sequential reads with two-second spacing,
request timeouts, stopping on terminal status, error, authorization loss or unmount.
Manual refresh can start another bounded observation window. History and navigation
perform no background polling. Account names or hashes never confer authorization.

## Research basis

- [W3C error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
  and [error suggestions](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html):
  describe errors in text, identify the affected field and explain correction.
- [OWASP object authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)
  and [function authorization](https://api-security.owasp.org/editions/2023/en/0xa5-broken-function-level-authorization/):
  check grants and owners server-side on each route and ID, regardless of navigation.
- [React effect cleanup](https://react.dev/reference/react/useEffect): abort requests
  and clear timers on unmount/dependency change to prevent stale account/result updates.
- [Playwright](https://playwright.dev/docs/intro): actual Chromium interactions,
  separate browser sessions and screenshots complement server/runtime tests.

## Proof and shipping inventory

Unit tests exercise actual guided-contract compilation/execution, blank/refused
values, every legacy control, immutable layout handling, review consent and escaping,
field labels/units/errors and account-scoped draft failure/corruption handling.
The disposable integration browser journey uses the actual React app, Better Auth,
saved-design API, PostgreSQL/Redis, Outbox and worker. It covers permission/owner
failures, authoritative field errors, stale revision, lost response after commit,
refresh/duplicate retry, queued/running cancellation, complete execution/replay,
worker interruption, corrupt/incompatible history, mobile width and lost session.
Test-only PostgreSQL barriers and privileged historical-corruption fixtures are
confined to disposable services; no application failure switch is installed.

New/changed visible controls must be inventoried. The 441 accepted baseline entries
are preserved; new surfaces initially fail closed as unreviewed. A browser pass does
not qualify unrelated surfaces or general Model-2 activation. Final inventory
counts, per-surface reviews, proof artifacts and exact commits belong in the final
completion report. Both technical and UI gates remain closed.

## What Claude may replace

Claude may replace all workspace JSX/layout, styling, page organization, navigation,
field presentation, report rendering and visual assets after independent research.
Today's current-style layout is not a design system requirement. Preserve the
typed API boundaries, server compilation and saved revision checks, explicit
origins/units and review consent, exact retry identity, account isolation, bounded
polling/cleanup, accessible error correction, truthful evidence categories and
M2K interruption/replay semantics. Update browser tests and shipping fingerprints
with real replacement behavior proof. Do not use UI redesign to activate unsupported
physics, create grants, rejudge history or redirect Model-1 execution.
