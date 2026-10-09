# InfraForge backend

Install dependencies once from the repository root with `bun install --frozen-lockfile`.
See [project setup](../Readme.md) and [project state](../docs/PROJECT_STATE.md).

The API, worker/simulator and WebSocket server run as separate Bun processes.
PostgreSQL stores layouts, deployments and outbox entries; Redis carries queue jobs,
control commands and deployment events. The worker runs Validate, SecurityScan and
CostEstimate before starting the shared simulation engine.

From this directory:

```sh
bun run db:generate
bun run db:migrate
bun run index.ts
# In separate terminals:
bun run worker.ts
bun run ws-server.ts
```

Migration deployment applies committed SQL to the configured database. Use local
development infrastructure and keep `.env` local. Root `bun run typecheck` generates
the client and checks all workspaces. Root `bun run test` runs unit and simulation
tests. [Integration tests](tests/integration/README.md) require fresh disposable
services and never use the ordinary development database.

Configure [authentication](../docs/AUTHENTICATION.md) before starting the API and
WebSocket server. Database-backed sessions and verified design ownership protect
HTTP/WS access. External OAuth credentials and a production release rehearsal
remain necessary; full checkpoint recovery is not implemented.
