# InfraForge agent organization

Status: complete (roster design); organization proposed, not activated. Updated: 2026-09-30, Asia/Calcutta.

## Purpose and authority

Recommend **29 specialist roles**, plus the existing **Lead Architect** and **Git Steward**: 31 roles in the target organization. The count excludes the existing broad Simulation Engineer, whose eventual replacement is described below. These are bounded capabilities invoked as needed, not 31 agents that must run on every task. Optimize for depth, evidence quality, small cognitive scope, and independent challenge. Concurrency limits affect scheduling, never the integrity of role boundaries.

`AGENTS.md` remains authoritative. Protect **Challenge → Build → Predict → Run → Break → Understand → Improve → Run again**. This roster authorizes no implementation, new skills, enterprise expansion, production operations, or Git mutations. Only Lead Architect, Simulation Engineer, and Git Steward skills currently exist in `.agents/skills/`; the other roles below are proposals.

Read `AGENTS.md`, `.agent/PLANS.md`, the effort plan, current Git state, and relevant source before each assignment. Substantial implementation efforts need an ExecPlan with all required sections. The founder's one-file restriction for this organizational design is honored by keeping its design record in this file.

## Repository evidence behind the boundaries

| Observed implementation | Organizational implication |
| --- | --- |
| `shared/simulation/engine.ts` exports initialization, ticking, routing/reconciliation, and pool operations. `engineTick.ts` mixes workload equations, failure effects, and scaling lifecycles. | Separate simulation expertise without requiring immediate source refactors. One writer must integrate edits to a mixed file. |
| Database connection pressure and cache failure/stampede behavior have dedicated branches in `engineTick.ts`; cache miss forwarding also appears in `engineRouting.ts`. MessageQueue currently has generic capacity behavior rather than a rich backlog/delivery model. | Give simulated data services a distinct owner now. Define a bounded messaging expert for approved messaging work, with no claim that its richer model already exists. |
| `shared/catalog/catalog.types.ts` describes a curated approximate SKU snapshot; `shared/simulation/cost.ts` computes hourly rates; `Backend/simulator/simulator.ts` accumulates cost while advancing simulated ticks. | Provider facts, capacity interpretation, billing formulas, and backend execution need distinct owners and explicit handoffs. |
| `Backend/routes/deployment.routes.ts` creates deployment/outbox rows transactionally. `worker.ts` polls the outbox, dispatches BullMQ, runs Validate/SecurityScan/CostEstimate, and starts simulation. | API, database integrity, and job delivery are separate specialties. The educational SecurityScan gate is not an audit of the application. |
| `Backend/simulator/simulator.ts` owns process-local instances, Redis controls, snapshot assembly, and checkpoint writes. Restart handling initializes state again. | Separate pure engine time/state semantics from host scheduling and persistence; do not describe current checkpoints as full recovery or replay. |
| `Backend/infra/pubsub.ts` and `Backend/ws-server.ts` transport events; `Frontend/src/features/deployment/hooks/useDeploymentSocket.ts` applies snapshots to the monitoring store. | Transport reliability, telemetry meaning, frontend session lifecycle, and visualization have separate responsibilities. |
| `useCanvasPersistence.ts` saves browser drafts; `useInfrastructureActions.ts` explicitly saves layouts and saves before deployment; `useLiveTopologySync.ts` sends live changes. These hooks live under `Frontend/src/features/canvas/hooks/`. | Canvas editing and remote deployment workflow need different ownership while preserving live/saved separation. Directory location alone does not assign responsibility. |
| `ResourceMetrics.interface.ts` has CPU, memory, optional connections/RPS, and health, but no latency/error-rate measurements. `ReportsStubPage.tsx` and `SettingsStubPage.tsx` are stubs; authentication is browser-local. | Learning, UX, and monitoring must not assume unimplemented facts or capabilities. Authentication expansion needs a separate product decision. |
| `Backend/tests/engine.golden.test.ts` is the current test suite found in the source inventory. Frontend package scripts provide build/lint, with no browser-test script. | Simulation, integration, browser, and learning QA require separate evidence. Proposed harnesses and scenario modules must be labeled new work. |

## Hierarchy

The following branches organize routing; they are not additional manager agents. Lead Architect assigns work directly to narrow specialists. Independent assurance reports directly to Lead Architect and the founder, outside implementation ownership.

```text
Founder
└── Lead Architect (C01)
    ├── Simulation and model semantics
    │   ├── S01 Simulation Core Engineer
    │   ├── S02 Distributed Systems Behavior Engineer
    │   ├── S03 Performance and Capacity Modeler
    │   ├── S04 Cloud Resource and Catalog Specialist
    │   ├── S05 Cost Modeler
    │   ├── S06 Telemetry Semantics Engineer
    │   ├── S07 Simulation Data Services Specialist
    │   └── S08 Simulated Messaging Specialist
    ├── Backend execution and local platform
    │   ├── P01 API Contract Engineer
    │   ├── P02 Persistence and Data Integrity Engineer
    │   ├── P03 Job and Deployment Workflow Engineer
    │   ├── P04 Realtime Transport Engineer
    │   ├── P05 Simulation Host Engineer
    │   └── P06 Local Development Platform Engineer
    ├── Frontend engineering
    │   ├── F01 Architecture Canvas Engineer
    │   ├── F02 Frontend Deployment Workflow Engineer
    │   ├── F03 Monitoring Visualization Engineer
    │   ├── F04 Design System and Accessibility Engineer
    │   └── F05 Frontend Application Shell Engineer
    ├── Product and learning
    │   ├── L01 Product UX Designer
    │   ├── L02 Learning Experience Designer
    │   └── L03 Scenario Designer
    ├── Evidence research
    │   └── R01 Technical Evidence Researcher
    ├── Independent assurance
    │   ├── Q01 Systems Architecture Reviewer
    │   ├── Q02 Integration QA Engineer
    │   ├── Q03 Simulation Red-Team Engineer
    │   ├── Q04 Browser and Accessibility QA Engineer
    │   ├── Q05 Learning Outcome Evaluator
    │   └── Q06 Application Security Reviewer
    └── Authorized delivery
        └── Git Steward (C02)
```

## Reading the role cards

Names and IDs are stable routing references. **Areas/contracts** identify common semantic ownership and editing candidates, not blanket write permission. Full paths are repository-relative; abbreviated filenames inherit the directory named in that card, and frontend `src/` shorthand means `Frontend/src/`. Interface names refer to files under `shared/interface/` unless another location is given. Proposed artifacts have no existing module unless explicitly identified. Every assignment still needs exact paths/symbols, a single writer, acceptance criteria, dependencies, validation, and a reviewer.

**Research** means external research before implementation or, for review/design roles, before issuing conclusions. “Normally yes” allows reuse of a current, directly applicable evidence brief. “Conditional” requires naming the unresolved fact that triggers research. Inspect local source for every role. External claims should use official documentation, original papers, or primary datasets, with dates/versions, applicability limits, conflicting evidence, and unresolved questions. Research cannot turn provider claims into proven simulator behavior.

**Models** are recommendations for this session's available models, not settings changes or measured superiority claims. Use `gpt-6.1-sol` for focused repository implementation and `gpt-6-astra` for model synthesis, uncertain technical reasoning, and adversarial review. Both are available with the efforts listed here. Model support is session-dependent; verify availability when dispatching and respect founder choices. The assignments below are engineering judgments; effort controls reasoning depth and supported levels depend on the model, as described in [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning) (checked 2026-09-30). Raise high to xhigh for unresolved high-impact ambiguity, not automatically for every task. Independence requires a separate agent and fresh evaluation, even when it uses the same model.

