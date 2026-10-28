# InfraForge

InfraForge lets you design a system, run it under load and faults, and see where and
why it breaks. Learners get guided challenges; engineers get a free canvas. Both use
the same simulation engine and the same run record.

## Status

Every new run uses **Model 2**. The older Model 1 engine has been removed; reports of
earlier Model 1 runs stay readable and are never relabelled, but those runs are never
run again. Public launch: **6 November 2026**. See [project state](docs/PROJECT_STATE.md).

## How a Model 2 run works

1. A run is a design, a workload, a seed and the actions taken during the run, each
   with the simulated second it was applied.
2. The browser runs Model 2 in a background worker and shows the run live.
3. When the run ends, the server runs the same inputs again with the same engine.
   Only the server's result is stored as the official record and used for scores,
   so a browser cannot change a result.

Model 2 is deterministic: the same inputs always give the same result. That makes a
run reproducible; it does not make it a measurement of a real cloud. Assumptions are
listed with each run, and **Unknown is never shown as zero**.

## Repository layout

```text
apps/web/             Browser interface
apps/backend/         API, authentication, worker, persistence, challenges and reports
packages/domain/      Resource and workload types, graph rules and examples
packages/contracts/   Shared input, event, evidence and report contracts
packages/catalog/     Provider catalog data and lookups
packages/simulation/  Simulation engine (Model 2)
scripts/              Validation and release tooling
ops/                  Home-server and release configuration
docs/                 Project state, deployment, authentication and legal drafts
```

## Local development

Use Bun **1.3.14**, PowerShell 7 (`pwsh`) and Docker Desktop for the local
PostgreSQL and Redis services. From the repository root:

```sh
bun install --frozen-lockfile
bun run dev:setup
bun run dev
```

The [local launcher](dev.ps1) owns setup and startup: it creates labeled local
data services, applies migrations, generates Prisma and starts the API, worker,
WebSocket server and frontend. Open `http://localhost:5173/signup` to create a
local account. Ctrl+C stops the application processes; local data services remain.

See the existing [frontend development notes](apps/web/README.md),
[backend development notes](apps/backend/README.md) and
[authentication setup](docs/AUTHENTICATION.md) for configuration details.
The root [package manifest](package.json) defines the workspace commands.

## Testing

Run the repository's scripts from the root:

```sh
bun run typecheck
bun run lint
bun run test
bun run test:tooling
```

`bun run test` runs workspace tests; `test:tooling` checks repository tooling.
For disposable local Docker integration fixtures, use
`bun run test:integration:local` and follow the
[integration test guide](apps/backend/tests/integration/README.md).

## Further reading

- [Project state and current release status](docs/PROJECT_STATE.md)
- [Design and interface truth rules](docs/DESIGN.md)
- [Deployment procedure](docs/DEPLOYMENT.md)
- [Production bootstrap and recovery](docs/PRODUCTION_BOOTSTRAP.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Legal review register](docs/legal/README.md): [terms](docs/legal/terms-of-service.md),
  [privacy policy](docs/legal/privacy-policy.md) and
  [cookie notice](docs/legal/cookie-notice.md) are drafts for owner and legal review.
