# First-stack execution containment and host qualification

Model 1 remains active. This slice supplies the first-stack isolated execution
and deterministic replay boundary for the later owned run store/queue. It does
not install public admission routes, activate Model 2, or qualify a deployment.
The old internal/lesson routes retain their separate policies; lesson readiness
does not enable this executor.

`executeFirstStackIsolated` and `replayFirstStackIsolated` accept immutable,
bounded input JSON plus server-owned configuration and a fenced persistence
adapter. They share one fixed Docker container name and one PostgreSQL session
advisory lock through `withFirstStackOwnership`. Use the direct/session-preserving
worker connection. The store adapter must check the captured owner, cancellation,
authorization and run token inside its transaction; commits resolve only after
the database acknowledges them. Do not use a transaction pooler or automatically
retry uncertain commits. After connection loss, read the stored prefix.
Slice 11 must implement its immutable run/outbox store against these interfaces.

The parent checks the host qualification before creating a container. A missing,
failed, expired, wrong-image, wrong-source, changed-daemon or capacity-two record
refuses both operations. Qualification files are trusted operator configuration,
never request data. They expire after at most 24 hours and must be protected from
application/user writes. A successful qualification does not activate Model 2.

Each executor has a 768 MiB memory limit with swap disabled, 0.5 CPU quota,
20-second process CPU rlimit, 64 PIDs, 128 FDs, 60-second independent wall timer,
75-second outer supervisor deadline, 16 MiB input and 32 MiB output budgets.
The 20-second CPU rlimit is deliberately below the 30 CPU seconds available
under the wall/quota envelope. The cgroup quota bounds aggregate process CPU;
RLIMIT_CPU applies per process. Only shipped Bun engine code runs. Network,
capabilities, writable root, bind mounts, inherited credentials and Docker
logging are disabled; `/tmp` is a 16 MiB noexec tmpfs. Output is bounded before
JSON parsing, and each cut requires a durable acknowledgement. Kernel kill,
cancel, revocation, persistence failure and cleanup failure are executor
interruptions, not modeled infrastructure outcomes.

The fixed name is reserved atomically by Docker. A failed create never removes
someone else's container. A dead parent leaves the name reserved, even after
the independent wall timer kills the workload; a replacement refuses. Recovery:
disable admission, stop the owning worker, verify the exact daemon/image,
container label/token and persisted prefix, then remove that specific stopped
container by full ID. Never prune, remove by an unverified name, select another
daemon, or rerun automatically. Cleanup failure keeps the gate closed.

Replay uses the original source/image/input hash and compile lock. It advances
exactly to the recorded processed-event count, including cuts with equal-time
work pending. It compares deterministic evidence, excluding wall-dependent cut
sequence and interruption explanations. Outcomes are `MatchesRecordedPrefix`,
`Mismatch`, or explicit unavailable/interrupted. Reading a report does not execute.

## Laptop: serial characterization

Run from this checkout with Bun 1.3.14 and a locally installed immutable image
built from these exact sources. The command creates at most one task-owned
container at a time and removes its containers and derivative image. It uses
no database URL or ambient application environment. Use a new output directory.

```powershell
$image = docker image inspect infraforge-first-stack-proof --format '{{.Id}}'
bun --no-env-file --no-install scripts/first-stack-host/qualify.ts --endpoint=npipe:////./pipe/dockerDesktopLinuxEngine --image=$image --target=laptop-desktop --output=.agent/w20/host-serial --containment-only
```

`--containment-only` permits exit zero when the serial containment checks pass;
`qualification.json` still has `qualified:false` because actual DB-loss,
API/worker/DB/Redis overhead and two-run headroom were not measured. It is not
a readiness bypass. This is the required mode while the shared laptop is
restricted to one container. Linux CI uses the same serial mode and must not be
presented as Docker Desktop or EC2 capacity evidence.

The worker-death probe kills its own helper process after the initial cut has
been written, verifies replacement refusal, waits for the independent container
deadline, verifies the cut is unchanged, then removes the owned container.
Stress fixture source and image identities are retained separately from the
release execution identity. A timeout, missing observation or failed cleanup
keeps the corresponding gate false.

## EC2: owner-run qualification, not performed by this task

The nominated host is c7i-flex.large, 2 vCPU / 4 GiB. No AWS or production access
is needed by the producer. Run only on an idle owned host during a separately
arranged maintenance/rehearsal window, with the existing deployment already
absent. The script refuses a nonempty daemon and never stops existing containers.
It creates a fresh disposable PostgreSQL/Redis/API/worker topology from installed
immutable images and removes only its labelled objects. It does not read `.env`,
connect to production PostgreSQL, or change the installed Compose deployment.

Build the release image off-host or sequentially using the bounded builder in
`scripts/release/build.ts`; remove the builder before probing. Install the pinned
Bun dependencies and generate Prisma. Select exact installed PostgreSQL 18 and
Redis image IDs, then run:

```sh
bun --no-env-file --no-install scripts/first-stack-host/qualify.ts \
  --endpoint=unix:///var/run/docker.sock \
  --image=sha256:REPLACE_WITH_RELEASE_IMAGE_ID \
  --postgres=sha256:REPLACE_WITH_POSTGRES_IMAGE_ID \
  --redis=sha256:REPLACE_WITH_REDIS_IMAGE_ID \
  --target=ec2-c7i-flex.large --topology=full --allow-disposable-topology \
  --output=/absolute/new/qualification-directory
```

Direct Docker control is privileged host authority. Run the supervisor as a
dedicated trusted service account with access to only the chosen local daemon;
never mount its socket in an executor or expose this CLI through HTTP. A rootless
daemon may be selected by its explicit `/run/user/UID/docker.sock`; it must
actually enforce cgroup v2 controls. There is no default-context fallback.

Full mode tests one run then two simultaneous probe runs; two is measurement
only, and product capacity stays one. It samples actual API liveness/readiness,
worker readiness, per-service Docker statistics and whole-host free memory.
It terminates a real lock-holding database session after a committed prefix.
Cancellation/revocation use explicit authority changes. Kernel memory, CPU,
PID/FD, output, wall, orphan and replacement tests also run. The checks use
authored safety criteria: health responses below 3 seconds and at least 512 MiB
observed host free memory. These are qualification thresholds, not latency SLOs
or calibrated performance claims. Missing samples fail closed.

Configured disposable topology totals: API 384 MiB/0.35 CPU, worker
768 MiB/0.5 CPU, DB 512 MiB/0.25 CPU and Redis 256 MiB/0.15 CPU;
with two executors, 3456 MiB/2.25 CPU. CPU ceilings may overcommit the 2-vCPU
host during this stress characterization. The production Compose stack's
external DB and optional WS topology differ: review these differences, actual
external DB latency, host daemon/OS overhead, and the existing
`BACKEND_CAPACITY.md` budget before activation. A failed two-run stress
measurement cannot authorize a second production worker. Builds, backup jobs
and migrations must not overlap execution on the 4-GiB host.

Retain `evidence.json`, `qualification.json`, fixture hashes, immutable image
IDs and source revision. Review every gate, failed observation and cleanup.
Do not edit a failed record to pass. Rerun into a new directory after changes.
No paid measurement, cloud throughput calibration or production rollout is
authorized by this runbook.

Docker resource behavior:
[resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
and [container creation options](https://docs.docker.com/reference/cli/docker/container/create/).