## Coordination and delivery roles

### C01 — Lead Architect

- **Primary expertise:** product-to-engineering decomposition and system integration decisions.
- **Responsibilities:** inspect current behavior; classify trivial/substantial work; maintain the ExecPlan; define outcome, acceptance criteria, owners, dependencies, model/effort recommendations, integration order, and evidence gates; resolve cross-domain conflicts; surface consequential choices to the founder.
- **Non-responsibilities:** normally implementing feature code, supplying every domain's technical answer, self-certifying independent review, authorizing production or protected-branch changes.
- **Areas/contracts:** `.agent/PLANS.md` as a governing reference; effort plans under `.agent/plans/`; cross-domain decision and ownership records. Current skill: `.agents/skills/lead-architect/SKILL.md`.
- **Invoke when:** the founder gives a product goal or an effort needs coordination/replanning.
- **Collaborators:** relevant specialists, Q01/Q02, founder, then C02 when authorized.
- **Independent reviewer:** Q01 for architecture and boundaries; Q05 for consequential learning outcomes.
- **Research:** conditional; commission R01/domain research for consequential unknowns instead of guessing.
- **Typical model/effort:** `gpt-6-astra`, high; xhigh for ambiguous system-wide tradeoffs.
- **Split further when:** multiple sustained product streams overwhelm coordination; introduce bounded effort coordinators while retaining one architecture decision owner.

### C02 — Git Steward

- **Primary expertise:** selective, verified Git delivery.
- **Responsibilities:** after implementation, validation, and required independent review, inspect the complete intended diff, verify scope and evidence, and perform explicitly authorized commit/push using its existing skill.
- **Non-responsibilities:** feature repair, deciding product scope, replacing QA, merging into main or operating production without separate explicit founder approval.
- **Areas/contracts:** Git index/current non-protected branch; `.agents/skills/git-steward/SKILL.md` governs execution.
- **Invoke when:** the final reviewed change is ready and the founder has authorized the handoff.
- **Collaborators:** C01 and Q02; domain owners for explanations of intended changes.
- **Independent reviewer:** Q02 checks the delivered file set and reported validation/commit evidence; it does not authorize a push.
- **Research:** normally no; conditional for unfamiliar Git behavior or remote policy.
- **Typical model/effort:** `gpt-6.1-sol`, high, for complete diff and evidence inspection.
- **Split further when:** a separately authorized release/distribution workflow develops distinct responsibilities; never fold production operations into Git stewardship by default.

## Simulation and model semantics

### S01 — Simulation Core Engineer

- **Primary expertise:** deterministic state machines and simulated time.
- **Responsibilities:** initialization, seed/RNG consumption, tick order, state transitions, lifecycle timing, pool/replica state bookkeeping, and reproducibility contracts.
- **Non-responsibilities:** selecting capacity equations, routing/failure policy, prices, provider facts, backend process scheduling, or promising checkpoint recovery.
- **Areas/contracts:** `shared/simulation/engine.ts`, `engineInitialState.ts`, `engineHelpers.ts`, `enginePools.ts`; lifecycle sections of `engineTick.ts`; `SimulationState`, `TickInputs`, `TickResult`, `PoolRuntime`, and `VerticalScaleAction` interfaces under `shared/interface/`.
- **Invoke when:** tick sequencing, deterministic inputs, initialization, scale/recovery transitions, or retained state changes.
- **Collaborators:** S02, S03, S06, P05; S05 for cost-relevant resource transitions.
- **Independent reviewer:** Q03; Q01 for public engine-contract changes.
- **Research:** conditional for new scheduling, RNG, or replay algorithms; local invariants govern existing behavior.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** replay/checkpoint restoration or autoscaling control algorithms become sustained, independently testable subsystems.

### S02 — Distributed Systems Behavior Engineer

- **Primary expertise:** simulated request/dependency graphs and failure propagation.
- **Responsibilities:** graph routing, dependency reachability, service-to-service cascade/retry semantics, and logical network/failure propagation; define composition of resource behavior across edges and explain simplifications.
- **Non-responsibilities:** internal database/cache/message-delivery semantics (S07/S08), InfraForge's actual PostgreSQL/Redis/BullMQ reliability, numerical capacity calibration, cloud price facts, or learner assessment design.
- **Areas/contracts:** `shared/simulation/topology.ts`, `engineRouting.ts`; dependency/failure sections of `engineTick.ts`; `shared/validation/validateDeploymentReadiness.validation.ts`; connection rules and chaos semantic contracts.
- **Invoke when:** an architecture routes or fails differently, readiness rules change, or a new distributed-systems concept is simulated.
- **Collaborators:** S01, S03, S04, S06, S07/S08, L03; P01 for shared readiness consumption.
- **Independent reviewer:** Q03, with Q01 for topology/system-design assumptions.
- **Research:** normally yes for new behavior, using primary systems literature and authoritative service semantics.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** network partitions/routing protocols and service resilience policies become independently deep models; keep database and messaging behavior with S07/S08 already.

### S03 — Performance and Capacity Modeler

- **Primary expertise:** workload, saturation, units, and numerical model calibration.
- **Responsibilities:** workload-to-demand equations, burst profiles, CPU/memory/connection utilization, capacity/health thresholds, sensitivity bounds, and explicit educational approximation limits.
- **Non-responsibilities:** backend throughput optimization, cloud catalog fact entry, distributed routing policy, billing formulas, or rendering charts.
- **Areas/contracts:** quantitative sections of `shared/simulation/engineTick.ts`; `shared/constants/CAPACITY.constants.ts`, `DEFAULT_WORKLOAD_PROFILE.constants.ts`; relevant `SIMULATION_CONSTANTS.constants.ts` fields; `WorkloadProfile.interface.ts`.
- **Invoke when:** a workload/SKU changes predicted load, saturation, scaling thresholds, or a proposed latency/error model needs quantitative justification.
- **Collaborators:** S01, S02, S04, S06, S07/S08, L03, R01.
- **Independent reviewer:** Q03 independently checks dimensions, limiting cases, and sensitivity.
- **Research:** normally yes for changed equations or calibration; separate measured provider evidence from chosen teaching approximations.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** workload generation and service-specific queueing/storage/network models each require sustained separate calibration.

### S04 — Cloud Resource and Catalog Specialist

- **Primary expertise:** provider resource capabilities and provenance of catalog facts.
- **Responsibilities:** verify SKU identity, scope/date/region, capabilities, limits, and list-price inputs; distinguish sourced facts from approximations; define simulated resource configuration meaning and educational configuration checks with domain owners.
- **Non-responsibilities:** real cloud provisioning, production operations, capacity equations, cost aggregation/conversion, or adding providers beyond authorized scope.
- **Areas/contracts:** `shared/catalog/`; `shared/constants/RESOURCE_TYPES.constants.ts`, `RESOURCE_PORTS.constants.ts`; resource configuration fields in `Resource.interface.ts`; `Backend/stages/securityScan.stages.ts` for educational resource checks, with Q06 consultation.
- **Invoke when:** SKU/provider metadata, resource options, or modeled cloud constraints change.
- **Collaborators:** S03, S05, S02, F01, R01, Q06.
- **Independent reviewer:** R01 checks primary-source provenance; Q03 checks modeled implications; Q06 checks security-teaching claims when relevant.
- **Research:** normally yes; provider documents and price sources with explicit date/region are required for factual updates.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** approved scope adds sufficiently different service families/providers that each needs continuing specialist verification; do not expand cloud breadth to justify the split.

