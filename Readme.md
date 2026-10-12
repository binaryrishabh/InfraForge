# ⚡ InfraForge

A cloud-infrastructure simulation playground. Design an architecture on a
canvas, declare the load it must survive, deploy it into a living
simulation — then break it, watch it degrade, and learn why.

Design → Declare → Deploy → Watch → Break → Monitor → Learn → Redesign

## What is this?

InfraForge is not a diagramming tool. It is a living model of a cloud:

- **Designer canvas** — drag & drop 11 resource types (DNS, CDN, load
  balancer, VMs, cache, database, queues…), connect them, and pick real
  provider SKUs (AWS + DigitalOcean) from a dated price catalog, with educational capacity estimates.
- **Three deployment gates** — Validate, SecurityScan and CostEstimate;
  transactional outbox → queue → worker,
  streamed live over WebSockets.
- **Living simulation** — per-resource telemetry at 1 Hz (CPU, memory, RPS,
  connections, health), autoscaling pools, vertical scaling with restart
  downtime, and a live cost burn ticker.
- **Chaos engineering** — crash, CPU spike, memory leak, network delay,
  disk failure; with cascading failures, retry storms, and cache stampedes.
- **Cinema** — shake on saturation, smoke on failure, speed control
  (pause / 1x / 10x / 60x), and scenario presets (Peak Hours, Flash Sale,
  Bot Attack…).

The simulation is an educational model, not production sizing advice. Resource
behavior and capacity are intentional approximations; catalog prices are snapshots,
not live quotes. See [accepted architecture and release risks](docs/PROJECT_STATE.md).

## Repo layout

```
apps/web/            React 19 + Vite + Tailwind 4 + Zustand + dnd-kit
apps/backend/        Bun + Express + Prisma + PostgreSQL + Redis + BullMQ
packages/domain/     Resource/workload types, graph rules, readiness and examples
packages/catalog/    Provider SKU data and lookup/filter functions
packages/contracts/  Deployment, run-input, telemetry and event contracts
packages/simulation/ Deterministic engine, runtime types, cost and tuning
```

## Prerequisites

- [Bun](https://bun.sh) 1.3.14
- Docker Desktop (local PostgreSQL 18 and Redis 8)
- PowerShell 7 (`pwsh`) for the local launcher

## Setup

### 1. Install dependencies

```bash
bun install --frozen-lockfile
```

Install once from the repository root. The apps and `packages/*` are Bun workspaces;
the root `bun.lock` is the dependency authority. App manifests and root overrides
pin dependency versions. Each app keeps its own TypeScript version
(web 6.0.3, backend 5.9.3).

Both apps declare explicit workspace dependencies and import package exports.
Packages expose TypeScript source directly to Bun and Vite without an emitted build.
Contracts depend on domain; simulation depends on domain, catalog and contracts.
The web app imports simulation tuning and capacity, never engine runtime or cost.
Engine goldens live in `packages/simulation/tests`. Prisma generation runs before
backend tests and typechecks; generated files stay untracked.

Run `bun run build`, `bun run typecheck`, `bun run lint`, `bun run test`, and
`bun run check:boundaries` from the root. Checks run without caching during migration.
The validation workflow runs each check independently, including `bun run audit`
and `bun run test:tooling`. See [project state](docs/PROJECT_STATE.md) for results and remaining gaps.
`bun run test:integration:local` creates and disposes of isolated local Docker fixtures,
keeping evidence outside the containers. `bun run test:integration` uses caller-managed
services. Requirements and the temporary-resource policy are in
[the integration test guide](apps/backend/tests/integration/README.md).

### 2. Prepare and start the local stack

```bash
bun run dev:setup
bun run dev
```

Setup creates clearly labelled development containers, a persistent PostgreSQL 18
volume and a dedicated Docker network. Data ports bind only to loopback:
PostgreSQL `127.0.0.1:55432`, Redis `127.0.0.1:56379`. The launcher refuses
unknown resource/port collisions. It never resets an existing developer database.

The ignored root `.env.development.local` contains generated local database and
session secrets. Keep it with the persistent volume; losing its database password
requires deliberate local recovery. The launcher ignores app `.env` files and
hosted database/provider settings, applies all ten committed migrations, generates
Prisma, then supervises API, worker, WS and frontend. Application listeners also
bind to loopback, on ports 3000, 3001 and 5173.

Ctrl+C stops the four application processes. PostgreSQL/Redis remain for the next
session. To stop these owned data services without deleting developer data:

```bash
docker compose --env-file .env.development.local -f ops/compose.dev.yml stop
```

OAuth is intentionally unconfigured in this isolated workflow. Authentication still
uses real database sessions; it has no public test-login endpoint or browser-only
identity bypass. Disposable integration tests create fixture users/sessions through
Better Auth's adapter, separate from developer data. Provider configuration is
described in [authentication setup](docs/AUTHENTICATION.md); hosted settings and
production cutover are currently parked.

## Quick tour

1. Open http://localhost:5173 and sign in with a configured Google/GitHub provider.
2. Open the **Designer** and click *Load sample architecture*.
3. **Save**, then **Deploy** — pick a scenario preset (try *Peak Hours*).
4. Watch the pipeline run, then the canvas go **LIVE** with telemetry cards.
5. Push the load slider past 100%, inject a **Crash** on the cache, and
   watch the database stampede.
6. **Tear down** when done, then open **Reports** to understand retained run evidence.
   Observations, deterministic interpretations and unknowns stay separate. Reports use
   recorded gates, events, original inputs and checkpoints; they do not invent a full
   telemetry trace or an exact final snapshot.

## Tests

```bash
bun run test   # domain, catalog, frontend and backend; 30 simulation golden scenarios
```

## Docker releases

Compose runs Redis, API, one worker and the WebSocket server from an exact
commit-tagged image. Use the [controlled release procedure](docs/DEPLOYMENT.md)
for migration preflight, maintenance, readiness and compatible container rollback.
That guide also provides a disposable local rehearsal. Hosted release work is parked;
normal product development uses the local setup/launcher above.

---

Public release still requires provisioned/tested OAuth, reviewed hosted limits and
a verified hosted backup, proxy/TLS and release process. Runs interrupted
by a worker restart fail explicitly; complete checkpoint recovery is not implemented.
