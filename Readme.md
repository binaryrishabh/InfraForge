# ⚡ InfraForge

A cloud-infrastructure simulation playground. Design an architecture on a
canvas, declare the load it must survive, deploy it into a living
simulation — then break it, watch it degrade, and learn why.

Design → Declare → Deploy → Watch → Break → Monitor → Learn → Redesign

## What is this?

InfraForge is not a diagramming tool. It is a living model of a cloud:

- **Designer canvas** — drag & drop 11 resource types (DNS, CDN, load
  balancer, VMs, cache, database, queues…), connect them, and pick real
  provider SKUs (AWS + DigitalOcean) with real prices and capacity.
- **9-stage deployment pipeline** — transactional outbox → queue → worker,
  streamed live over WebSockets.
- **Living simulation** — per-resource telemetry at 1 Hz (CPU, memory, RPS,
  connections, health), autoscaling pools, vertical scaling with restart
  downtime, and a live cost burn ticker.
- **Chaos engineering** — crash, CPU spike, memory leak, network delay,
  disk failure; with cascading failures, retry storms, and cache stampedes.
- **Cinema** — shake on saturation, smoke on failure, speed control
  (pause / 1x / 10x / 60x), and scenario presets (Peak Hours, Flash Sale,
  Bot Attack…).

The simulation is *simulation theater*: indistinguishable in feel from a
real cloud, but educational — never production sizing advice.

## Repo layout

```
shared/    TypeScript contract layer (engine, SKU catalog, types) — used by both sides
Backend/   Bun + Express + Prisma + PostgreSQL + Redis + BullMQ
Frontend/  React 19 + Vite + Tailwind 4 + zustand + dnd-kit
```

## Prerequisites

- [Bun](https://bun.sh) 1.x or newer
- Docker (for Redis)
- PostgreSQL (local, or a free-tier host such as Neon)

## Setup

### 1. Install dependencies

```bash
cd Backend && bun install
cd ../Frontend && bun install
```

### 2. Start Redis

```bash
docker run -d -p 6379:6379 --name infraforge-redis redis:7-alpine
```

### 3. Configure the database

Create `Backend/.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/infraforge
```

Then generate the Prisma client and create the schema:

```bash
cd Backend
bunx prisma generate
bunx prisma migrate dev
```

### 4. Run the backend (three processes)

```bash
cd Backend
bun run index.ts       # API server           → :3000
bun run worker.ts      # pipeline + simulator (keep running)
bun run ws-server.ts   # WebSocket server     → :3001
```

### 5. Run the frontend

```bash
cd Frontend
bun run dev            # → http://localhost:5173
```

Defaults already point at localhost. Override via `Frontend/.env` if needed:

```
VITE_BACKEND_API_URL=http://localhost:3000/api
VITE_WS_URL=ws://localhost:3001
```

## Quick tour

1. Open http://localhost:5173 and create an account (local mode — the
   account lives in your browser for now).
2. Open the **Designer** and click *Load sample architecture*.
3. **Save**, then **Deploy** — pick a scenario preset (try *Peak Hours*).
4. Watch the pipeline run, then the canvas go **LIVE** with telemetry cards.
5. Push the load slider past 100%, inject a **Crash** on the cache, and
   watch the database stampede.
6. **Tear down** when done.

## Tests

```bash
cd Backend && bun test   # 28 golden simulation scenarios
```

## Docker (all-in-one backend)

```bash
cd Backend
DATABASE_URL=... docker compose up --build
```

This runs Redis + API + worker + ws-server together. The frontend still
runs via `bun run dev` (or is deployed separately).

---

*Everything real. Everything live. Nothing hardcoded that shouldn't be.*