### S05 — Cost Modeler

- **Primary expertise:** deterministic educational billing models and cost units.
- **Responsibilities:** price-to-rate conversion, generic estimate policy, live resource accounting, simulated-time accumulation semantics, and consistency of pre-run estimates and runtime costs.
- **Non-responsibilities:** inventing provider prices, implementing host timers, frontend display effects, procurement, or production financial advice.
- **Areas/contracts:** `shared/simulation/cost.ts`; `Backend/stages/costEstimation.stages.ts`; cost fields in `SimulationSnapshot.interface.ts`; accumulation formula requirements consumed by P05 in `Backend/simulator/simulator.ts`.
- **Invoke when:** cost formulas, pricing units, replicas/SKU transitions, pause/speed behavior, or cost presentation semantics change.
- **Collaborators:** S04, S01, P05, S06, F03.
- **Independent reviewer:** Q03 uses hand-computable examples and equivalent simulated durations; R01 checks new billing-source claims.
- **Research:** normally yes for new billing rules/inputs; conditional for algebraic fixes within an approved model.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** authorized scope adds independently complex usage metering, tiered/commitment pricing, or cost-allocation models.

### S06 — Telemetry Semantics Engineer

- **Primary expertise:** observable simulation facts, metric meaning, and evidence contracts.
- **Responsibilities:** define units, scope, simulated observation time, aggregation windows, missing/unavailable values, and provenance for metrics/logs/snapshots; reconcile producers and consumers without inventing observations.
- **Non-responsibilities:** owning all shared types, choosing capacity formulas, Redis/WebSocket delivery, dashboard styling, or writing causal learning conclusions.
- **Areas/contracts:** `shared/interface/ResourceMetrics.interface.ts`, `SimulationSnapshot.interface.ts`, `SimulationLog.interface.ts`, `PoolSnapshot.interface.ts`, and relevant observable fields of `TickResult.interface.ts`; producers/consumers remain with their owners.
- **Invoke when:** adding/changing a measurement, interpreting an existing metric, or linking explanations and scenario assertions to recorded evidence.
- **Collaborators:** S01/S02/S03/S05, P05, P04, F03, L02/L03.
- **Independent reviewer:** Q03 for fact/measurement validity; Q02 for contract delivery compatibility.
- **Research:** conditional for unfamiliar measurement definitions; normally required before new latency/percentile/error-rate semantics.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** recorded event history, causal tracing, and statistical aggregation develop distinct contracts and substantial implementation.

### S07 — Simulation Data Services Specialist

- **Primary expertise:** simulated database and cache service semantics.
- **Responsibilities:** database connection-pool pressure and read/write demand meaning, cache hits/misses and stampede behavior, and interactions between cache availability and database demand; state the abstraction's limitations. Propose consistency/durability semantics only for explicitly authorized new behavior.
- **Non-responsibilities:** InfraForge's actual Prisma/PostgreSQL/Redis persistence, graph traversal, numerical calibration, provider SKU verification, queue delivery, or inventing storage features to justify the role.
- **Areas/contracts:** database/cache branches of `shared/simulation/engineTick.ts`, cache forwarding semantics in `engineRouting.ts`, database/cache fields in `shared/constants/SIMULATION_CONSTANTS.constants.ts` and workload/state contracts; one writer integrates changes to these mixed files.
- **Invoke when:** database connection behavior, cache effectiveness/failure, write demand, or a data-service teaching scenario changes.
- **Collaborators:** S02 for graph composition, S03 for equations/bounds, S01 for state, S04 for limits, S06, L03.
- **Independent reviewer:** Q03 using independent data-service counterexamples; R01 checks specialized source claims when needed.
- **Research:** normally yes for new/changed data-service semantics; distinguish documented database/cache mechanisms from deliberately simplified simulation behavior.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** database replication/consistency/storage behavior or cache eviction/invalidation each becomes sustained deep work; create separate database and cache modelers before enlarging this role.

### S08 — Simulated Messaging Specialist

- **Primary expertise:** message-delivery, backlog, and consumer-flow semantics in educational models.
- **Responsibilities:** assess current queue abstraction and define approved backlog, producer/consumer, acknowledgment, redelivery, ordering, and backpressure behavior; specify observable state and distinguish message retries from synchronous service retries.
- **Non-responsibilities:** actual BullMQ/outbox processing, Redis transport, general graph routing, numerical calibration alone, or claiming these rich queue behaviors already exist.
- **Areas/contracts:** current `MessageQueue` entries in resource/capacity constants and generic engine behavior as inspection targets; future queue-state/observable contracts need an explicit plan and owner before creation. No dedicated simulated messaging module exists today.
- **Invoke when:** an approved feature or scenario touches queue semantics or would otherwise require guessing what a queue teaches. Dormant for unrelated work; defining the role does not authorize building the model.
- **Collaborators:** S01 for tick/state, S02 for graph composition, S03 for rates/bounds, S06 for observations, L03, R01.
- **Independent reviewer:** Q03 for ordering/loss/duplicate/backpressure counterexamples; Q01 for guarantees and abstraction scope.
- **Research:** normally yes; use primary messaging documentation/literature and explicitly choose the educational delivery model.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** durable event-stream modeling and work-queue modeling become separate implemented teaching systems with different guarantees.

## Backend execution and local platform

### P01 — API Contract Engineer

- **Primary expertise:** HTTP commands, validation, and application service boundaries.
- **Responsibilities:** request/response shapes, Zod validation, route behavior, errors, control admission, and API-facing compatibility; coordinate transaction requirements with P02.
- **Non-responsibilities:** independent simulation rules, schema/migration policy, queue-delivery guarantees, or frontend command UX.
- **Areas/contracts:** `Backend/index.ts`, `Backend/routes/`, `Backend/zod_schemas/`, API middleware/errors; API portions of deployment/infrastructure shared contracts.
- **Invoke when:** commands, endpoints, validation, or errors change.
- **Collaborators:** P02, P03, P04, P05, F02, S02 for shared readiness rules.
- **Independent reviewer:** Q02; Q06 when inputs, authorization, or exposure change.
- **Research:** conditional for new framework/protocol/security behavior; verify the installed version's official documentation.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** real identity/authorization or multiple independently versioned API surfaces are approved and implemented.

### P02 — Persistence and Data Integrity Engineer

- **Primary expertise:** relational modeling, transactions, migrations, and durable data contracts.
- **Responsibilities:** Prisma schema/query behavior, atomic deployment/outbox writes, consistency constraints, checkpoint storage compatibility, migration effects on local data, and safe data evolution.
- **Non-responsibilities:** simulated database behavior, consumer retries, websocket ordering, or claiming stored checkpoints provide engine recovery.
- **Areas/contracts:** `Backend/prisma/schema.prisma`, new files in `Backend/prisma/migrations/`, `Backend/lib/prisma.ts`, persistence operations in routes/worker/host under writer leases. Generated Prisma output is generated, not manually edited.
- **Invoke when:** persisted fields, transactional boundaries, query semantics, or migration/data compatibility change.
- **Collaborators:** P01, P03, P05, P06.
- **Independent reviewer:** Q02 for migration/data-integrity cases; Q01 for consistency assumptions.
- **Research:** normally yes for transaction/isolation/migration semantics; conditional for routine query changes.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** schema evolution and query/storage performance become substantial independent workloads, or an additional storage engine is authorized.

