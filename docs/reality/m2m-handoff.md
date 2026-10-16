# M2M first safe Model-2 experience

Model 1 ACTIVE. Model 2 INTERNAL. Production PARKED. No grants, Free Mode,
challenge versions, main branch or production configuration are activated here.

The candidate first experience is **Read a current object around a process
restart**, at `/internal/model2/learn`. An explicitly granted lesson account can
create one separate owned VM/object-store design, choose before/during/after,
review the educational assumptions, execute and inspect the recorded read.
The complete authored contract is available for inspection without requiring the
user to fill dozens of internal fields. Original unsupported designs are preserved.

`object-restart/1` deliberately models retained logical current-object state,
not physical durability. The fixed profile writes 24 bytes at 2,000 modeled us,
crashes the object process at 10,000, restores readiness at 16,000, and reads at
8,000 / 12,000 / 18,000. Delete is at 30,000; horizon 40,000. All engineering
quantities retain explicit educational origins. The separate standalone CPU
arrival is not an application dependency call. Cloud timing, reliability,
security, durability and price remain Unknown.

| User action | Working behavior | Bound |
| --- | --- | --- |
| Create lesson design | Creates or retrieves one separate owned design | Never rewrites another saved design |
| Select saved design | Checks exact owned revision, one VM, one object store and directed port 8080 link | Refuses challenge workspaces, provider/legacy controls and unmodeled extra fields |
| Select read phase | Changes the actual scheduled read in the generated contract | Three versioned educational times; no editable cloud performance values |
| Review and consent | Shows a compact scenario, with every input and limit inspectable | Validation writes no run; stale revision/policy refuses admission |
| Run or retry | Uses the existing Outbox and worker with isolated execution | Exact review/key survives uncertain response and refresh; no automatic resubmit |
| Inspect result | Reports actual recorded read/reply and phase-labeled history | Prefixes remain incomplete; missing/corrupt evidence remains Unknown |
| Cancel or replay | Retains the next durable prefix or verifies it in isolation | No crash resume or inline fallback; a busy runner returns Unavailable |

## Contracts and isolation

The authenticated `/api/internal/model2` path, immutable M2K envelope, Outbox,
worker ownership, capture format, persistence and engine are reused. Existing
operator grants keep advanced authoring. `scope=lesson` grants refuse raw
authoring, raw admission and advanced historical replay. No UI can create grants.
The additive migration defaults existing grants to `operator` and adds immutable
lesson metadata with a deferred admission guard. Existing migration 18 is intact.

Review binds the strict phase/design/revision/retry key, complete generated
request, execution source, installed image ID and resource policy. Submission
reconstructs the request; an uncertain retry returns the original admitted run
even if configuration subsequently changes. Nothing executes during review.

An operator must configure `MODEL2_LESSON_IMAGE=sha256:<installed image ID>` on
both API and worker, and provide a trusted Linux Docker daemon to those processes.
No runner means refusal. Never expose a Docker socket to an executor or casually
mount one into production Compose: daemon control is privileged. A dedicated,
rootless runner with verified cgroup delegation is an activation prerequisite.
The repository does not provision or approve that deployment.

Each execution/replay gets hard 512 MiB memory, no additional swap, one CPU,
64 PIDs, 128 descriptors, five CPU seconds per process, a container-internal
15-second wall kill independent of the parent, and a parent deadline of 25 seconds.
The executor is nonroot, read-only, without network, capabilities or credentials;
only a bounded 16 MiB `/tmp` is writable. These are software execution guards,
not modeled infrastructure numbers. Logical event, input, frame and capture caps
remain necessary in addition to process isolation.

The parent verifies Docker configuration before start and actual cgroup/rlimit
values before accepting frames. It validates capture source, sequence, time and
history; commits under worker ownership; then ACKs. No crash continuation exists.
Cancellation/revocation stops at a capture boundary. Failed persistence, process
death, malformed/oversized output and resource termination preserve the last
committed prefix. A completed status requires a successful child exit and complete
protocol. Replay uses the same isolated path and writes no product state.
One database runner lease plus a live-container check prevents overlapping
executors after parent death. Known owned containers are reaped on startup and
before another run; removal verifies origin, image and ownership label.
Parking or losing the lesson runner does not block the active Model-1 worker.
When no lesson image is configured, startup skips lesson cleanup; previously
started containers still have their independent wall deadline. Cleanup failure
is logged and lesson execution refuses until its runner is available. Retained
lesson reports remain readable, and an already admitted exact retry can recover
its run identity even after the runner configuration is removed.

