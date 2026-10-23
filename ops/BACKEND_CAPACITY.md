# Backend capacity budget

Owner-confirmed production host for w14: **c7i-flex.large, 2 vCPU, 4 GiB
(4096 MiB)**. This fact came from the owner; the repository did not previously
record a production instance type. Simulation-provider example instance sizes
are not evidence of the production host. No production host was inspected.

| Work | Memory ceiling | CPU ceiling | Reason for initial budget |
| --- | ---: | ---: | --- |
| API | 384 MiB | 0.35 | Request handling and auth; bounded pool, request sizes and limiter state. Larger than WS because it handles HTTP/auth bodies. |
| Worker | 768 MiB | 0.50 | Largest allowance for execution, reports and queue processing; one worker only. A run exceeding it must fail rather than exhaust the host. |
| WS | 256 MiB | 0.25 | 128 sockets including authentication, heartbeat and bounded outbound buffers; no simulation execution. |
| Redis | 256 MiB | 0.15 | 96 MiB key budget with noeviction; 160 MiB remains inside the cap for process overhead, AOF buffers and rewrite copy-on-write. This is bounded headroom, not a guarantee under every write pattern. |
| Steady total | **1664 MiB** | **1.25** | Sum of the four independent cgroup ceilings. |
| Release BuildKit, including its build steps | **1152 MiB**, swap disabled | **0.50** | Separate docker-container builder; loading the image still uses the host Docker daemon. Failure blocks release before maintenance or service shutdown. |
| Host remainder during build | **1280 MiB** | **0.25** | OS, Docker/containerd, nginx, release controller and image loading. This is reserved arithmetic headroom, not a host cgroup or a measured consumption claim. |
| Migration/preflight | 256 MiB | 0.25 | Short-lived schema/readiness work. Preflight overlaps the live stack, but runs after the build and its builder cleanup; migration follows app shutdown. |

Exact policy target: **2 vCPU / 4096 MiB host**, with at most **2816 MiB / 1.75
CPU** assigned to the steady stack plus builder. During live preflight, the
assigned total is **1920 MiB / 1.50 CPU**. No local PostgreSQL server is included:
Compose uses an external database URL. CPU values are quotas, not dedicated
cores; memory values are ceilings, not measured working sets or reservations.

`scripts/release/build.ts` creates a uniquely named builder without changing the
selected/default builder and removes it after success, failure or a handled
release signal. It uses a BuildKit container limit rather than `docker build
--memory`, which does not bound BuildKit. The release lock serializes the normal
release path. Do not run manual builds, backup verification containers or other
large tasks concurrently on production under this budget.

These are conservative initial containment budgets, **not calibrated capacity**.
Peak working sets, Redis rewrite pressure, host daemon/image-load overhead and
throughput on this EC2 host are **Unknown**. Before deploying, measure a release
build while the stack carries representative load and verify no OOM kills,
memory pressure, queue starvation or health deadlines. If the build exceeds its
cap it should fail safely; adjust only after measurement or build off-host. Do
not consume the host reserve to make an unmeasured build pass. Also verify disk
space for old/new images and Redis AOF. No production sizing, limits or deployment
was changed by writing this policy.

## Model 1 work admission and lifetime

The following defaults are an initial operational containment policy for this
owner-confirmed c7i-flex.large host and the worker's **768 MiB / 0.50 CPU**
ceiling above. They are deliberately small limits chosen for initial operation;
they do not establish how many simulations fit or a measured throughput. Peak
simulation memory, ticks per second and host capacity remain **Unknown**. Measure
representative topologies before raising them. Commercial capability policy does
not override these limits.