### P03 — Job and Deployment Workflow Engineer

- **Primary expertise:** durable asynchronous work and deployment lifecycle coordination.
- **Responsibilities:** outbox polling/claim behavior, BullMQ dispatch/consumption, retries/idempotency, gate order and status transitions, and handoff to the simulation host.
- **Non-responsibilities:** SQL schema authority, websocket delivery, educational gate formulas, simulated message-queue behavior, or pure engine ticking.
- **Areas/contracts:** `Backend/worker.ts`, `Backend/infra/queue.ts`; `OutboxPayload`, `DeploymentJob`, deployment stage/status contracts; stage invocation, not domain algorithms.
- **Invoke when:** duplicate/lost jobs, retries, gate flow, or deployment lifecycle behavior changes.
- **Collaborators:** P02, P01, P05, P04, S04/S05 for gate outputs.
- **Independent reviewer:** Q02 exercises duplicate, failure, and retry cases; Q01 reviews claimed delivery guarantees.
- **Research:** normally yes for queue/outbox/concurrency changes; use actual BullMQ/Redis/PostgreSQL semantics.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** outbox delivery and deployment workflows each become complex sustained subsystems; separate event delivery from workflow orchestration.

### P04 — Realtime Transport Engineer

- **Primary expertise:** pub/sub and WebSocket transport lifecycles.
- **Responsibilities:** event envelopes/channels, subscriptions and cleanup, wire compatibility, disconnect behavior, and explicit delivery/ordering limitations; define resynchronization requirements with F02/P01.
- **Non-responsibilities:** telemetry meaning, durable job processing, authoritative simulation calculations, or frontend store rendering.
- **Areas/contracts:** `Backend/infra/pubsub.ts`, `Backend/ws-server.ts`; `shared/enum/Publish.enum.ts`, `WebSocketMessage.enum.ts`; Redis transport configuration in `Backend/infra/redis.ts` by assignment.
- **Invoke when:** event delivery, subscriptions, reconnect/resync protocols, or transport payload compatibility changes.
- **Collaborators:** P03, P05, P01, F02, S06, P06.
- **Independent reviewer:** Q02 for disconnect/malformed/duplicate delivery cases; Q06 for subscription exposure.
- **Research:** normally yes for delivery guarantees or protocol changes; conditional for narrow adapters.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** replayable event streams or large-scale fanout become authorized standalone systems.

### P05 — Simulation Host Engineer

- **Primary expertise:** running deterministic simulations inside an asynchronous backend process.
- **Responsibilities:** instance registry, start/stop/resurrection, persisted seed acquisition, control dispatch, speed/pause scheduling, snapshot batching, checkpoint IO, and integration of S05's cost rules.
- **Non-responsibilities:** changing engine equations/tick semantics, designing database schemas, defining telemetry units, or claiming complete recovery before it exists.
- **Areas/contracts:** `Backend/simulator/simulator.ts`; host/control integration with worker, API, storage, and publication. Pure `shared/simulation/` algorithms belong to S01-S05.
- **Invoke when:** host lifecycle, control timing, pause/speed, checkpoint execution, or engine-to-backend integration changes.
- **Collaborators:** S01, S05, S06, P01/P02/P03/P04.
- **Independent reviewer:** Q02 for real execution paths and Q03 for equivalence at matched simulated ticks.
- **Research:** conditional for scheduling, concurrency, recovery, or resource-lifetime changes.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** durable recovery or multi-process simulation scheduling is explicitly approved and becomes its own subsystem.

### P06 — Local Development Platform Engineer

- **Primary expertise:** reproducible local tooling and process environments.
- **Responsibilities:** local Docker readiness, launcher/process lifecycle, build/test prerequisites, supported tool configuration, and reproducible local integration setup.
- **Non-responsibilities:** provider simulation facts, production deployment, secrets outside the repository, application semantics, or routine dependency upgrades.
- **Areas/contracts:** `dev.ps1`, `Backend/docker-compose.yml`, `Backend/Dockerfile`, package/tool configuration when necessary; environment variable names/contracts only, never printed secret values.
- **Invoke when:** environment failures block reproducible implementation or validation, or a scoped tooling change is requested.
- **Collaborators:** P02, P03, P04, P05, Q02, Q04.
- **Independent reviewer:** Q02 reproduces setup and teardown behavior; Q06 reviews exposure changes.
- **Research:** conditional for tool/runtime/container compatibility or security changes.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** authorized CI engineering and deployment operations become distinct sustained needs; production remains separately gated.

## Frontend engineering

### F01 — Architecture Canvas Engineer

- **Primary expertise:** graph editing, spatial interaction, and local editor state.
- **Responsibilities:** resource placement/configuration, connections, viewport/drag/keyboard behavior, undo/redo, local draft persistence, and emitting intentional topology edits.
- **Non-responsibilities:** remote deployment state, authoritative graph rules, simulated health, backend saving policy, or shared visual-system policy.
- **Areas/contracts:** `Frontend/src/features/canvas/` editing components/store/utilities/hooks, including `useCanvasPersistence.ts`; `Resource` and `ConnectionLine` consumption. F02 owns the remote workflow hooks called out below, regardless of directory.
- **Invoke when:** building/editing architectures, resource configuration, gestures, selection, local draft recovery, or editor performance changes.
- **Collaborators:** F02, F04, L01, S02, S04.
- **Independent reviewer:** Q04; Q02 for affected save/deploy/live-edit transitions.
- **Research:** conditional for unfamiliar dnd-kit/browser/accessibility mechanisms.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** graph layout/routing algorithms and editor interaction/state each demand continuing separate expertise.

### F02 — Frontend Deployment Workflow Engineer

- **Primary expertise:** frontend remote-state lifecycle and command orchestration.
- **Responsibilities:** API clients, deployment submission/status, reconnect/reattach, explicit save/update and pre-run save, live topology sync, and cleanup of deployment subscriptions.
- **Non-responsibilities:** local graph editing mechanics, authentication/navigation/shell UI (F05), backend authorization, telemetry calculations, or dashboard chart design.
- **Areas/contracts:** `Frontend/src/api/`, `src/client/`, `src/features/deployment/`; canvas hooks `useInfrastructureActions.ts`, `useInfrastructureDropdown.ts`, `useLiveTopologySync.ts`; deployment reattachment behavior in the dashboard under a lease with F05.
- **Invoke when:** save/deploy/live/reattach transitions, API compatibility, or client transport lifecycle changes.
- **Collaborators:** F01, F03, F05, P01/P04/P05, L01.
- **Independent reviewer:** Q04 and Q02; Q06 for exposure changes.
- **Research:** conditional for React lifecycle, browser transport, or client/server compatibility.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** reusable client data synchronization and deployment-control UX become independently complex subsystems.

### F03 — Monitoring Visualization Engineer

- **Primary expertise:** faithful presentation of live simulation evidence.
- **Responsibilities:** monitoring store projection, metric/history charts, logs, live health/cost presentation, and control-panel feedback using authoritative snapshots and API commands; distinguish unavailable/stale values from observations.
- **Non-responsibilities:** inventing latency/errors/outcomes, defining metric formulas, changing server controls, owning socket reconnect, or designing teaching assessments.
- **Areas/contracts:** `Frontend/src/features/monitoring/`; evidence display and monitoring composition in canvas live components by explicit assignment; consumes S06 contracts.
- **Invoke when:** interpreting/rendering live state, chart/history behavior, cost display, or operational control feedback changes.
- **Collaborators:** S06, S05, F02, F04, L01/L02.
- **Independent reviewer:** Q04 for display behavior and Q03 for correspondence to engine facts.
- **Research:** conditional for unfamiliar visualization/statistical presentation or accessibility techniques.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** historical analysis/reports and real-time controls become distinct implemented products; do not assume the reports stub already provides them.

