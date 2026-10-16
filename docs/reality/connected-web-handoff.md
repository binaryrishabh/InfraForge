# Durable INTERNAL connected web execution

Starting point: `develop` at `7e24ac77a868c9cec9e76141d29a156115238e91`.
This work extends the existing authenticated Model-2 product pipeline. Model 1
remains ACTIVE, Model 2 INTERNAL and production PARKED. General Free Mode is closed.
The final validation and retained producer receipt are recorded separately below.

## Supported experience and boundary

An INTERNAL operator can save exactly four domain nodes: one Load Balancer, two
separate application Virtual Machines and one Database. Four directed saved
connections bind LB → each application and each application → the same DB.
The existing compiler materializes five request/response paths (including the
caller entry), ten directed links, explicit TCP listeners and serial connection
pools. The caller offers a bounded mix of two distinct application read/write
operations. A third distinct, read-only DB-backed operation supplies health probes.
There are no provider defaults or inferred service demands.

The learning question is: how does one application process failure affect actual
requests, observed backend health, traffic distribution, surviving application
work and logical DB effects, and when can traffic return? The proof also compares
caller timeouts before and after a remote logical commit. Ending a fault window
alone never proves successful recovery or failover.

Authoring is intentionally machine-readable. Save the graph through the existing
Infrastructure API, then POST `/api/internal/model2/runs` with the saved revision,
idempotency key, workload, full ProductContract, `execution` set to
`infraforge-internal-execution/2` and explicit `causal` limits. The contract's profile
version must be `bounded-connected-web/1`. `apps/backend/tests/connectedFixture.ts`
is a complete executable example; its numbers are labelled educational software
assumptions, not recommended cloud values. Existing input, report, replay and HTML
endpoints expose the durable result. No new grant, public route, engine or worker
queue is introduced. The object lesson and its isolated runner remain v1-only.

## Version decisions

| Boundary | Decision and reason |
| --- | --- |
| Execution envelope | `/1` preserved; `/2` admits only the connected profile and records causal retention policy |
| Evidence capture | `/1` preserved; `/2` projects callers, routing, compute, DB and a compact causal journal |
| Internal report | `/1` preserved; `/2` exposes connected state, decoded events and completeness |
| Replay result | Existing shape retained: fingerprint match, retained time, completion and no mutation |
| Product authoring/compiler | `infraforge-product-model2/1` and existing compiler unchanged; new authored profile `bounded-connected-web/1` |
| Causal journal | New `infraforge-causal/1`, private to evidence v2 |
| Product proof | New `infraforge-connected-product-proof/1`; old proof schemas and producers unchanged |

Schema dispatch lives in small envelope/capture facades. V1's original compiler
guard and projection live in separate modules. Cross-version relabels refuse.
Unknown historical runtime sources remain readable as recorded evidence, with
replay refused. A reviewed compatibility lineage explicitly reconstructs the
starting runtime source `bac35c995b5e5d59a9ce901745c014644fdb843183adbcbb761fb99184c11306`
and checks current source pins under Bun 1.3.14 before permitting its v1 replay.
`legacyRuntime.json` freezes original changed source text and hashes; it does not
relabel any artifact as a current producer. Older M2H/I/J source reconstructions
compose through that baseline. M2K/M2L/M2M raw JSON and producer provenance remain
unchanged. Endpoint and browser lineage record reviewed current source separately.
V2 replay requires its exact current execution source; no speculative v2 migration
is provided.

## Evidence and causality

Observers attach to existing engine transitions. They do not schedule work,
change service demand, synthesize outcomes or replace runtime state. With no
observer, the original runtime and v1 projection follow the same behavior.

* The journal preserves original `rootId`, `callId`, `parentCallId`, attempt,
  operation and offered time. A string dictionary compresses these exact strings;
  it does not invent a parallel identity. DB admission/statement/terminal events
  retain the actual session. Routing events retain actual backend and call IDs.
* Caller evidence retains offered/terminal times, operation, identity, outcome and
  response duration, plus bounded in-flight callers and explicit omissions.
* LB state retains membership, cached health, draining, successes/failures,
  selection/probe/outstanding counts, pending/active work, attempts, retries and
  failure reasons. Actual selected-backend, health-observation and terminal events
  survive independently of the engine's shorter diagnostic trace.
* Application projection retains received/admitted/rejected/completed/failed/
  cancelled counts, queue/serving/dependency wait state, workers, consumed modeled
  CPU and partial modeled memory. Events join actual app work to its DB child.
* DB projection retains sessions, transaction/query outcomes, statements, logical
  reads/writes, bounded rows and versions, locks/waiters, active/queued work,
  reasons, modeled CPU and explicitly modeled log counters. These are logical
  mechanism facts, not PostgreSQL/WAL/fsync/device durability claims.
* Checkpoints retain state at a cut. Journal rows retain events. Repeated snapshots
  are never substituted for missing selection history. The JSON report decodes
  the bounded journal for inspection; its Observed/Interpreted/Unknown sections
  remain separate. Physical capacity, reliability, complete memory, provider
  latency/prices and physical DB durability remain Unknown.

