# M2M first safe Model-2 experience — implementation checkpoint

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

The final producer artifacts, exact-SHA CI outcome and explicit remaining blocks
must be recorded at the final checkpoint. This document is currently an
implementation checkpoint, not an activation decision or completed proof claim.