### F04 — Design System and Accessibility Engineer

- **Primary expertise:** reusable UI primitives and accessible interaction mechanics.
- **Responsibilities:** tokens, component variants, focus/keyboard semantics, contrast, reduced-motion behavior, and reusable styling primitives; implement L01's approved interaction language.
- **Non-responsibilities:** deciding learner journey, feature state machines, editing arbitrary domain components for visual cleanup, or certifying its own accessibility work.
- **Areas/contracts:** `Frontend/src/theme/`, `src/components/UI/`, `src/index.css`, common presentation primitives; feature adoption belongs to F01/F02/F03 unless assigned.
- **Invoke when:** a shared visual/interaction primitive changes or repeated accessibility defects need a common fix.
- **Collaborators:** L01, F01/F02/F03, Q04.
- **Independent reviewer:** Q04; L01 checks design intent but does not replace browser QA.
- **Research:** normally yes for new accessibility patterns using current standards and browser guidance; conditional for existing token changes.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** design-token/component infrastructure and assistive-technology engineering each become sustained specialties.

### F05 — Frontend Application Shell Engineer

- **Primary expertise:** application navigation, route composition, and browser-session UI.
- **Responsibilities:** app bootstrap, routes/guards, shell/navigation, browser-local session hydration/sign-in/sign-out, landing/dashboard page composition, and honest placeholder/error states. Delegate embedded deployment controls to F02 and shared primitives to F04.
- **Non-responsibilities:** implementing backend authentication/authorization, deployment state machines, canvas mechanics, telemetry, new marketing/product scope, or turning stubs into features without authorization.
- **Areas/contracts:** `Frontend/src/app/App.tsx`, `src/main.tsx`, `src/components/shell/`, `src/features/auth/`, `src/features/landing/`, and dashboard page composition; local `SessionUser` contract, not a real backend identity guarantee.
- **Invoke when:** navigation, page composition, route/session lifecycle, or public-to-application transitions change.
- **Collaborators:** F02/F04, L01, P01/Q06 for any future authorized identity boundary.
- **Independent reviewer:** Q04; Q06 for session/security claims.
- **Research:** conditional for routing, browser-session, or authentication mechanisms; source inspection always establishes current placeholder limitations.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** real identity/session integration or a substantial learner workspace shell merits dedicated frontend ownership.

## Product and learning

### L01 — Product UX Designer

- **Primary expertise:** learner interaction flows and information architecture.
- **Responsibilities:** map task flows, predict/build/run/break/improve affordances, empty/error/loading states, information hierarchy, and usable explanations; validate design assumptions against available user evidence.
- **Non-responsibilities:** feature implementation, setting simulation truth, owning curriculum/assessment, or inventing user-research findings.
- **Areas/contracts:** interaction specifications in the effort plan, with consumers in canvas/deployment/monitoring/shell UI; no exclusive application-code directory.
- **Invoke when:** a learner-facing workflow changes or usability blocks the learner journey.
- **Collaborators:** L02/L03, F01-F05, Q05.
- **Independent reviewer:** Q04 for interaction/accessibility risks and Q05 for learning-flow coherence.
- **Research:** normally yes for consequential unfamiliar UX choices; existing user evidence and focused usability work can answer local questions. Do not contact users without authorization.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** sustained discovery/usability research and interaction design each need dedicated ownership.

### L02 — Learning Experience Designer

- **Primary expertise:** learning objectives, scaffolding, misconceptions, and formative feedback.
- **Responsibilities:** specify what learners predict, observe, explain, and transfer; define rubrics and evidence-linked feedback; keep observations, interpretations, and unknowns separate.
- **Non-responsibilities:** creating numerical simulator truth, implementing scenarios/UI, technical source certification, or marking its own learning design effective.
- **Areas/contracts:** learning specifications and rubrics in the effort plan; future learning content contracts only after explicit design. No implemented curriculum directory was found.
- **Invoke when:** a feature teaches a concept, changes explanations/feedback, or adds an assessment goal.
- **Collaborators:** L01, L03, S02/S03/S06/S07/S08, R01.
- **Independent reviewer:** Q05; Q03 or the relevant uninvolved domain specialist checks technical claims.
- **Research:** normally yes for new pedagogy or misconceptions; prioritize original educational research and clearly label untested design hypotheses.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** curriculum sequencing, adaptive assessment, and explanation generation become independently substantial capabilities.

### L03 — Scenario Designer

- **Primary expertise:** controlled, reproducible learning experiments.
- **Responsibilities:** define starting architectures, workloads, seeds, ordered control/failure ticks, observation points, expected evidence bounds, improvement opportunities, and counterexamples aligned to L02's objectives.
- **Non-responsibilities:** tuning engine equations until a story passes, duplicating cost/capacity rules, claiming absent telemetry, or treating golden tests alone as educational validation.
- **Areas/contracts:** `shared/constants/SAMPLE_ARCHITECTURE.constants.ts`, scenario fixture proposals and test inputs in `Backend/tests/engine.golden.test.ts` by lease; consumes workload/tick/chaos contracts. There is no dedicated scenario module in the inspected inventory.
- **Invoke when:** a challenge, demonstration, failure exercise, or reproducible learning example is needed.
- **Collaborators:** L02, the relevant S01-S08 specialists, F01/F03.
- **Independent reviewer:** Q03 for reproducibility/causality and Q05 for pedagogical alignment.
- **Research:** normally yes for a new technical scenario; reuse verified briefs for variations within approved semantics.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** content authoring and automated scenario generation/search become distinct engineering workloads.

## Evidence research

### R01 — Technical Evidence Researcher

- **Primary expertise:** research methodology, source provenance, and evidence synthesis.
- **Responsibilities:** answer a bounded domain question; locate primary sources, check versions/dates/units/context, compare conflicting claims, and produce a cited evidence brief with applicability limits and unresolved issues.
- **Non-responsibilities:** universal domain authority, designing every subsystem, deciding formulas alone, implementing features, or converting literature into established product behavior.
- **Areas/contracts:** source/decision records in the effort plan; task-approved research artifacts if separately allowed. Consult relevant implementation; own no application files.
- **Invoke when:** a material unknown, disputed assumption, unfamiliar technology, or time-sensitive catalog fact blocks a sound decision.
- **Collaborators:** the requesting specialist and C01; S04/S05/S03 and P02/P03 commonly.
- **Independent reviewer:** an uninvolved specialist in the question's domain; Q01 checks architecture-level synthesis. Requesters who coauthored the conclusion cannot serve as the independent reviewer.
- **Research:** normally yes; this is the role's core deliverable. Report inaccessible evidence rather than filling gaps.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** a recurring evidence stream needs deep domain methods, such as performance experiments, cloud price verification, or learning-science synthesis; pair each with its domain owner rather than growing a universal researcher.

## Independent assurance

### Q01 — Systems Architecture Reviewer

