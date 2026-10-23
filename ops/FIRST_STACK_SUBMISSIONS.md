# First-stack submissions (inactive)

Model 1 remains active. The shipped API and ordinary worker do not mount or start these
factories. A separate, default-closed trusted host lifecycle is supplied in
`firstStack/verifierHost.ts`; see [FIRST_STACK_VERIFIER.md](FIRST_STACK_VERIFIER.md).
Internal grants never authorize public submissions. A future explicit
activation must mount `createSubmissionRouter` behind session and origin checks
before the ordinary JSON parser, and start `startSubmissionQueue` with trusted
operator configuration, a direct session-preserving database URL, and producer
and consumer Redis connections. No browser field supplies Docker configuration,
host qualification, source resolution or activation. Existing Docker context and
Dockerfile already package top-level `firstStack/*.ts` and release modules.

`SubmissionAdmission.engine` is an exact approved source digest and immutable
image ID. It must match the browser engine and the qualified isolated executor.
Unavailable historical engines refuse verification; no `latest` lookup or prefix
matching is permitted. Host qualification remains the separate 10b gate described
in [FIRST_STACK_ISOLATION.md](FIRST_STACK_ISOLATION.md). This slice does not add
hidden workloads, scores, public sharing permissions, challenge grading or a
browser executor. Fixed challenge designs refuse until a server-owned immutable
challenge adapter exists. A `verified` result means evidence agreement only.
Future scoring must resolve hidden workloads on the server, never from a browser
submission; the workload reference is versioned JSON separate from the input.

The submission API takes a saved design ID, timestamp and layout revision,
idempotency key, private/shared/scored purpose, exact engine, reviewed resolved
workload, policy including seed, and a bounded finished browser cut. Owner comes
only from the authenticated session. The server recompiles without instantiating
the runtime and checks the browser input hash and compile lock. The complete
canonical executed input, original workload, seed, lineage, compile lock and
envelope are retained. Private results stay `unverified`. Scored/shared inputs
receive a PostgreSQL reservation and outbox in that same transaction, then a
BullMQ job containing only the run ID. These purposes request verification;
neither purpose grants public read access. `purpose: "shared"` is a verification
request, never a public link. Public share links are outside launch scope.
Scored requests require the exact server-owned challenge version and may produce
an allowlisted score after verification; verification and passing remain separate.

Admission requires both explicit `SubmissionAdmission.enabled` and a fresh
`available` provider; missing providers fail closed. The future API host uses
`createVerifierAdmission` with its trusted exact engine and bounded Redis client.
`availability()` returns only available/engine/expiry/capacity/executor budgets;
it never forwards qualification, daemon, paths, credentials or hidden data.
No HTTP route is mounted here. Browser transport uses the configured API origin
with the existing credentials and Origin policy. Historical owner reads and
cancellation remain independent of admission and verification availability.

Admission uses one transaction advisory lock for owner/global reservations and
rate limits. Defaults: ten successful submissions per rolling database hour per
owner, one outstanding verification per owner, sixteen outstanding globally,
256 MiB outstanding input bytes and 2 GiB live reservations. Each submission
reserves input bytes plus 32 MiB server evidence and 4 MiB for browser evidence
and identity metadata. Terminal history, including private submissions, charges
actual stored bytes instead of its unused execution reservation. A separate
2 GiB finite-pilot storage ceiling includes full retained JSON, physical table/
index/TOAST allocation and outstanding reservations. See
`FIRST_STACK_RECOVERY_STORAGE.md` for exact accounting and operator actions. These
are conservative software limits, not qualified host capacity measurements.
Lost-response retries return the original ID without charging another rate or
storage reservation, even after design edits or reaching the rate limit. A
changed request under the same key conflicts. A changed approved engine refuses.
No retention TTL or silent history deletion is installed; full storage refuses.

BullMQ has global and local concurrency one, one attempt and no stalled retry.
Execute/replay also share 10b's PostgreSQL session lock and fixed Docker name.
Every persisted cut checks the captured owner, immutable input, token,
authorization and cancellation inside the same transaction as the insert.
The unique work token and daemon identity commit before Docker create. The
executor uses that same token in its container label, so recovery can join an
orphan to its exact stored run even if the parent dies before the first cut.
Cancellation/revocation are monotone. Durable cuts and terminal results are
append-only, with SQL byte/schema/horizon guards and release postchecks. Finished
input rows are immutable from admission. Terminal work rows cannot change.
The content hash on each terminal result addresses its canonical content; an
owner-only mutable status projection uses `private, no-store`. Permanent cache
headers require a separate immutable artifact endpoint and sharing policy.

Start this lifecycle only after the previous worker has stopped. Startup moves
uncertain running rows to `recovery`, never to queued. Duplicate deliveries do
not execute a claimed run again. An interrupted executor can finish as
`interrupted` only after cleanup is acknowledged. Lost DB commits, process death
or unconfirmed Docker cleanup retain reservations in `recovery`. Read the stored
cut prefix after any uncertain commit; never retry the write or execution.
Offline operator recovery must disable admission, stop the owner, inspect the
exact daemon/image/container token and persisted prefix, and clear only the
verified stopped container under the 10b runbook. The offline
`closeSubmissionRecovery` helper then records the matching token/daemon/image,
reviewer and cleanup proof, appends an interrupted result, and releases the
reservation. It has no public route and cannot mark a recovered run verified.
No automatic lease expiry or rerun endpoint is provided. Deploy preflight blocks all
nonterminal reservations, including recovery, and both executor ownership locks.

UI needs for later slices: browser engine availability and exact seed/workload
review; explicit retained-input consent; untrusted/private and pending/verified/
mismatch/interrupted status; actionable stale-design, busy and rate refusals;
cancellation progress; visible last durable cut and operator-recovery state;
insufficient-evidence treatment; separate share authorization and score display.
No UI design is included here.