| Environment setting | Default | Meaning |
| --- | ---: | --- |
| `MODEL1_OWNER_RESERVATIONS` | 2 | All queued/gating/live work for one owner, including paused work. |
| `MODEL1_GLOBAL_RESERVATIONS` | 4 | Total nonterminal reservations across all owners. |
| `MODEL1_QUEUED_RESERVATIONS` | 2 | Pending rows, including delivery retries and capacity waits. |
| `MODEL1_ACTIVE_RESERVATIONS` | 2 | Running gates plus live simulations; simulator also checks its local registry. |
| `MODEL1_ADMISSION_BYTES` | 131072 | Maximum UTF-8 JSON create data per admitted row; two queued inputs total at most 256 KiB, excluding database/index overhead and completed history. |
| `MODEL1_FREEFORM_SECONDS` | 900 | Simulated horizon for ordinary runs and unmatched reruns. |
| `MODEL1_RUNTIME_SECONDS` | 3600 | Simulator ceiling on every recorded/freeform horizon. |
| `MODEL1_LIFETIME_SECONDS` | 1800 | Wall-clock deadline from durable creation, including queue time and pauses. Activity cannot renew it. |

Settings must be positive safe integers. Compose supplies the same values to API
and worker; keep them equal in other launch arrangements. Reducing limits below
current occupancy refuses new admission/starts until occupancy falls. A capacity
refusal returns HTTP 429. Waiting for an active slot delays the BullMQ job without
spending its processing retries. Gate retries keep their active reservation.

All three public creation paths use one transaction-scoped PostgreSQL advisory
lock (186542854, 20). The deployment row itself is the durable reservation, and
its outbox record commits in the same transaction. Running transitions use that
same lock. Rows count until a terminal status **and** `runtimeActive=false` are
durable; neither HTTP completion, Redis delivery nor an in-memory timer releases
capacity. Existing nonterminal rows also count. No schema change or reservation
backfill is needed. Live deadlines and simulated ceilings use the existing
terminal capture/action transaction, marked `operational-limit`; queued/gating
deadlines fail durably in the worker's outbox loop. Storage/acknowledgement
failures freeze live execution and retain capacity until persistence recovers.
Deadlines are checked between worker cycles, rather than preempting synchronous
ticks. Worker restart continues to retire interrupted live runs durably.

Readiness performs deep startup/background verification, then serves a cached
snapshot. The background refresh waits 10 seconds after completion; one check can
run at a time. A snapshot older than 15 seconds fails closed while a slow check
finishes. Public requests cannot schedule checks. Liveness remains lightweight.
The nginx public readiness location allows 2 requests/second/IP with burst 4 and
returns 429 on excess; its zone belongs in nginx's `http` context.

Resource driver reference: [Docker container driver](https://docs.docker.com/build/builders/drivers/docker-container/).

## PostgreSQL and Neon connection allowance

Budget **54 steady application client slots**, not 54 always-open backends:
Prisma 10 × 3 processes = 30 (`apps/backend/utils/connectionPolicy.ts`);
readiness 1 × 3 = 3 (`apps/backend/health/readiness.ts`); worker ownership = 1
(`apps/backend/infra/workerOwnership.ts`); internal store default pool 10 × API
and worker = 20 (`apps/backend/internalModel2/store.ts`, installed pg-pool max=10).
API/WS use transaction pooling; the worker needs direct/session-preserving access.
With that topology, budget 32 pooled client slots and 22 direct/session slots.

To admit all 54 concurrently without connection starvation, require **at least
54 unreserved backend slots available to this application**, with relevant role/
database limits and pooler allowance also sufficient (at least 32 pooled active
slots in the applicable pool(s)). Neon's documented seven reserved superuser
slots make the exact no-other-consumer floor **max_connections >= 61**. Add every
other consumer plus migration/backup/probe/operator allowance; 61 alone supplies
no operational margin. With an explicit 10-slot operations reserve the floor is
**max_connections >= 71 + other-consumer slots**. These are derived requirements,
not an observed production setting. Do not confuse 10,000 pooler clients with
available simultaneous database work. For the documented 0.25 CU example,
104 total − 7 reserved = 97 usable: 54 steady + 10 operational leaves 33 for
other consumers. This arithmetic does not establish the actual Neon compute,
role caps, shared pool usage or measured query capacity, which remain Unknown.

An operator must verify `SHOW max_connections`, effective reserved slots,
role/database connection limits, active consumers and pooler settings before
deployment; no production database was queried here. Source: [Neon connection
pooling limits](https://neon.com/docs/connect/connection-pooling#understanding-connection-pool-limits).