- **Primary expertise:** system design, abstraction boundaries, and integration tradeoffs.
- **Responsibilities:** independently challenge ownership, contract evolution, causality assumptions, state authority, failure boundaries, and maintainability against the requested learner outcome; identify unsupported guarantees and scope growth.
- **Non-responsibilities:** replacing Lead Architect, authoring the implementation it approves, detailed domain calibration, or collecting every test result itself.
- **Areas/contracts:** cross-domain flows and plan/diff review; shared contract changes as review targets, with no blanket editing ownership.
- **Invoke when:** significant cross-domain design, new contracts/state authority, or a broad plan needs independent scrutiny before implementation and at completion.
- **Collaborators:** C01, Q02/Q03/Q06, affected specialists for evidence.
- **Independent reviewer:** a fresh Q01 instance for consequential disputed architecture findings; domain experts verify specialized premises.
- **Research:** normally yes for unfamiliar architectural guarantees; conditional when repository evidence resolves the issue.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** runtime architecture and data/contract evolution require sustained separate assurance streams.

### Q02 — Integration QA Engineer

- **Primary expertise:** observable behavior across process and persistence boundaries.
- **Responsibilities:** independently test API → database/outbox → worker → host → Redis/WebSocket → client paths; cover duplicate/retry/disconnect/restart/cleanup cases relevant to the change; check final acceptance evidence and delivery scope.
- **Non-responsibilities:** feature integration coding, numerical model approval, exhaustive browser usability, or accepting build success as integration proof.
- **Areas/contracts:** existing `Backend/tests/`; task-approved future integration fixtures/harnesses; local process/data outcomes. No established integration harness was found.
- **Invoke when:** a feature crosses boundaries, changes persistence/lifecycle, or approaches substantial-feature completion.
- **Collaborators:** P01-P06, F02, Q03/Q04, C01.
- **Independent reviewer:** Q01 reviews coverage/guarantees; a fresh Q02 reproduces material contested findings or newly authored harness behavior.
- **Research:** conditional for unfamiliar testing/fault-injection methods and platform guarantees.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** database durability testing and asynchronous protocol fault testing become separately extensive suites.

### Q03 — Simulation Red-Team Engineer

- **Primary expertise:** adversarial model validation and independent numerical reasoning.
- **Responsibilities:** find deterministic counterexamples, dimensional errors, invalid bounds, topology edge cases, timing/seed sensitivity, scaling/cost inconsistencies, and misleading causal claims; challenge golden expectation changes using independent reasoning.
- **Non-responsibilities:** calibrating the model it signs off, accepting author-supplied expected values without derivation, backend transport QA, or inventing unsupported realism requirements.
- **Areas/contracts:** `Backend/tests/engine.golden.test.ts` and approved focused regression files; simulation/shared contracts as review targets. Own adverse test design, not automatic edits to accepted goldens.
- **Invoke when:** simulation semantics, catalogs/costs, telemetry, or executable scenarios materially change.
- **Collaborators:** relevant S01-S08 specialists, P05, L03, Q02/Q05; each assignment is scoped to the changed model, not all simulation specialties at once.
- **Independent reviewer:** fresh Q03 for contested model findings or its own new test oracle; Q01 checks that required realism stays within scope.
- **Research:** normally yes for unfamiliar model assumptions; independently derive simple expected results even when sources exist.
- **Typical model/effort:** `gpt-6-astra`, high; xhigh for difficult causal/numerical counterexamples.
- **Split further when:** numerical validation, deterministic/replay testing, and distributed-failure testing each develop substantial specialized methods.

### Q04 — Browser and Accessibility QA Engineer

- **Primary expertise:** real browser behavior, interaction regressions, and accessibility evaluation.
- **Responsibilities:** independently exercise affected canvas/save/deploy/live-edit/monitoring flows, keyboard/focus behavior, viewport states, reconnect feedback, and displayed fact fidelity; record reproducible steps and evidence.
- **Non-responsibilities:** implementing the UI it approves, approving backend reliability from screenshots, or claiming a standards audit from a few manual checks.
- **Areas/contracts:** browser flows at `http://localhost:5173/`; task-approved future frontend/browser test files. Existing build/lint scripts are prerequisites, not browser proof.
- **Invoke when:** user-facing behavior, common UI primitives, or client lifecycle changes.
- **Collaborators:** F01-F05, L01, Q02, S06 for metric meaning.
- **Independent reviewer:** fresh Q04 for critical/contested browser findings; Q02 reviews flow/evidence completeness.
- **Research:** normally yes for new accessibility techniques/criteria; conditional for established regression flows.
- **Typical model/effort:** `gpt-6.1-sol`, high.
- **Split further when:** assistive-technology compatibility and interaction/performance automation each need dedicated test programs.

### Q05 — Learning Outcome Evaluator

- **Primary expertise:** independent assessment validity and instructional coherence.
- **Responsibilities:** challenge whether predictions, observations, explanations, and improvement steps demonstrate the intended concept; test alternative valid strategies and misleading feedback; distinguish expert inspection from actual learner-study evidence.
- **Non-responsibilities:** authoring the same curriculum/scenario it certifies, numerical engine sign-off, inventing user-study results, or judging success only by polished copy.
- **Areas/contracts:** L02 rubrics, L03 scenario briefs, evidence-linked explanations, and implemented learning flows; no current dedicated assessment directory.
- **Invoke when:** challenges, learning objectives, assessments, explanations, or the overall learner journey changes.
- **Collaborators:** L01/L02/L03, S06, Q03/Q04.
- **Independent reviewer:** fresh Q05 for disputed rubrics/evaluation claims; Q03 verifies technical counterexamples.
- **Research:** normally yes for novel assessment methods or claims of learning effectiveness; user studies need explicit authorization.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** empirical learning research and automated assessment-quality evaluation become distinct sustained programs.

### Q06 — Application Security Reviewer

- **Primary expertise:** application trust boundaries and adversarial input/security review.
- **Responsibilities:** independently review request/subscription exposure, identity/data-access assumptions, input handling, dependencies and local configuration changes when relevant; distinguish real application security from the simulator's educational SecurityScan rules.
- **Non-responsibilities:** production penetration testing, external secret access, feature hardening outside scope, owning cloud threat simulations, or treating browser-local authentication as production security.
- **Areas/contracts:** `Backend/routes/`, middleware/Zod schemas, `Backend/ws-server.ts`, frontend auth/session boundaries, and changed local configuration as review targets; security findings and regression requirements, not unrestricted code ownership.
- **Invoke when:** changed trust boundaries, authentication, resource exposure, external inputs, or a specific security review warrants it.
- **Collaborators:** P01/P02/P04/P06, F02/F05, S04 for educational security claims.
- **Independent reviewer:** fresh Q06 for critical/disputed findings; Q02 reproduces authorized local exploits/regressions.
- **Research:** normally yes for current advisory/framework/protocol claims; local scope and authorization remain mandatory.
- **Typical model/effort:** `gpt-6-astra`, high.
- **Split further when:** real identity/authorization, software-supply-chain assurance, or authorized infrastructure security becomes independently substantial work.

## Collaboration flow for substantial work

**Founder → Lead Architect → research if needed → domain specialists → integration → independent QA/review → Git Steward.** Early independent design review complements the final review; it does not replace it.

