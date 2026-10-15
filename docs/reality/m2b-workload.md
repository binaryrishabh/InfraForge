# Internal workload architecture: m2b/1

The explicit internal Model-2 registry dispatches to `createWorkloadModel2` under
`model2/workload/run.ts`, requiring workload revision `m2b/1`.
Model 1 is active. The M2A proof entry point remains available with its original
input/lifecycle semantics; historical proof inputs are not silently reinterpreted.
M2B shares integer virtual time and keyed Philox with M2A. No public package export,
API route, browser graph, database or production runtime activation was added.

## Inputs and arrivals

`WorkloadInput` explicitly selects model `2` and workload schema `m2b/1`. Operations,
arrival sources, station profile bindings, profiles and the input ledger are separate.
A station specifies cores, concurrency, queue capacity, context and cancellation
capability; it does not contain an arbitrary service-demand number.

| Source | Timing and identity | Feedback |
| --- | --- | --- |
| periodic | start + index × interval; source/index identity | Open: next arrival is scheduled immediately when offered, irrespective of service outcome. |
| poisson | keyed exponential gaps, including the first gap after start | Open; seed/source/index/purpose determine every draw. Gaps round up to integer us. |
| trace | relative integer-us time, authored row id, operation and optional payload bytes | Open; tied timestamps sort by authored id. Out-of-order input is rejected. |
| closed | finite users × per-user request budget, initial start, caller outcome + think time | Closed with respect to callers. A caller timeout releases its user, even if remote work continues. Think time can be zero. |

Open sources retain one future arrival event per source. Closed sources retain one
future arrival or live caller per user. Arrivals at the horizon are included; later
authored arrivals are not offered and are not counted as failures. Playback batching
and sample cadence cannot change physics. Samples project state without mutating
service accounting. Definition arrays and router backend lists are canonicalized.

Trace schema is `infraforge-arrivals/1`, with an explicit `us` unit, duration and
provenance. `ingestTrace` consumes at most row-limit + 1 elements of an iterable,
validates and snapshots a bounded set, rejects duplicate IDs, invalid operations,
payloads and timestamps, and canonicalizes ties. Validation runs before input copy.
The offline `scripts/reality/trace-input.ts` adapter reads NDJSON in bounded chunks:
one header followed by rows, with explicit row, line-byte and total-byte budgets.
Hard ceilings are 100,000 rows, 65,536 bytes/line and 16 MiB/file. Oversized input
fails visibly; there is no silent truncation or database ingestion. This is bounded
snapshot ingestion, not a claim of constant-memory execution of an unlimited trace.

## Identity and ownership

Identities are unambiguous JSON tuples, not delimiter-concatenated user strings.
Root identity derives from source and authored arrival identity; operation is a
separate field. An attempt has a number and call identity. A dependency invocation
has its own call id and parent call id while retaining the original root/attempt.
Current execution creates attempt zero and one serial synchronous child per stage.
Future repeated/fan-out calls need a stable call-site/ordinal in the child tuple;
they do not need a new root identity.

Operation idempotency is explicit (`read-only`, `idempotent`, `non-idempotent`,
`unknown`). Retry execution is deferred. A future caller-owned retry controller can
retain root identity, increment attempt, record reason/budget and key backoff jitter
by root/attempt/purpose. There is no universal retry policy, deduplication or
at-most-once guarantee in M2B. Work continuing after caller timeout is already real
state, so retries will not require deleting/replacing the old remote operation.

## Caller and service lifecycle

An offered caller is admitted or rejected at its entry. An admitted caller waits
while its entry work is queued, serving or waiting on a dependency. Exactly one
terminal caller outcome is recorded: completed, rejected, deadline-exceeded or
abandoned. In-flight callers at the observation horizon have an explicit state/age
and are right-censored. `admitted` is cumulative and overlaps later outcomes; it is
not another partition term. A downstream rejection can reject an admitted caller.

