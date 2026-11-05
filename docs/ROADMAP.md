# InfraForge roadmap and idea queue

_Last reviewed: 3 November 2026._

The **[master Idea Bank (issue #25)](https://github.com/binaryrishabh/InfraForge/issues/25)** is the permanent index of ideas collected from owner discussions. Each entry has a stable ID, current state and a link to the detailed issue.

**Important:** Recording an idea does not approve implementation or a release. Before taking work, check the latest GitHub `main`, the current active Claude/Codex worker, and the matching issue. An older chat or issue may not reflect current shipped work.

## Where to find ideas

| Area | Detailed queue | State |
|---|---|---|
| Living Free World: edit nodes, connections and settings mid-run; real outages and recovery | [#15](https://github.com/binaryrishabh/InfraForge/issues/15) | Post-launch, parked |
| Long-lived Free World: disconnection, automatic pause, resume, multi-device ownership | [#16](https://github.com/binaryrishabh/InfraForge/issues/16) | Post-launch, design required |
| Incremental backend verification and rolling report evidence; fairness for 100s of users | [#17](https://github.com/binaryrishabh/InfraForge/issues/17) | Post-launch, design required |
| Honest real depth of all 11 resources, DNS/Registry/VM memory gaps, hidden mechanisms | [#18](https://github.com/binaryrishabh/InfraForge/issues/18) | Mixed: audit before selecting |
| Controlled workload experiments, real learner outcomes and comparisons | [#19](https://github.com/binaryrishabh/InfraForge/issues/19) | Proposed / partly shipped |
| Original UX/visual ambition with evidence-grounded motion and proper accessibility | [#20](https://github.com/binaryrishabh/InfraForge/issues/20) | Parked; old [#7](https://github.com/binaryrishabh/InfraForge/issues/7) is closed as not planned |
| Pre-launch actual browser journey, truthful run controls and abandonment honesty | [#21](https://github.com/binaryrishabh/InfraForge/issues/21) | Launch-triage only |
| Host hang, GHCR cleanup, worker/runtime safety and release reliability | [#22](https://github.com/binaryrishabh/InfraForge/issues/22) | Audit / as needed |
| Original marketing videos/X posts and competitor product research | [#23](https://github.com/binaryrishabh/InfraForge/issues/23) | Parked |
| Idea intake, long useful Claude/Codex jobs, proof and safe delivery rules | [#24](https://github.com/binaryrishabh/InfraForge/issues/24) | Operating principles |
| Beginner learning path, labs, scenarios, guided progress | [#2](https://github.com/binaryrishabh/InfraForge/issues/2) | Previously recorded; details are older, verify shipping status |

## Definition of statuses

- **Captured / Proposed:** An idea is recorded; not authorized to start.
- **Research / Audit:** Need evidence, design, feasibility, or shipped-state check before work.
- **Parked:** Valuable later, but not within the current launch scope.
- **Launch-triage:** Fix a verified blocker in the supported launch journey; no speculative subsystem work.
- **Approved / Building:** Explicit current authorization and one named coding owner.
- **Released:** Exact-SHA CI, successful release and real verification have been established. Link the evidence.
- **Historical limit:** Intentionally unavailable or Unknown for old captures; preserve it unless explicitly reviewed.

## Important current facts

At creation, the latest independently verified released `main` was `fb43250a3a187769066e40c92ded61246d25fc61` with [successful validation](https://github.com/binaryrishabh/InfraForge/actions/runs/41561854337) and [successful release](https://github.com/binaryrishabh/InfraForge/actions/runs/41563530738).

Traffic Reality, Traffic Recovery, Latency Explanation, Traffic Objectives, authored VM modeled-memory allocation refusal, Client Attempt Timeouts, Report Traffic Outcomes and Whole-run Latency all shipped in the 2–3 November sequence. See the [release ledger in #25](https://github.com/binaryrishabh/InfraForge/issues/25) for the eight exact commit/run links. Database HA v2 also shipped earlier.

**Do not assume the future Free World exists.** Current browser runs have finite horizons, a finite action cap and no durable live resume. The proposed multi-day, editable, reconnectable design is on #15–#17.

The historical [learning backlog #2](https://github.com/binaryrishabh/InfraForge/issues/2) contains old Model-1/Model-2 availability wording; current `docs/PROJECT_STATE.md`, code and verified releases supersede that wording.

## Process for every new owner idea

1. Find the matching section in [#25](https://github.com/binaryrishabh/InfraForge/issues/25).
2. Record the user's actual scenario, intent, acceptance example and source date in the relevant issue, and add a new stable idea ID when it is genuinely new.
3. Mark what is known and what is Unknown. Cross-link duplicates instead of losing or rebuilding them.
4. Separate priority from authorization. Only an explicit scoped instruction can move an idea to Approved/Building.
5. When built, attach commit, proof, exact-SHA validation, release, and final verified behavior. Keep historical limits explicit.
6. Periodically reconcile this roadmap with the master index, active workers and newly surfaced older chats.

_This queue is a good-faith reconstruction of ideas visible in available project conversation context and the repository; it is not a claim to have full access to every older chat._