Historical input/report compatibility remains explicit: base reports retain
their captured facts, unknowns and source identity; incompatible replay refuses
reinterpretation. The lesson summary reads stored command results, never a phase
answer table. Missing/corrupt capture or incompatible lesson policy is Unknown.
A read in a retained prefix does not make the lesson complete.

## Claude presentation seam

Replace `features/internalLessons` presentation and styles freely, preserving
the shared `internal-lessons` DTOs/profile and `internalLesson.api.ts` client.
Keep owned revision selection, explicit design creation, review consent, exact
pending retry identity across refresh, per-owner tab storage, request abort on
unmount, bounded report polling and session/authorization refusal. The backend
owns review, scope, compilation, runner policy and fact/Unknown semantics.
`LessonResult` consumes the optional lesson report DTO; the original generic
report remains usable for detailed evidence. Reprove changed visible control
fingerprints before claiming UI validity after redesign.

## Validation and activation checkpoint

Focused engine tests exercise all three supported phases and exact deterministic
replay. The dedicated `m2m-preview` CI job uses disposable PostgreSQL/Redis,
actual Better Auth sessions, a real worker, Chromium and actual Linux containers.
It includes auth/scope/owner refusals, exact retry, stale and unsupported designs,
immutable metadata, cancellation/revocation, worker/ownership loss, persistence
failure, corrupt evidence, replay and real CPU/memory/wall/output failures.
Original full integration, packaging and accepted historical proof checks remain.

No activation is authorized by this implementation. Before exposing even a
controlled preview, an independent Lead must review M2M and explicitly approve
that audience, grants and operational envelope. Provision and verify a dedicated
Linux/rootless runner, cgroup delegation, immutable image distribution and access
control; inspect capacity, cleanup/monitoring and retention behavior on that actual
host. CI's rootful disposable Linux proof does not establish rootless deployment
or eliminate shared-kernel/runtime risk. The trusted advanced authoring path still
runs inline and is excluded from lesson-scoped users. This is not an arbitrary
code sandbox or permission to accept unbounded general authored simulations.
Claude's full presentation/usability redesign remains separate; preserve and
reprove the behavior contracts listed above. General Free Mode, challenge
migration, cloud/physical claims and production rollout retain their own gates.

Producer `23318372c2932890e3a03c9c2dc33721bcdea3b6` passed all **11 CI jobs** in
[run 38948550961](https://github.com/binaryrishabh/InfraForge/actions/runs/38948550961),
including the original full integration and packaging/release rehearsal.
[Retained JSON](m2m-preview-proof.json) is the exact 1,287,095-byte producer output,
SHA-256 `b92d05b43aa8cf65edf68a1abb14f4485ab34459281d9070a32d7423b2850cbe`.
[Provenance](m2m-provenance.json) retains original run/job, archive digest,
image ID and the distinct lesson/core source identities. It is never relabeled
as a later commit's fresh artifact. CI verifies both fresh and retained M2M proof;
the original integration job still verifies fresh and retained M2L evidence.

The M2M producer contains 22 backend cases, seven Chromium cases, three completed
phases and five real interrupted/cancelled prefixes. Browser checks use the actual
React app, Better Auth, API, PostgreSQL/Redis and worker, including a committed POST
with deliberately discarded response, reload and same-key duplicate-click recovery.
The test-only OS fixture retains actual memory OOM state, CPU termination, PID
denial, read-only/network controls, output refusal, wall termination and parent-death
overlap refusal. Fixtures and owned database rows are removed after proof. The
CI artifact includes visually inspected desktop review/result and mobile result
screenshots; that archive expires after 14 days, while the JSON and provenance
above remain in the repository. None of these tests approve a public audience.

Reconstruct without a database:

```sh
bun --no-env-file scripts/verify-model2-lesson-proof.ts docs/reality/m2m-preview-proof.json
bun --no-env-file scripts/m2m-proof-negative.ts docs/reality/m2m-preview-proof.json
bun --no-env-file scripts/m2m-lineage.ts
bun --no-env-file scripts/m2m-inventory.ts
```

The verifier reconstructs captures, complete/prefix replay and reports from the
retained input, enforces all required cases, kernel receipts and phase outcomes,
checks current source equality and pins retained bytes to their provenance.
Nine negative mutations must refuse. All 474 accepted shipping entries are preserved;
the eight new technical surfaces remain PARTIAL, seven new UI actions have actual
browser proof. Totals: 489 surfaces, 208 technical blockers, 28 valid UI surfaces,
252 existing UI reviews. General Model-2 shipping stays closed. M2M is ready for
independent engineering review; activation remains blocked by the conditions above.