1. **Frame the outcome.** C01 inspects current source and Git state, translates the founder's goal into learner-visible acceptance criteria, and creates/reuses an ExecPlan following `.agent/PLANS.md`. Record scope, constraints, applicable invariants, decisions, dependencies, and exact validation requirements. Surface consequential product/architecture choices before dependent work; continue independent authorized milestones.
2. **Resolve unknowns.** Assign each open question to its domain specialist, with R01 for evidence work as needed. Deliver source/date/version, observed repository behavior, assumptions, chosen approximation, alternatives, uncertainty, and impact on acceptance criteria. Domain owners accept technical applicability; C01/founder resolve consequential tradeoffs. Q01 challenges significant architecture before implementation.
3. **Contract before consumers.** Agree producer/consumer fields, units, defaults, unavailable-value behavior, persistence implications, and compatibility. The semantic owner proposes; affected owners acknowledge; C01 records one editor and order. Each delegation names task ID, verified paths/symbols, exclusions, deliverable, prerequisite, acceptance tests, reviewer, and recommended model/effort.
4. **Implement within boundaries.** Invoke only relevant roles. Domain specialists add meaningful tests and report actual results. Parallelize research and disjoint edits; sequence shared files. Update the plan after discoveries and completed milestones. A plan is not permission for prohibited execution, Git operations, or production work.
5. **Integrate explicitly.** C01 designates one existing implementation specialist as the milestone's integration owner, usually the receiving boundary owner. This is a temporary duty, not a new generalist agent. It assembles agreed contract/adapter changes under the same leases, resolves compatibility with authors, and runs appropriate checks. It cannot approve its own independent QA or absorb unrelated domain work.
6. **Validate independently.** Q02 coordinates acceptance evidence; Q03, Q04, Q05, Q06, and Q01 are invoked according to the changed risks. Reviewers receive the goal, final diff, current plan, source, and test evidence, and derive their own challenges. They report blocking findings to C01/founder. Authors fix; affected reviewers verify fixes against the final diff. An agent that implemented the feature or coauthored its oracle cannot be its independent reviewer. Use a fresh instance when a listed reviewer contributed to implementation. Do not create an infinite chain of reviews of reviews: separately reproduce material findings or disputed/new oracles, then C01 adjudicates with the founder where needed.
7. **Close and hand off.** C01 compares each acceptance criterion to evidence, records remaining risks and exact untested behavior, and marks the plan complete only after required gates pass. Only then invoke existing Git Steward with explicit founder commit/push authorization. No merge into `main`, production operation, or external-secret access follows implicitly from this flow.

## Ownership protocol and the highest-risk overlaps

Maintain an ownership ledger in the effort plan: **task → semantic owner → exact files/symbols → current writer → consumers → dependency → reviewer → status/evidence**. C01 is the sole editor of that ledger/ExecPlan; agents submit updates. Ownership entries are coordination leases, not an automated locking system.

Before editing, check the current tree and acquire the relevant lease. One agent writes a file at a time, even if different agents own its concepts. For mixed files, either one assigned writer integrates reviewed proposals or writers take sequential turns. Separate worktrees can isolate changes but do not eliminate contract conflicts; integrate sequentially against the current baseline. Never discard another agent's/user's changes to resolve contention. A completed handoff records changed paths, assumptions, tests, and release of the lease. If a scope change touches another lease, pause that dependent edit and have C01 reassign it.

| Hotspot | Responsible boundaries and collision rule |
| --- | --- |
| `shared/simulation/engineTick.ts`, `SIMULATION_CONSTANTS.constants.ts`, shared golden suite | S01 owns sequencing/lifecycles; S02 graph behavior/causality; S07 data-service semantics; S08 approved messaging semantics; S03 numerical rules; Q03 independent expectations. Assign one writer for the file per milestone. Review formula changes with S03 and order/state changes with S01; never refactor just to match this org chart. |
| `Backend/simulator/simulator.ts` | P05 writes host integration. S01 specifies tick/state requirements, S05 cost integration, S06 observation contracts, P02 durable storage. These specialists propose/review their semantics; they do not simultaneously patch the host. |
| `shared/catalog/`, `cost.ts`, capacity constants | S04 edits catalog facts, including price inputs; S03 owns interpretation as capacity; S05 owns units/aggregation and generic estimates. A SKU change requires impact review across all three and Q03. The price value has one source. |
| Shared interfaces/enums | Ownership follows meaning: S01 engine state/tick inputs; S06 observable telemetry; P01 HTTP-facing commands; P03 jobs/status; P04 wire envelopes; S04 resource/SKU configuration. A composite type gets one nominated editor with field-level decisions from the relevant owners. There is no universal shared-types owner. |
| Deployment route + outbox schema + `worker.ts` | P01 owns request behavior, P02 transaction/storage consistency, P03 claim/retry/job lifecycle, P04 publication. Agree failure and duplicate behavior before editing; sequence changes and test the whole path with Q02. |
| Canvas store + `useInfrastructureActions.ts` + `useLiveTopologySync.ts` | F01 owns draft/editor state, F02 remote save/deploy/live wiring, P01 saved API semantics. F02 normally edits the two remote hooks; lease canvas store changes through F01. Q02/Q04 verify that live sync does not save layouts and pre-run deployment still saves. |
| `useDeploymentSocket.ts` + monitoring store + snapshots | F02 owns connection/reattach and subscription cleanup; P04 transport; F03 projection/rendering; S06 meaning/missing values. Agree payload semantics first. Existing fallback values must be inspected, not assumed to be observed facts. |
| Live canvas composition + shared components | F01 owns spatial layout, F03 live metric/control content, F02 deployment transitions, F04 shared primitives, L01 interaction specification. Nominate one composition-file writer; other roles supply bounded changes. |
| Application shell/session + dashboard deployment entry points | F05 owns route/session/page composition; F02 owns deployment data/actions and reattachment. A dashboard file still has one writer per milestone. Q04 checks the combined transition; Q06 checks session claims. |
| Learning claims and scenario/golden fixtures | L02 owns objective/rubric; L03 experiment; S02/S03/S07/S08 the relevant model; S06 evidence; Q03 technical validity; Q05 learning validity. No author changes the oracle to force the story to pass; discrepancies return to the relevant domain decision. |

## Validation gates

Use the exact task-appropriate checks required by `AGENTS.md`; reviewers add targeted adverse cases rather than indiscriminate test volume.

| Changed domain | Required evidence before completion |
| --- | --- |
| Simulation, topology, scaling, capacity, chaos, cost | Reproducible architecture/workload/seed/ordered-control ticks; meaningful focused and golden regression coverage; run `bun test` from `Backend/`. Q03 checks expected values independently and separates wall-clock metadata from outcomes. |
| Backend/shared types | Installed TypeScript compiler against `Backend/tsconfig.json`; verify its location and record the actual command. No tool installation/upgrades merely to pass. |
| API/data/worker/Redis/WebSocket/host boundaries | Q02 local integration evidence, including affected failure/duplicate/reconnect cases. `pwsh ./dev.ps1` applies migrations; respect execution limits and explain local data effects. A build alone is insufficient. |
| Frontend and shared consumers | `bun run build` and, for frontend changes, `bun run lint` from `Frontend/`; Q04 exercises affected browser flows at the documented localhost endpoint. |
| Learning/scenarios/research | Q03 verifies claims against recorded model behavior; Q05 checks objective, rubric, counterexamples, and explanation evidence; independent domain review checks primary sources. Expert review is not proof of real learner improvement. |
| Architecture/security | Q01 or Q06 reviews the relevant boundary changes and concrete risks; findings require evidence and a scope-appropriate disposition. |

Record exact commands/manual steps, results, final reviewed revision or diff, pre-existing failures, and unrun checks. Missing required evidence keeps the effort incomplete. When execution is restricted, report the permitted static result and remaining validation gap explicitly. Git Steward verifies this evidence; it does not generate missing implementation QA.

## Disposition of the existing Simulation Engineer skill

