# M2K: internal product execution

Model 1 ACTIVE; Model 2 INTERNAL; production PARKED. This path does not redirect
Free Mode or published challenges. It adds no ordinary canvas/monitoring controls
and does not undertake the separate Claude Opus 5.5 visual redesign.

## Research and architecture

The existing product captures Model-1 RunInputsV2, sends a transactional Outbox to
BullMQ, uses one PostgreSQL session advisory lock for worker ownership, and retires
interrupted runs on startup. Existing reports and snapshots describe Model 1.
Reusing those payloads for Model 2 would inherit unsupported meanings. M2K instead
uses a separate versioned internal run record and consumer in that same worker.

Decisions follow these primary sources:

- [PostgreSQL 18 locking](https://www.postgresql.org/docs/18/explicit-locking.html):
  row locks serialize transitions; a session advisory lock belongs to its session.
  Internal evidence writes transact on the lock-holding session, so losing it
  prevents its uncommitted capture from surviving a replacement owner.
- [PostgreSQL isolation](https://www.postgresql.org/docs/18/transaction-iso.html):
  an aborted transaction cannot supply committed results. M2K keeps the previous
  durable capture and stops; it does not replay advanced work as continuation.
- [PostgreSQL JSON](https://www.postgresql.org/docs/18/datatype-json.html): JSONB
  does not preserve object key order. The authored contract is canonicalized
  before compilation and on JSONB read; otherwise provenance traversal could change
  on reconstruction.
- [Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html):
  admission and queue intent commit atomically. Delivery still needs idempotence.
- [BullMQ idempotence](https://docs.bullmq.io/patterns/idempotent-jobs) and
  [stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs): queue delivery
  can repeat. Job IDs help transport deduplication; the durable run state decides
  whether any execution is permitted.
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html):
  deny by default and check authorization for each request. A hash is not a grant.

No additional queue/database framework or dependency was introduced. A new explicit
`@infraforge/simulation/internal-product` bridge exposes the existing pure compiler,
runtime, metering and presentation contracts; the Model-1 engine export is unchanged.

## Supported input and admission

The initial slice supports exactly one standalone authored VM CPU station and one
`atomic-current-object/1` store, with explicit application demand, workload,
capacity, listeners, connection/pool/link/security contracts and command schedule.
It supports at most one object-process Crash using explicit logical retention,
duration and restart delay. Read/overwrite/delete and service/transfer outcomes are
actual runtime operations. Logical retention is not physical durability.

Other compositions, auxiliary/pool expansion, SKU/region/size, autoscaling, legacy
public/encryption/openPorts, provider capability bindings and other fault types
are refused. Missing contracts, capacity, demand, provenance or transports are not
filled with Model-1 defaults. Compiler diagnostics explain unsupported inputs.

The workload is an explicitly supplied recorded WorkloadProfile, complete
application contract and deterministic compiled arrival trace, plus explicit
object commands. Both authored inputs and exact expanded rows are retained. This
is not an imported physical user/session trace or an inferred real traffic model.
The authored verification example separates VM application CPU work from explicitly
scheduled object commands; it does not claim those commands are application calls.

An actual saved Infrastructure row must belong to the authenticated caller and be
outside published challenge workspaces. Its expected updated timestamp must match.
Prisma's UTC timestamp is read explicitly as UTC across host time zones. Within one
transaction the API locks admission quota accounting, reads the saved design,
compiles, records the immutable envelope and inserts an Outbox entry. A conflicting
idempotency key returns 409; an identical retry returns the original run, even if
the saved design later changes. Compilation refusal retains no run or queue intent.

The envelope pins owner/run/design identity, the captured design/workload/application/
resource contracts, compiler output and expanded arrival rows, source closure,
metering selection and epoch, and a canonical SHA-256 content identity. Inputs are
immutable in PostgreSQL. User-editable hashes never authorize reading or execution.
The execution identity also pins the Bun version, lockfile and admission schemas.
Compatibility is deliberately conservative: a dependency/runtime change can refuse
replay while stored historical evidence remains readable.

## Internal API and report

Migration 18 adds an **empty** InternalModel2Grant table. A session user requires an
explicit operator-created grant for every internal route. There is no public grant
or enable endpoint. Cross-owner access returns 404 even when both users have grants.
The existing Origin/session/rate-limit middleware remains in force.

| Route under `/api/internal/model2` | Meaning |
|---|---|
| `POST /runs` | Explicit supported admission, 202 new / 200 identical retry / 409 conflict / 422 compiler refusal |
| `GET /runs` | Last 20 of the granted caller's own internal runs |
| `GET /runs/:id/input` | Retained immutable envelope and identity |
| `GET /runs/:id/report` | Bounded historical JSON report |
| `GET /runs/:id/report?format=html` | Essential read-only HTML report, escaped output, restrictive CSP, no scripts |
| `GET /runs/:id/replay` | Read-only deterministic reconstruction of the retained prefix, or explicit unavailability |
| `POST /runs/:id/cancel` | Cooperative cancellation; queued runs can stop before any execution |

Reports retain Observed modeled facts, stored Interpreted utilization rules, and
Unknown physical timing/throughput/full pricing. They include service outcomes,
current object identities/generations, actual endpoint/fault observations, compact
checkpoint history and usage evidence. Incomplete usage measurements are suppressed
as Unknown, rather than displaying incomplete quantities as known totals. A corrupt
input/capture or metadata gap does not become a zero. The report remains useful
after a worker stops and after source compatibility changes; it never applies the
current engine to an incompatible historical input while presenting it as history.

## Worker, transactions and interruption

The existing worker routes only the new `model2-internal-created` Outbox event to
the bounded `internal-model2` queue. Its Model-1 branch is unchanged. PostgreSQL's
global worker lock remains authoritative. The internal consumer claims a queued
row once, pins a token and executes the retained contract, checking ownership at
capture boundaries. The same lock-holding PostgreSQL session commits captures and
terminal state. Conditional row/token transitions and an exact-source database
trigger reject stale or rewritten state.

The consumer stores a cumulative bounded event frame plus at most 32 compact
checkpoint summaries. Only the latest complete database transaction replaces the
prior capture. Checkpoints include fault start/end/restart as well as software
observation cuts, so the historical report can show an actual outage and recovery.
They are bookkeeping, not cloud timing samples or an execution speed control.

Queued admission survives worker absence. A terminal duplicate is acknowledged
without executing again. A running record encountered after restart/delivery loss
becomes interrupted with its last durable prefix; **execution is not resumed**.
Failure to commit a capture stops advanced in-memory work and preserves the prior
capture. If the database remains unavailable, a replacement retires the running
record after ownership can safely be re-established. Cancellation and grant
revocation stop at a capture boundary, retaining the actual prefix; cancellation
does not promise an instantaneous physical interrupt.
An active record's status is its last committed lifecycle state, not a worker
liveness signal. Without a replacement worker, a crashed running record can remain
marked running while its report still identifies the retained incomplete prefix.

Read-only replay requires the exact retained schema, content identity and execution
source. It reconstructs the captured cuts and compares the whole evidence identity.
Matching a prefix does not prove complete execution. Schema/source mismatch or
missing/corrupt input returns an explicit incompatibility/unavailability result.

## Bounds and source compatibility

Limits are nonphysical policies: 10,000 model events, 256 requests/raw/trace rows,
64 model samples, 16 commands, one fault, horizon ≤1,000,000 simulated us, and at
most 32 durable checkpoint summaries. Metering is capped at 2,048 records / 50,000
fields / 250,000 text characters. Retention exhaustion remains Unknown.

API bodies are capped at 256 KiB. Serialized input/capture caps are 512/256 KiB;
PostgreSQL JSONB-text caps are 768/384 KiB to allow its representation overhead.
Admission serializes four-active / 100-retained-per-owner and 1,000-global quotas.
There is no automatic deletion of historical runs or an unbounded evidence stream.
These are JSON/event limits, not a claim about total database/replica disk cost.
Model 2 shares the existing worker process. Logical work budgets are not a
wall-clock deadline or process/CPU isolation guarantee; that operational boundary
still needs assessment before broader activation.

The real product workload exposed a valid zero-based first-attempt identity, which
M2J's collector had rejected. M2K accepts the actual nonnegative safe integer and
keeps distinct receipts/events; it does not renumber runtime work. Accepted M2J
proof/performance/lineage JSON remains unchanged. The new bounded source lineage
reconstructs the accepted M2J fingerprint from six original source files and
strict current pins; runtime semantic evidence must still replay exactly. Existing
M2H/M2I provenance protections remain. New internal policy inventory entries cite
their actual workspace source instead of claiming to exist at the old Model-1 audit
commit. No Model-1 calibrated coefficient or golden expectation was changed.
The runtime image now explicitly includes the internal engine, metering and adapter
TypeScript closure; audit data, tests, private files and secrets remain excluded.

## Proof and remaining product requirement

Focused adapter/report tests exercise actual storage, failure/recovery, independent
byte-time, immutable prefix replay, corrupt inputs, unsupported profiles/controls,
evidence gaps, Unknown suppression and HTML escaping. Integration uses the real API,
Better Auth sessions, PostgreSQL/Redis, queue and worker. Test-only PostgreSQL
barriers kill the actual process/ownership connection, fail a real capture
transaction and exercise cancellation/revocation; no application test switches are
installed. A compact product proof artifact is retained by CI for independent review.
Download `internal-model2-product-proof` from the exact commit's integration job,
then run `bun --no-env-file scripts/verify-internal-model2-proof.ts <proof.json>`
against that source. This independently reconstructs the complete capture/report,
checks recorded interruption and authorization outcomes, and verifies 264,472 byte-us
from the explicit object mutation boundaries. CI logs establish the actual database,
API and worker lifecycle; a standalone JSON file cannot establish that by itself.

Local Docker startup failed in the existing Secrets Engine socket. Docker data and
settings were not reset. Disposable CI services provide the database/worker proof;
final exact-SHA test, artifact, packaging and Vercel results belong in the completion
report. This document alone does not establish a passing product execution.

The next step should first complete a narrow product requirement: author/review a
supported application/infrastructure contract and recorded workload through a usable
internal workflow, with report/compatibility and per-surface proof, before expanding
normal Free Mode dispatch. A raw contract API and restricted report do not make all
visible controls eligible. Preserve 441 surfaces / 177 technical blockers / 252 UI
reviews, all 30 Model-1 goldens and ten immutable challenge hashes. Production and
general Model-2 activation remain parked.
