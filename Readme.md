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
- Docker (for Redis)
- PostgreSQL (local, or a free-tier host such as Neon)

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

On Windows, `bun run dev` calls the existing PowerShell launcher. It reuses the
configured local PostgreSQL/Redis containers, applies committed migrations, generates
the client, and supervises all four application processes. Keep local `.env` files in
their app directories.

### 2. Start Redis

```bash
docker run -d -p 6379:6379 --name infraforge-redis redis:7-alpine
```

### 3. Configure the database

Create `apps/backend/.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/infraforge
BETTER_AUTH_URL=http://localhost:3000
APP_ORIGINS=http://localhost:5173
```

Also set `BETTER_AUTH_SECRET` to a stable random secret of at least 32 characters.
Enable Google/GitHub with registered OAuth credentials and exact callbacks, as
described in [authentication setup](docs/AUTHENTICATION.md). Provider secrets stay
in the backend. Sign-in remains unavailable until a provider is configured.

Then generate the Prisma client and create the schema:

```bash
cd apps/backend
bun run db:generate
bun run db:migrate
```

### 4. Run the backend (three processes)

```bash
cd apps/backend
bun run index.ts       # API server           → :3000
bun run worker.ts      # pipeline + simulator (keep running)
bun run ws-server.ts   # WebSocket server     → :3001
```

### 5. Run the frontend

```bash
cd apps/web
bun run dev            # → http://localhost:5173
```

Defaults already point at localhost. Override via `apps/web/.env` if needed:

```
VITE_BACKEND_API_URL=http://localhost:3000/api
VITE_WS_URL=ws://localhost:3001
```

## Quick tour

1. Open http://localhost:5173 and sign in with a configured Google/GitHub provider.
2. Open the **Designer** and click *Load sample architecture*.
3. **Save**, then **Deploy** — pick a scenario preset (try *Peak Hours*).
4. Watch the pipeline run, then the canvas go **LIVE** with telemetry cards.
5. Push the load slider past 100%, inject a **Crash** on the cache, and
   watch the database stampede.
6. **Tear down** when done.

## Tests

```bash
bun run test   # domain, catalog, frontend and backend; 30 simulation golden scenarios
```

## Docker releases

Compose runs Redis, API, one worker and the WebSocket server from an exact
commit-tagged image. Use the [controlled release procedure](docs/DEPLOYMENT.md)
for migration preflight, maintenance, readiness and compatible container rollback.
That guide also provides a disposable local rehearsal. For normal development,
use `pwsh ./dev.ps1`; the frontend is served separately.

---

Public release still requires provisioned/tested OAuth, reviewed hosted limits and
a verified hosted backup, proxy/TLS and release process. Runs interrupted
by a worker restart fail explicitly; complete checkpoint recovery is not implemented.
