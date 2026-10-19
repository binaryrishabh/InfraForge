# Free local pilots

This opt-in Windows Docker Desktop orchestrator runs Linux app/generator containers
and a disposable disk-backed PostgreSQL 18 container. It never calls a cloud API.
The current adapter is G1; the manifest, root/attempt joins, counters, populations,
immutable raw directory and summary producer are reusable for later component pilots.
No application engine, demand profile, launch claim or historical report is changed.

Run from the repository root, with Bun 1.3.14 and the manifest's images available:

```powershell
bun --no-env-file scripts/reality/first-stack-pilots/run.ts C:/external/new-g1-capture
# After all containers have stopped:
bun --no-env-file scripts/reality/first-stack-pilots/summary.ts C:/external/new-g1-capture docs/reality/g1-local-pilot.json
bun --no-env-file scripts/reality/first-stack-pilots/verify.ts C:/external/new-g1-capture
# Ordinary CI/static verification needs no Docker or raw artifacts:
bun --no-env-file scripts/reality/first-stack-pilots/verify.ts
bun --no-env-file --no-install test scripts/tests/firstStackPilots.test.ts
bun --no-env-file node_modules/typescript/bin/tsc --noEmit -p scripts/reality/first-stack-pilots/tsconfig.json
```

The runner refuses an existing capture directory and stores its campaign status
before starting work. CPU, PostgreSQL and generator limits total 3.25 CPUs and
3328 MiB, with swap disabled and a 128-process ceiling per container. Only one
generator/window runs at a time. Traces are written to a Docker native volume,
then copied to the external directory before the volume is removed. This avoids
per-root Windows file-sharing latency. Trust authentication is confined to an internal
bridge without published ports; it is a disposable fixture, not deployment advice.
The scripts use only Bun built-ins, so the immutable Bun image is the entire app
and generator dependency closure; no npm package installation is done in the pilot.
Do not reuse the database name as the harness mount name with this Bun build.

G1 fixes two logical worker lanes, a 64-entry waiting queue, one persistent SQL
connection, 60,000-iteration PBKDF2-SHA256 CPU work (64/16/32-byte input/salt/output),
and a 1024-key table with 64-byte values. Empty control traverses the same worker
IPC without PBKDF2. A point read is a read-only autocommit indexed lookup. Worker
CPU is Linux thread core-time from `clock_gettime(CLOCK_THREAD_CPUTIME_ID)`; app
and generator process CPU are sampled independently. Process CPU is not divided
into an invented per-query DB coefficient. Wall-minus-thread-CPU is not an
identified runnable wait. CPU queue and explicit app pool waits are separate.

Six short discovery windows precede the frozen design. CPU candidate rates use
discovery thread demand, capped by the generator ceiling. Point-read exploration
uses 30/300/1000/15 requests/s; a knee above the safety ceiling stays Unknown.
The entire second rate is a holdout. No fit or profile activation occurs. A seeded
Fisher-Yates shuffle orders four rates × three repeats per handler; each has 30 s
warmup and 60 s observation. Each handler sweep has a 30-minute hard stop and an
individual Docker CLI has a synchronous wall watchdog with explicit container
removal on timeout. A separate 90-second empty/IPC control
precedes the two sweeps. Scheduled main windows total 37.5 minutes, plus discovery
and setup. Worker/pool changes are separate campaigns, not concurrent variants.
Randomized low-rate windows are recovery candidates; causal recovery requires
checking the actual predecessor and cannot be inferred from the label alone.

Open arrivals retain intended offer independently of actual send. The generator
caps inflight requests at 128, scheduler lag at 50 ms and offer at 1000/s. Excess
work is recorded as generator-drop, never silently rescheduled. Deadlines start
at intended offer. Client deadline/transport errors, HTTP errors, and right-censored
survivors are retained. Caller abort does not cancel already admitted server work;
server late completion is joined separately. No retries or modeled write commits
exist in this adapter. All timestamps are monotonic microseconds with process-local
origins; only root IDs, not timestamp subtraction, join client and server clocks.

Raw JSONL records root ID, attempt, operation/key, intended/actual send, deadline,
queue entry/dispatch, pool acquire, query interval, worker core-time, terminal
outcome and response-body bytes where observed. One-second samples retain process
CPU, heap/RSS/external buffers, FDs/sockets, cgroup throttling/pressure and device
byte counters. Sampled maxima can miss between-sample peaks. App event-loop delay
is nonnegative lateness of a 10-ms periodic timer, not a portable GC coefficient.
Full wire bytes, per-query DB CPU, OS runnable queue age, physical device latency,
cancellation acknowledgement and full resident memory remain explicitly null.
SQL, plans, settings, kernel, host CPU/SMT, versions, image identity, cgroup limits
and filesystem observations stay with the capture.

`summary.schema.json` describes the retained summary; `validateSummary` additionally
checks population conservation, limits, holdout separation and forbidden promotion.
Successful-cohort quantiles use nearest-rank empirical order statistics and retain
their sample count. Cohort throughput divides terminal observed-arrival outcomes
by 60 seconds; it is not a wall-window completion counter. Missing distributions
are null, never zero. Gzip JSONL only after capture ends; the producer accepts raw
or `.gz` streams and pins exact binary hashes of all external artifacts. Source
and summary text hashes normalize CRLF to LF. Preserve failed captures separately.
The static verifier checks the pinned summary and digest; passing an external raw
directory additionally reconstructs every population and binary identity.

The only allowed inference is a description of these handlers under these recorded
host/runtime/limits. No Model 2 output comparison is performed. The exported demand
candidate excludes whole-rate holdout, discovery and warmup and remains unpromoted.
There is no AWS/DO coefficient, arbitrary-app scaling, universal SMT/GC constant,
complete memory model, public p95/p99 calibration or managed DB entitlement here.
