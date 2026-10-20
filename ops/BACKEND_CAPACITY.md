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

Resource driver reference: [Docker container driver](https://docs.docker.com/build/builders/drivers/docker-container/).
