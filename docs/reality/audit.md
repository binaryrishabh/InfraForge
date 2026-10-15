# Model-1 reality audit

Audited baseline: `361a3b1afe33740d8f45d9c79601c6476657d602`, 2026-10-15.
This is a diagnosis of published historical behavior, not permission to change it.

## Coverage and reproducibility

`model1-ledger.json` inventories **384 production TypeScript files and 2,121 numeric
literal sites** across simulation, domain, catalog, contracts, backend and frontend.
Zero-literal files are included with source digests. Every site has a stable baseline
id, exact literal, containing expression, units (or explicitly nonphysical code-number),
scope, model, classification, implementation provenance, confidence, assumptions,
research date, Free Mode policy and replacement. `scripts/reality/scan.ts` uses the
TypeScript AST, not a search limited to `tuning.ts`. Source digests normalize CRLF;
Git and existing pinned-hash/golden checks protect published content separately.

`bun run check:reality` compares the entire inventory to current production source.
`bun --no-env-file scripts/reality/inventory.ts --write` is a deliberate authoring
operation after reviewing changed source. Stable ids describe the frozen baseline
literal order; do not reuse them for a different historical expression.

Most sites are counters, indices, rounding, viewport coordinates, HTTP statuses,
timeouts or guardrails, not physical assumptions. They are kept so omissions are
visible. Classification rules are conservative: a code citation verifies what the
implementation does, never cloud accuracy. **No historical performance proxy is
approved as reality-based Free Mode physics.** Nonphysical bookkeeping/UI/guard values
are conditional on that explicit purpose. Client missing-snapshot numeric defaults
are placeholders, not measured zeroes. This does not disable the accepted Model-1
product. Confidence in an implementation policy means confidence
about its code meaning, not external model validity. A calibrated challenge means
calibrated starter/reference outcomes, not calibrated application performance.

Excluded from numeric-site extraction: generated Prisma/client files, dependencies,
test/golden fixtures (verification, not runtime inputs), migrations/SQL (historical
schema guards), operational shell/release tooling, lockfiles, CSS and static media.
These were inspected for model coupling: migrations persist Model-1 inputs/evidence;
the worker/WS/wall scheduler carries results, not alternative physics; release scripts
do not define cloud capacity. SQL evidence guards mirror the bounded contracts.
Numeric prose/log strings are reviewed semantically below, not treated as arithmetic.
User-saved/database values are inputs rather than source literals. Neither secrets nor
hosted systems were read. Model-2 files and the audit tooling are deliberately separate.

## Assumption families and actual formulas