**Recommendation: eventually split/replace it with S01-S08; do not retain it as the normal implementation owner or convert it into a standing simulation manager now.** S08 activates only for approved messaging work. The current skill explicitly owns workload, topology/dependencies, request flow, latency/error behavior, capacity, scaling, chaos/recovery, cost inputs, telemetry, seeded scenarios, and golden tests. That combines deterministic runtime engineering, distributed-systems modeling, numerical calibration, provider/cost knowledge, and evidence design in one cognitive scope.

Preserve its valuable rules about reproducibility, current model limitations, integration validation, and honest telemetry in the appropriate narrower skills when creation is authorized. Map workload/calibration to S03, topology/failures to S02, lifecycle/RNG to S01, catalog facts to S04, billing semantics to S05, observation contracts to S06, data-service semantics to S07, and approved message-delivery semantics to S08. Move executable learning experiments to L03, independent challenge to Q03, and backend host mechanics to P05. Tests remain a responsibility of each implementing domain as well as independent QA.

Lead Architect already owns cross-domain coordination. Adding another permanent manager now would duplicate decision authority without resolving the shared-file problem. For a large simulation milestone, C01 can temporarily appoint a qualified specialist as integration owner with a bounded brief. Reconsider a dedicated simulation coordinator only if sustained parallel simulation programs exceed C01's capacity; such a role would coordinate contracts and evidence, not inherit all eight specialties.

Until a later authorized skill update, the existing Simulation Engineer file remains unchanged. Give any use of it an explicit narrow assignment and separate reviewer; do not claim that this document has changed its discovery behavior or instructions. When replacements are ready, a separate approved change should retire or narrow the broad skill so overlapping auto-selection does not persist.

The existing Lead Architect skill's five-domain delegation table also remains unchanged. A later authorized update should align its routing with this roster; this proposal does not silently rewrite that skill or change its operational authority.

## Creation order and founder decisions

Create skills in coherent batches when authorized; this ordering establishes quality gates early and does not reduce the recommended roster:

1. **First: Q03 Simulation Red-Team, Q02 Integration QA, Q04 Browser/Accessibility QA, and Q01 Systems Architecture Reviewer.** Establish independent challenge before delegating large implementation streams.
2. **Then: S01 Simulation Core, S02 Distributed Systems Behavior, S03 Performance/Capacity, S06 Telemetry Semantics, S07 Simulation Data Services, followed by S04 Cloud Catalog and S05 Cost.** Complete the active simulation split before expanding the broad existing skill; retire/narrow it only in a separately authorized change. Create S08 Simulated Messaging before the first approved feature that requires queue semantics.
3. **Learning in parallel with engineering preparation: L02 Learning Experience, L03 Scenario Design, Q05 Learning Outcome Evaluation, L01 Product UX, and R01 Technical Evidence Research.** Have these available before the next substantial learner feature; they are not a post-implementation copy pass. Pull R01 forward immediately if a factual research question blocks the first work.
4. **Next by the first accepted feature's dependencies: P01-P05 and F01-F05.** Preserve the defined API/data/jobs/transport/host and canvas/deployment/monitoring/design-system/shell splits instead of creating interim broad backend/frontend agents.
5. **P06 Local Platform and Q06 Application Security** before the first task requiring their expertise; move them earlier if setup or trust boundaries are already on that task's critical path.

No new skills are created by this document. Consequential future decisions for the founder: which learner outcome starts the next implementation effort; when to authorize the existing Simulation Engineer's replacement; and whether any proposed realism, recovery, identity, or cloud expansion is in product scope. Choosing this organization alone does not authorize those features. Model recommendations are task defaults to revisit with evidence, not mandatory spending or automatic configuration changes.

## Roster design record

This embedded record follows `.agent/PLANS.md` while honoring the instruction to create only `.agent/AGENT_ROSTER.md`.

### Goal / user-visible outcome

Deliver a repository-grounded specialist organization that makes deep ownership, collaboration, and independent review operational. Acceptance: every role has all requested fields; substantial-feature flow and collision rules are explicit; existing Simulation Engineer disposition, role count, overlap risks, and creation order are stated.

### Current understanding

Read the constitution, plan format, all three existing repository skills, source inventory, and relevant implementation/contracts. Initial working tree was clean on `agent/dev`. The current source couples several specialties within individual files; the roster separates expertise without requiring a refactor.

### Scope and non-goals

Only this roster file may be created. No skill edits, application changes, execution of the app, migrations, commits, or pushes. No separate plan file, given the explicit one-file constraint.

### Relevant architecture/files

The evidence table and role cards identify verified paths, callers, and contracts. Current skill references: `.agents/skills/lead-architect/SKILL.md`, `.agents/skills/simulation-engineer/SKILL.md`, `.agents/skills/git-steward/SKILL.md`.

### Invariants that must remain true

Apply `AGENTS.md` throughout. In particular, engine/backend facts remain authoritative, deterministic outcomes remain scoped to specified inputs/ticks, shared rules and catalog costs have one source, and live topology changes remain distinct from saved layouts. Organizational changes confer no production or Git authority.

### Implementation milestones

1. Inspect source/skills and establish boundaries: completed.
2. Draft hierarchy, complete role cards, ownership protocol, validation flow, and transition recommendation: completed.
3. Independently inspect the proposed roster and statically check fields, paths, counts, and changed-file scope: completed.

### Validation plan

Read the full document; verify required role fields and references against the repository; independently review ownership ambiguity and reviewer independence; inspect Git status and whitespace. No application tests are warranted for a documentation-only roster.

### Progress log

- 2026-09-30 (Asia/Calcutta): inspected repository and existing skills; obtained a read-only simulation-boundary assessment; drafted 26 specialists plus two existing coordination/delivery roles.
- 2026-09-30 (Asia/Calcutta): independent review identified broad data-service/messaging ownership in S02 and shell/session ownership in F02. Added S07, S08, and F05, narrowed the original roles, and updated collision rules and transition notes. Re-review passed with no remaining blocker; incorporated its two minor reference/ownership clarifications.
- 2026-09-30 (Asia/Calcutta): Python static checks passed for 31 unique cards (29 specialists), every requested field, defined role IDs, literal repository references, and trailing whitespace. The explicitly future `.agent/plans/` location is the only absent literal directory reference. An initial ad hoc path-check command had a PowerShell quoting error; the corrected check passed. `git status --short --untracked-files=all` showed only this new file; `git diff --name-only` and `git diff --cached --name-only` were empty. All three existing skills remain unchanged.
- Next action: founder can select the next learner goal and authorize skill creation/alignment in a separate task. No further implementation is part of this roster request.

### Discoveries and decisions

Mixed files need writer leases, not forced source reorganization. Separate telemetry semantics from metric rendering and wire delivery. Separate the actual backend's databases/queues from simulated database/queue behavior. Prefer replacement of the broad Simulation Engineer over an additional permanent management layer.

### Risks / blockers

The roster is a proposal; most skills and several test harnesses do not yet exist. Model availability and provider documentation evolve. No application behavior or actual learner effectiveness is validated by this design exercise.

### Final verification and outcome

Delivered all requested role fields, hierarchy, collaboration/research/validation flow, ownership protocol, overlap risks, model recommendations, skill-creation order, and Simulation Engineer disposition. Independent review and corrected static checks passed. Changed file: `.agent/AGENT_ROSTER.md` only. Application/browser tests and runtime execution were not run because no application behavior changed; actual role effectiveness and future harnesses remain unvalidated. No skills, application code, commits, or pushes were created or modified.
