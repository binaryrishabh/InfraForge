# InfraForge

InfraForge is being built to let you design a system, run it under recorded load
and faults, and see where and why it breaks. Learners get a structured path with
scored scenarios, like system-design interview problems; engineers get a place
to explore realistic designs and their limits. Both audiences are intended to use
the same simulation engine and run record.

## Status: in development

The public application currently runs **Model 1**, the older educational engine.
You can save designs, run simulations, attempt guided challenges and inspect
retained reports. These results are educational approximations. The current
interface uses a timetable to show recorded run evidence. See
[project state](docs/PROJECT_STATE.md), the
[challenge implementation](apps/backend/challenges/routes.ts) and the
[report readers](apps/backend/reports/routes.ts).

**Model 2 is the permanent engine lineage under development.** Its first supported
stack targets a load balancer, application compute, PostgreSQL-oriented relational
operations and an optional keyed cache. Internal implementations and qualification
checks exist, but Model 2 is not publicly activated. The browser runner is not
connected to the shipped application, and its submission API is unmounted and
closed by default. Public recorded-load import, browser execution and the new
scored challenge library are coming work, not available product features. See the
[first-stack launch contract](docs/reality/stage0-launch-contract.md),
[browser runner boundary](docs/reality/browser-runner.md),
[closed submission router](apps/backend/firstStack/submissionRoutes.ts) and
[server-owned challenge library](apps/backend/firstStack/scoredChallenges/README.md).

Model 1 will retire through an explicit activation decision. Existing reports
keep their original identities and remain readable; they are not automatically
relabeled as Model 2 results. Retirement is currently disabled in the
[historical execution policy](apps/backend/runRecords/availability.ts); the
[historical compatibility guide](docs/reality/historical-compatibility.md)
describes the boundary.

## How the new engine works

The intended workflow is one deterministic engine from the Model 2 lineage:

1. Save a design and bind it to an explicit workload, fault schedule and seed.
2. Run that engine in a browser worker for immediate local feedback.
3. Submit a scored run to the backend. The server independently runs the same
   immutable input with the same pinned engine and seed, and compares the result.
4. Only after verification, run hidden test workloads and apply the server's
   rubric. Hidden workloads and rubrics stay server-side.

These mechanisms exist behind inactive integration boundaries. Browser output is
untrusted and cannot mark itself verified. See the
[browser implementation](apps/web/src/firstStack/runner.ts),
[server verifier](apps/backend/firstStack/submissionWorker.ts) and
[hidden scoring boundary](apps/backend/firstStack/scoredChallenges/README.md).

Determinism makes an experiment reproducible; it does not establish real-world
accuracy. The evidence vocabulary is:

| Label | Meaning |
| --- | --- |
| `supported-calibrated` | Validated against independent measurements for the stated domain. |
| `supported-logical` | Supported software behavior within the modeled scope. |
| `assumption-only` | Depends on authored assumptions or an educational numerical model. |
| `unsupported` | Unavailable, or without a mechanism supporting the claim. |

No current whole-stack metric earns `supported-calibrated`. **Unknown is never
shown as zero.** Timing assumptions must stay visible, and a supported compute
cost subtotal does not make the full bill known. See the
[claim matrix](docs/reality/launch-claim-matrix.md),
[quantity rules](packages/simulation/src/reality/quantity.ts) and
[first-stack cost implementation](apps/backend/firstStack/providerCost.ts).

## Why there is a backend

Local feedback is only part of the product. The backend provides accounts and
ownership checks, queues execution work, applies abuse limits, and stores durable
inputs and results. The new scored-run path also needs an independent verifier
and a private home for hidden workloads and rubrics. Accounts, queueing and run
history exist today; the new verification path remains inactive. Sources:
[API and authentication wiring](apps/backend/index.ts),
[rate limits](apps/backend/utils/rateLimiter.ts),
[backend architecture](apps/backend/README.md) and
[submission verification](apps/backend/firstStack/submissionWorker.ts).

## Terms used in commits and docs

| Term | Meaning |
| --- | --- |
| Model 1 / Model 2 | The active educational engine / the permanent engine lineage being developed for explicit supported domains. |
| Execution identity / lineage | The pinned source, runtime and dependency identity used for execution / the recorded origin and reviewed compatibility relationships between versions or runs. |
| Cut | A bounded evidence snapshot through a stated simulated time, with completeness, omissions and unfinished work recorded. Reaching the time horizon does not mean every request finished. |
| Run record | A common read format joining original experiment input, engine identity, evidence and optional learning context. It preserves historical formats. |
| Evidence labels | The four labels above, describing what supports a claim. |
| Scored challenge | A versioned design problem evaluated against explicit criteria; the new library also uses hidden workloads. |
| Hidden workload | A server-owned test schedule used to assess a design beyond its visible sample. |
| Reality checks | Repository inventories, proofs and calibration checks that make supported scope and missing evidence explicit; passing software checks alone does not prove cloud accuracy. |

Details: [execution identity](docs/reality/execution-identity.md),
[cut contract](apps/backend/firstStack/executionCut.ts),
[run record contract](packages/contracts/src/reports/runRecord.ts),
[challenge authoring](apps/backend/challenges/README.md) and
[reality documentation](docs/reality/README.md).

## Repository layout

```text
apps/web/             Browser interface and inactive first-stack browser runner
apps/backend/         API, authentication, workers, persistence and scoring
packages/domain/      Resource and workload types, graph rules and examples
packages/catalog/     Provider catalog data and lookups
packages/contracts/   Shared input, event, evidence and report contracts
packages/simulation/  Simulation engines, mechanisms and evidence capture
scripts/              Validation, proofs, calibration and release tooling
ops/                  Local and release infrastructure configuration
docs/                 Product state, deployment, reality checks and legal drafts
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
- [Reality checks and engine development](docs/reality/README.md)
- [Deployment procedure](docs/DEPLOYMENT.md)
- [Production bootstrap and recovery](docs/PRODUCTION_BOOTSTRAP.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Legal review register](docs/legal/README.md): [terms](docs/legal/terms-of-service.md),
  [privacy policy](docs/legal/privacy-policy.md) and
  [cookie notice](docs/legal/cookie-notice.md) are drafts for owner and legal review.
