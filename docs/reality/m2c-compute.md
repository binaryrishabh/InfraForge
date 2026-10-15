# Internal compute mechanism: m2c/1

This preserves the M2C compute contract. M2D now supplies the internal registry default;
M2C replay selects `workloadVersion: "m2c/1"`. M2B replay remains available
with `workloadVersion: "m2b/1"` or its direct entry point; M2A replay remains direct.
Model 1, published exports, browser imports, challenges and runtime packaging stay
unchanged. Compute lives in its own `model2/compute` module and composes the shared
workload runtime's arrivals, root/call identity, caller deadlines and result book.
The existing database station is only a dependency proof, not a future DB model.

## Capacity, workers and runnable work

Compute configuration separates explicit known CPU capacity (`cores`, homogeneous
modeled CPU-time units), application `workers`, queue capacity and scheduler policy.
There is no SKU mapping or RPS capacity. A compute-specific versioned profile supplies
CPU core-us/op, per-invocation parallelism, **application blocking wait** in wall us,
resident components, provenance and validity. The wait is not disk/network I/O.

Workers hold one admitted operation from acquisition through CPU, application wait
and serial dependency return. Queue capacity excludes workers. A caller detaching
does not free the worker or memory. Cooperative cancellation releases this resource's
work and asks its child; an unsupported child continues independently.

Only CPU-phase calls are runnable. Equal max-min sharing is capped per invocation:
distribute capacity equally, stop each capped call at its limit, redistribute excess.
One single-threaded call on four CPU units with eight configured workers gets one
unit, not half a unit. Its unused three units remain idle until eligible work exists.
Configured workers never create phantom CPU reservations. Worker evidence separates
idle, runnable, blocking wait and dependency wait; runnable counts are not physical
thread placement. `receivingShare` counts positive fluid allocations.

## Events and accounting

At membership/capacity/pause/cancellation/competitor changes, settle service since
the previous physics anchor, recompute shares and replace **one** CPU boundary event
per compute resource. The next boundary is the earliest completion, quota exhaustion
or replenishment. No fake scheduler tick/quantum loop is needed. Completed batches
are removed before callbacks; same-event mutations are coalesced for rescheduling.

Observation projects the current state without changing anchors, budgets, remaining
demand or events. Input arrays and output metadata canonicalize by stable identity.
Integer-us event times round completion upward, while consumed core-time never
rounds demand upward. Fractional shares/demands use IEEE-754 arithmetic; conservation
tests allow a small 1e-6 core-us absolute numerical tolerance. No call is declared CPU
complete before remaining demand reaches zero. A pause tied with completion retains
the notification until resume, where zero-remaining work can complete immediately.

`availableCoreUs = integral(configured capacity dt)` includes paused/throttled periods:
the configured resource still exists. CPU consumption is separately split into
application and competing work. Sample intervals report their deltas and app/total
utilization against that integral. Capacity changes integrate each segment correctly;
zero-available intervals report utilization Unknown. Worker-slot wall time includes
occupied dependency/paused workers and is explicitly different from CPU core-time.

## Quota, competition and symptoms

An optional authored quota supplies core-us budget and integer-us period. Epochs align
to virtual time zero, budget does not carry across periods, and all runnable work in
this compute resource (including competitors) consumes the same budget. A partly
used final microsecond is clipped to remaining budget. Unused time at rounded service
boundaries is not invented CPU. Throttled wall time is separate from utilization.
No quota is assumed when none is supplied. This is not full hierarchical cgroup
bandwidth, burst allowance, CPU weight or Linux per-CPU silo emulation.

CPU competition adds a finite-demand capped runnable job for an authored interval.
It consumes actual scheduler service until completion or removal; application shares
change through normal allocation. No CPU percentage or downstream multiplier is added.
Service pause freezes local CPU/wait progress, retains owners and permits independent
downstream operations to return. Capacity changes are explicit interventions, checked
against declared profile capacity bounds. New configurations outside a bound are refused.

Symptoms are factual: unavailable, backpressured, CPU-contended, CPU-throttled or
modeled-resident-limit-exceeded. Share deficit is an integral of unsatisfied eligible
parallelism, not measured OS PSI/context-switch delay. No 90%-CPU failure rule exists.

## Resident memory and lifetime

This is an additive **modeled resident component** ledger, not a universal RSS/heap/
allocation/page-cache model. Applications declare their own named process/worker and
admitted/active-invocation components. Baseline, per-worker, retained, request and
active convenience fields are optional. Coverage must explicitly be complete-model
or partial; omitted components in a partial model cannot silently become zero.

Process/worker/retained components persist for the resource lifetime. Admission-owned
components are acquired for queued or active work and released on that invocation's
remote completion/rejection/supported cancellation. Active-owned components start at
worker acquisition and persist through CPU, blocking, dependency wait and caller
timeout. Detached work keeps its ownership. There is no implicit GC/retained-cache
evolution; retained state is authored static state until a future mechanism owns it.

Evidence reports component quantities, exact known subtotal, total Known/Range/Unknown,
live request/active ownership counts, optional limit and comparison. Unknown input or
partial coverage preserves Unknown total. An explicitly complete empty model can
sum to zero; this is distinct from missing input. Byte arithmetic rejects unsafe
overflow and component ownership is reconciled with station populations.

`observe` compares known modeled residency to a configured limit without changing
work. `reject-allocation` is an explicit application allocation policy requiring full
known coverage and a valid initial footprint. Admission or worker-acquisition
allocations that would exceed the authored limit are rejected and accounted for.
No process dies, no OOM victim is chosen, and no reclaim/swap or real memory-pressure
signal is inferred. This is deliberately narrower than container `memory.max`.

## Bounds and invariants

Existing caller/station/result retention budgets remain. Compute guards limit workers,
component counts, interventions and quota boundaries; their unit/provenance/policy
entries appear in evidence. Validation occurs before duplicating large traces.
Root outcomes reconcile independently of retained remote work.

```
app core-time + competitor core-time <= integral(configured capacity dt)
workers = idle + runnable + blocked wait + blocked dependency
resident request owners = queued + serving + dependency waiting
resident active owners = serving + dependency waiting
```

All M2B caller/remote accounting, latency population floors, keyed arrival randomness
and bounded raw/histogram evidence are preserved. No service distribution is sampled;
there is no new RNG stream. Network, DB mechanisms, GC, physical scheduling and memory
reclaim remain absent/Unknown. Model 2 remains INTERNAL.