Caller timeout is relative to offer time. It becomes a caller-owned absolute virtual
deadline. Optional authored abandonment has separate ownership/cause. Priority is:
fault end, fault start, caller stop, service completion, arrival, sample. Deadline
wins an exact service-completion tie; deadline wins an exact abandonment tie.
Same-time causally generated events run after their cause. These are internal
resolution policies, not assertions about wire races in real systems.

Default `onCallerStop=detach` changes only the caller. The queued/active/dependent
service invocation continues and still consumes resources. With
`request-cancellation`, the caller asks its entry receipt to cancel. A station with
`unsupported` cancellation keeps executing. A `cooperative` station cancels its own
retained work and requests cancellation from its child receipt, which may refuse.
Confirmed cancellation at entry says nothing about completion/side effects of an
unsupported child. Cooperative acknowledgement is idealized as instantaneous.

Late entry outcomes are counted separately and cannot create a second caller
outcome. Cancelled service work has its own station category; caller deadlines are
not relabelled as successful remote cancellation. There is no service/dependency
timeout model yet, nor a network cancellation delivery/acknowledgement model.

## Service mechanism and units

Profiles bind operation × stage × application/software/environment. CPU demand is
**core-microseconds per operation**. The current blocking I/O field is **wall
microseconds per operation while holding a worker**, consumes no modeled CPU, and
is explicitly not an IOPS, storage latency or device-contention model. CPU then I/O
then one synchronous downstream call is the supported path. A dependency retains
the parent's worker until it returns, unless that parent is cooperatively cancelled.

Workers reserve equal core shares (`cores / concurrency`); unused reservations are
not redistributed. CPU phase duration is `ceil(demand / share)` integer us, while
CPU accounting never exceeds the supplied core-time demand. FIFO queue capacity
excludes active workers; zero queue permits direct service only if a slot is free.
Pause freezes local CPU/I/O progress and pumping. It does not pause downstream
services or create a multiplier. Existing dependent work can still return.

This reserved-share server is an explicit analytical mechanism, **not an OS CPU
scheduler**. No arbitrary software profile is supported by a core count alone.
Single-worker local calibration does not validate multi-worker scaling or the
reserved-share assumption. Different kinds of resources will keep independent
contracts rather than inheriting fictitious CPU/memory metrics.

## Accounting, evidence and bounds

At every observation:

```
offered = completed + rejected + deadlineExceeded + abandoned + callerInFlight
station.received = admitted + rejected
station.admitted = completed + failed + cancelled + queued + serving + waiting
terminal = rawRetained + rawOmitted
```

`failed` at a station means a dependent operation returned rejection, not a made-up
local CPU fault. `serving` excludes `waiting`, and both occupy a worker. Core-time
and busy service-slot wall time are cumulative; busy-slot time includes local CPU
and blocking I/O, excludes pause and dependency wait. Root response time is offer to
caller outcome, including modeled queues/service/dependency time. Transport is
absent by contract; memory, cost, locks and packet loss remain unmodeled/Unknown.

Raw caller outcomes and in-flight identities have explicit retention limits, with
omitted counts. All terminal outcomes contribute to bounded per-operation/outcome
histograms. Exact nearest-rank quantiles are available only when the entire group
was retained; otherwise the bucket interval is reported. Tail ranks require at
least 2/20/100/1000 observations for p50/p95/p99/p99.9. These are empirical reporting
floors, not confidence or representativeness guarantees. In-flight requests are
never silently inserted into successful-response percentiles. Means use floating
point sums; histogram intervals are intentionally coarse powers of two.

Evidence contains profile versions, ledger, policy ledger, configuration, arrival
descriptors, faults and capture status. Large trace rows are not duplicated into
evidence; retain the separately identified source trace to replay. A horizon capture
can be complete with callers or detached service work still active. Event-budget
failure marks capture incomplete and disables resume. Events beyond a legitimate
horizon are distinct from execution failure.

Indexed heap handles remove deadlines and superseded service events immediately.
The ordering comparator remains time/priority/stable key. Cancelled events neither
execute nor accumulate tombstones; obsolete handles cannot remove replacements.