The independent verifier joins each completed caller to LB reception/selection,
delivered app request, admitted app work, DB child, delivered DB request, session,
commit, dependency return, app completion and successful return transports. It
also checks caller/resource/transaction/pool/link conservation. Replay independently
re-executes immutable input and compares the version-specific capture fingerprint.
It writes no product state. Prefix replay reproduces only the committed prefix;
it never resumes an interrupted run.

## Failure, recovery and cancellation

The fixture crashes app-a at modeled 17,000 us. In-flight work fails immediately,
but cached health still permits a later selection before detection at 30,000 us.
After that observation app-a stops receiving selections. Its process returns at
34,000 us, remains unready until 39,000 us, and becomes eligible only after an
actual successful health exchange. The surviving app consumes more actual modeled
CPU; DB work reflects requests and probes that really reached it. No extra latency
or degradation is fabricated from losing one target.

In the late-timeout experiment, the DB commits before the caller deadline; the
caller times out and the committed row version remains. In the early-timeout
experiment cancellation reaches unfinished DB work; the transaction cancels and
the row is unchanged. Caller cancellation cannot rewind a completed remote effect.
The existing engine owns cooperative cancellation, logical isolation and transport
policy; this work adds durable proof of their composition.

## Bounds and refusal behavior

Existing byte budgets remain: request 262,144; input 524,288; each capture 262,144.
Existing execution bounds remain 10,000 events, 64 samples, 1,000,000 us, at most
32 captures and existing metering bounds. V2 narrows caller admission to 32,
trace rows to 32, workers per app to eight, app queues to 32, DB keys/sessions/
active transactions to eight, DB pending queries to 32, statement plans to four,
LB active/pending work to 32 and per-path connections to four with one stream.
The engine additionally requires raw-result retention not exceed caller admission.

The authored causal limits are 1–512 events, 1–128 identities and 1–65,536 string
characters, with at most 2,048 dictionary strings. On exhaustion the journal stops
retaining events, continues counting omissions and records the first omitted time.
No engine event or outcome changes. `exactCausality` becomes false if either
causal or caller evidence is omitted. The report says exact request causality is
Unknown; omissions are not zero. In-flight work at the horizon is right-censored.
If the whole capture byte cap is exceeded, the common worker failure path retains
only the previously committed prefix. These are admission/retention policies,
not physical process or hardware limits.

Admission refuses graph/expansion outside this class, missing backend/health/
demand/dependency/query/listener/transport/provenance, ambiguous direction,
read/write mislabelling, auxiliary resources/controllers/commands, retry policies,
TLS/DNS/firewall assumptions, provider/region/SKU/size/autoscaling/legacy security
fields and faults owned by anything except one app process. Stale saved revisions
refuse; exact retries return the original immutable run. Authentication, operator
scope and owner isolation remain mandatory. Lesson grants cannot use this path.
Reader checks cover fingerprints, schema, bounded dictionaries, references,
time order, omission metadata and projected conservation; replay checks full
deterministic equivalence.

## Research and limitations

Reviewed first-party technical sources on 2026-10-17:

* [Envoy health checking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/health_checking)
  and [load balancing](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers):
  cached observed health and actual selection are distinct from process liveness.
* [Envoy connection pools](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/connection_pooling)
  and [draining](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/draining):
  connection, stream, request and graceful drain are different concepts. This
  profile excludes retries/drain experiments; it does not claim Envoy equivalence.
* [Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/)
  and [termination flow](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination-flow):
  alive, ready, observed eligible and terminating must not collapse into one bit.
* [PgBouncer pooling features](https://www.pgbouncer.org/features.html),
  [PostgreSQL transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html),
  [locking](https://www.postgresql.org/docs/18/explicit-locking.html) and
  [cancellation](https://www.postgresql.org/docs/18/libpq-cancel.html): session
  ownership, transaction effects and cancellation races need explicit evidence.
  These inform the conceptual distinctions; InfraForge owns its modeled policy.

This is an INTERNAL operator capability, not approval for less-trusted users or
general saved graphs. The isolated object lesson's host requirements are unchanged.
Actual dedicated rootless host readiness is UNKNOWN and parked until a host exists.
No Vercel repair/deployment, Model-1 retirement, challenge migration or grant
activation belongs to this checkpoint.

Claude can replace presentation around the versioned admission/report DTOs. Keep
the explicit authored quantities, revision/idempotency semantics, schema dispatch,
proof identities, completeness and Observed/Interpreted/Unknown distinctions.
The first eventual user exposure could guide this one connected failure experiment
and compare its retained reports. Activation still needs independent acceptance,
an approved access scope, suitable execution isolation for that scope and separate
user-facing validation. A useful next bounded capability is causally proven retry
behavior with explicit idempotency and remote-effect evidence; it is excluded here.

## Validation receipt

Pending the final exact-SHA CI and independently retained product proof.
