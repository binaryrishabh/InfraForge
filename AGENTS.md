# InfraForge engineering constitution

Read this file before editing InfraForge. Inspect the relevant implementation before acting; source code takes precedence over stale descriptions in the README.

## Product and priority

InfraForge is an interactive cloud/distributed-systems learning laboratory. Users build architectures, declare workload, run them, observe behavior, inject failures, understand why they failed, improve them, and rerun. The current primary user understands basic backend development and wants practical distributed-systems intuition. This is an educational simulation, not production capacity-planning advice.

Complete the learner journey first:

**Challenge → Build → Predict → Run → Break → Understand → Improve → Run again.**

This is the product priority, not a claim that every step is already implemented. Do not expand into enterprise features, IaC, social features, multi-cloud breadth, or unrelated future scope unless explicitly requested.

## Current architecture

- `Backend/`: Bun/TypeScript and Express API (`index.ts`, `routes/`), Zod request validation, and Prisma/PostgreSQL persistence for infrastructure layouts, deployments, and transactional outbox entries. `worker.ts` polls the outbox, dispatches BullMQ jobs through Redis, runs the three current gates (`Validate`, `SecurityScan`, `CostEstimate`), and starts simulations. `simulator/simulator.ts` owns live instances, advances the shared engine, handles Redis control messages, publishes snapshots, and checkpoints runtime data. `ws-server.ts` forwards Redis deployment events to browser subscribers. The older README's nine-stage pipeline description is not current.
- `Frontend/`: React 19/TypeScript, Vite, Tailwind, Zustand, and dnd-kit. `src/features/` contains the architecture canvas, deployment workflow, live monitoring/controls, dashboard, landing pages, and browser-local authentication placeholder. API clients send commands; `useDeploymentSocket` feeds server snapshots into the monitoring store. Canvas drafts persist in localStorage; explicit save/update and the pre-run deploy path persist layouts through the API. Reports/settings currently contain stub pages.
- `shared/`: Shared TypeScript domain contracts, enums, constants, deployment-readiness validation, AWS/DigitalOcean SKU catalogs, and simulation logic. `simulation/engine.ts` exports initialization, ticking, routing/topology reconciliation, and pool operations from focused modules; `simulation/cost.ts` supplies domain cost calculations. Both sides import this layer through `@shared`.

## Non-negotiable invariants

- Simulation truth comes from deterministic engine behavior and backend results. The frontend must not invent telemetry, health, failures, or outcomes. Presentation effects must not change simulation truth.
- AI may explain recorded simulation facts; it must never invent simulation facts. Distinguish observations, interpretations, and unknowns.
- Preserve reproducible outcomes for the same architecture, workload/scenario, seed, engine behavior, and control inputs at the same simulated ticks. Keep unseeded randomness and wall-clock timing out of outcome calculations. Current log timestamps use wall-clock time; do not claim byte-identical replay of all metadata or complete checkpoint recovery.
- Do not independently duplicate shared simulation/domain rules in frontend and backend. Extend the shared source and contracts where appropriate.
- Derive costs from SKU/catalog and shared domain data, including existing generic estimates where applicable. Do not introduce arbitrary UI pricing constants. Accumulated live cost follows simulated time.
- Live edits must not silently mutate the saved architecture. `sync-topology` affects the running simulation; saved layouts change through a save path. Preserve the current pre-run deploy save separately from live-edit behavior.
- Preserve working behavior. Unrelated cleanup is not a reason to break existing flows.
- Never access secrets outside this repository or print `.env` values. Production secrets live outside this repository. Never touch production infrastructure unless explicitly instructed; that does not authorize accessing external secrets.

## Local development

Use local infrastructure for development and testing. From the repository root, the launcher is:

```powershell
pwsh ./dev.ps1
```

It reuses existing Docker containers, waits for readiness, runs Prisma `migrate deploy` and `generate`, then starts the four application processes with visible logs. Ctrl+C stops application processes; data containers remain running. Starting it applies migrations, so respect task restrictions on execution.

| Component | Local endpoint or entry point |
| --- | --- |
| PostgreSQL | `InfraForgePostgres`, `localhost:5432` |
| Redis | `InfraForgeRedis`, `localhost:6379` |
| API | `Backend/index.ts`, port `3000` |
| Worker/simulator | `Backend/worker.ts`, no listening port |
| WebSocket | `Backend/ws-server.ts`, port `3001` |
| Frontend | Vite, `http://localhost:5173/` |

`Backend/.env` and `Frontend/.env` are gitignored local development files. Keep them local and untracked. Frontend clients use `VITE_BACKEND_API_URL` and `VITE_WS_URL`, falling back to `http://localhost:3000/api` and `ws://localhost:3001`. Preserve the frontend readiness check's `localhost` hostname; do not assume Vite binds IPv4 `127.0.0.1`.

## Change discipline

- Inspect relevant source, callers, tests, and Git status before editing. Preserve existing user changes.
- Make the smallest coherent change. No opportunistic refactors or dependency upgrades unless required by the task.
- Never silently alter committed database migrations. Use a new migration for schema evolution and explain its effect on local data.
- New behavior requires appropriate tests. Add regression coverage for bugs where practical.
- Surface consequential product/architecture decisions and unresolved tradeoffs instead of quietly guessing.
- Do not commit, push, or merge unless explicitly requested.

## Verification

Choose checks appropriate to the change and honor explicit task limits:

- Frontend: from `Frontend/`, `bun run build` performs TypeScript and Vite build checks; `bun run lint` runs ESLint.
- Backend: run TypeScript checking against `Backend/tsconfig.json` using the installed compiler; there is currently no named backend typecheck script. Do not install or upgrade tools merely to manufacture a passing check.
- Unit/simulation tests: from `Backend/`, run `bun test`; engine golden scenarios live in `tests/engine.golden.test.ts`. Engine, topology, capacity, chaos, scaling, or cost changes require relevant simulation/regression coverage. Review changed expectations rather than blindly updating them.
- Changes crossing API/database/Redis/worker/WebSocket boundaries require local integration validation of the affected path; a build alone is insufficient.
- Frontend behavior changes require browser/user-flow validation when appropriate, including affected save, deploy, live-edit, and monitoring flows.
- Report exact checks and results, pre-existing failures, and anything not tested. If execution is restricted, perform allowed static checks and state the remaining validation gap.

## Git safety

- Treat `main` as stable and conceptually protected. `agent/dev` is the current integration branch; verify the actual branch before work.
- `safety/pre-agent-setup` is a historical rescue snapshot. Do not modify it.
- Never reset, clean, force-push, or otherwise destroy user work without explicit permission. Do not discard unrelated changes or overwrite them to simplify a task.

## Agent communication

Report what changed, why it changed, tests/checks executed and their results, and remaining risks or untested behavior. Identify decisions requiring user direction. Keep reports concrete and concise; never claim successful validation that was not performed.