| Source / concept | Model-1 behavior | Reality assessment and replacement |
| --- | --- | --- |
| `simulation/capacity.ts` | DNS 5,000; CDN 20,000; firewall 15,000; LB 10,000; VM 160; registry 1,000; cache 8,000; DB 250; object 2,000; queue 5,000; monitor 10,000 RPS | Educational fallbacks, no workload or service identity. M2 needs resource-specific capability and application demand. |
| `simulation/tuning.ts` throughput | VM capacity = vCPU × baseline factor × 80; DB = vCPU × factor × 125 | Universal RPS/QPS per vCPU has no external support. No query cost, scheduler, credit state or I/O. |
| VM metrics | CPU = inbound/capacity ×100 ×(1 + writeFraction×0.3); memory =25+CPU×0.5; connections=ceil(RPS/10) | Fixed application tax/memory/connection proxies; not allocations, concurrency or a pool. |
| DB metrics | RPS recomputed from global total, read×(1−hit)+write×2; connections=all reachable/active noncrashed VMs×20; over limit forces CPU≥95; memory=30+CPU×0.4 | Path-routed DB traffic and reported DB demand can diverge; global VM counts create nonlocal coupling. No query/connection lifecycle, locks, buffer cache or I/O. |
| Cache | Hit ratio 0.8 unless previous health Failed; CPU=global RPS/8,000; memory=35+load×25+writeFraction×10 | No keys, TTL, eviction, cacheability, cold/warm state or working set. |
| Other resource metrics | CPU=inbound/fallback capacity×100; memory=20+CPU×0.3; monitor fixed 12/18; idle resources 2/8 | Generic utilization or decorative values, not modeled device/service measurements. Registry/monitor deployment traffic is not distinguished from serving traffic. |
| Workload | Default 1,000,000/hour, 80% reads, medium payload; light/medium/heavy=10/100/1024 kB labels; peak default 3× | Explicit presets, not telemetry. Payload labels are not a distribution or per-request response size. |
| Load/time | One second/tick; 60-second upward ramp, downward ramp twice as fast; load target≤2 and effective load≤3; burst every120s, duration20s, ramp5s | Authored experiment dynamics and caps, not measured user behavior. Speeds0/1/10/60 change playback batching only. |
| Routing/topology | DNS or root edge types inject traffic; equal entry shares, DAG-like traversal, equal LB split, cache miss/write and DB write forwarding; pools re-split across active workers | No DNS resolution TTL, L7 policy, response path, connection affinity, reachability/latency or request outcome. Cycles are not a general work-flow solver. Spawned pool serving and downstream calculations use different mechanisms. |
| Cascades | Previous-tick downstream Failed adds0.5 stress, Saturated0.2; cap1; stressed upstream adds0.25 retry boost, cap0.75 | No actual retries, attempts, deadlines or extra work units. CPU multipliers can imply effects without conserved work. |
| Health | CPU≥70 Degraded, ≥90 Saturated; memory≥97 Saturated; crash/restart Failed; overall worst health | Common thresholds do not identify resource-specific symptoms or external availability. Initial Healthy is initialization, not a measurement. |
| RNG/precision | Mulberry32(seed×100003+second); one traversal stream, two draws/resource; ±3% jitter; values rounded0.1 | Ordering/addition changes unrelated draws. Jitter has no empirical distribution. Wall timestamps are presentation and excluded from deterministic payload comparisons. |
| Network | CPU is raised to payload×RPS/bandwidth percent; fallback VM/LB/CDN/object capacities125k/250k/1m/500k kB/s; 125,000 kB/s per Gbps conversion | Conversion is dimensional; effective link capacity/traffic/latency/retransmission are absent. Provider “up to” cannot become sustained capacity. |
| Faults | Crash30s; CPU spike20s/+45points; memory leak40s/+2.5points elapsed; network25s/×1.6CPU; disk35s/CPU100 before jitter | Same transform across resource kinds. No persistent leak, packet queue, disk state, data damage or restart guarantee. |
| Fault end | Tick at injection measured first; next tick first effect; final duration tick measures then removes fault | Existing exact action/evidence semantics, preserved. Removal permits later evolution, never proves recovery. |
| Scaling | Hot5ticks/cold30; CPU target default75, cold30; provision60/drain15; default max=min(base×3,8), placed base protected; vertical restart20 | No scheduling/image pulls/readiness, metric lag, cooldown, capacity shortage or failure domains. Pending capacity is not serving capacity. Spawn gap192 is layout only. |
| Catalog | 32 SKU rows with vCPU, GB labels, baseline, network, approximate price and DB connection limits | Fields need independent verification. Network values omit baseline/burst/direction/path restrictions; DB limits omit engine/config/reserved slots. Prices lack effective dates and billing dimensions. |
| Known stale baseline fields | EC2 t3.medium and t3.large store0.40/0.60; db.t3.medium stores0.40 | EC2 documentation gives20%/30% per vCPU for the EC2 types. Only those two EC2 fields are marked obsolete; the RDS field remains independently unverified. Preserve all historical fields; prohibit reuse as provider truth. |
| Cost | Generic monthly USD3/10/10/20/15/15/25/40/30/5/8 by type; fallback10; SKU monthly sum/730 hourly; integrate/3600 per tick | Labelled estimates. No region, billing minimum, request/storage/transfer charges, discounts, provisioned-vs-active distinction or unknown components. DigitalOcean's current bundled-plan cap differs from730. |
| Security/readiness | Public DB, public SSH22 and missing encryption warnings; fixed permitted edges/default ports; path/readiness checks | Static educational policies, not packet enforcement, IAM, TLS correctness or security assurance. |
| Actions/defaults/examples | ±1 replica, request-size/resource/edge caps, UI load0–200%, presets, diagram positions and ports | User choices and implementation guards; classify separately from infrastructure limits. Designer1100px and chart geometry are not model capacity. |
| Challenges | Ten immutable fixed workloads/seeds/designs/criteria; budget/count/CPU thresholds, timing, observation1–60s | Scenario authoring calibrated against Model1. No challenge-only physics. No migration/recalibration in M2A. |
| Evidence/Compare | Max121 points,30s baseline,128resources,64KiB sample, bounded action records; selected checkpoints/peaks/deltas | Retention/payload policies, not continuous telemetry. Missing points/subjects remain unknown. Compare preserves input/model/catalog compatibility and cannot prove causality. |
| Logs | OOM, queue depth, 502/504, eviction, timeout, disk detachment and DB recovery voices can follow health alone | These are unmodeled interpretations, not measured incidents. Existing presentation narrows some recovery language. M2 emits only events/counters its mechanisms calculate; do not port these voices. |

## Architectural limits proven by the code

The problem is missing state/semantics, not just wrong coefficients. RPS has no
identity or response, so there can be no conserved completion/failure/timeout count.
No queued work means backlog cannot persist after load/fault removal. Global read mix
and VM counting lose path-specific work. A single resource switch plus neighbour
health multipliers makes new behavior depend on pairwise exceptions. Wall-timed
logging and traversal RNG are separate reproducibility concerns. Provider capability,
application demand and billing are conflated. Region, size and resource fields can
exist without affecting the engine: presence in a design does not prove implementation.

These choices are valid bounded teaching approximations for the accepted model.
They prevent claims of mechanism-based Free Mode, latency, failures or real cost.
Keep their old evidence readable and run all existing goldens; build M2 alongside.
