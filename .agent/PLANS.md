# InfraForge ExecPlans

An ExecPlan is a living implementation plan for substantial work. It must let a fresh agent continue using only the plan and the repository, with no previous chat context. Root `AGENTS.md` remains the authority for repository rules; record task-specific constraints here instead of copying the constitution.

## Using a plan

Create one Markdown file per effort at `.agent/plans/<short-task-name>.md`, unless the user specifies another location. Reuse the existing plan when continuing that effort. This file defines the format; it is not the task plan.

Read the relevant implementation before drafting. Include the user's requirements and execution restrictions, verified repository-relative paths, and enough context to explain the proposed behavior. Distinguish observed facts from assumptions. Keep prose concise; expand only where a decision or procedure needs explanation.

Update the plan after meaningful progress, discoveries, decisions, and validation, and before a pause or handoff. Revise affected sections so the current approach is clear; retain brief dated notes explaining changes. Always identify completed work, remaining work, and the next concrete action. Continue through authorized milestones without requiring routine approval of each step; surface consequential unresolved choices.

On resuming, read `AGENTS.md` and the plan, inspect Git status and the relevant source, and reconcile the recorded state with the working tree before continuing. A plan does not authorize actions prohibited by the user or repository rules.

## Required format

Use the following headings in each plan. Fill them with task-specific content; use "None currently" or "Not yet run" when appropriate instead of omitting a section. Include a title, status (planned, in progress, blocked, or complete), and last-updated date with timezone.

### Goal / user-visible outcome

Explain what the learner will be able to do or observe, why it matters, and concrete acceptance criteria. Connect to the affected part of InfraForge's learner journey. For internal refactors, describe the measurable engineering outcome and user behavior that must be preserved.

### Current understanding

Describe existing behavior, evidence from source or tests, and the gap to close. Capture relevant user instructions and assumptions requiring confirmation. Do not depend on phrases such as "as discussed above" or on inaccessible chat history.

### Scope and non-goals

State what this effort includes, explicitly excludes, and any limits on execution or changes. Keep later discoveries within that boundary unless the user changes it.

### Relevant architecture/files

Identify the actual entry points, symbols, callers, contracts, and tests involved, with paths and brief roles. Explain the affected flow across `Frontend/`, `Backend/`, and `shared/` where applicable; do not reproduce a full repository map.

### Invariants that must remain true

Select the relevant invariants from `AGENTS.md` and explain how this change preserves them. For example, identify the authoritative simulation result, deterministic inputs, shared domain rule, catalog cost source, or separation between live topology and saved layouts that the work touches.

### Implementation milestones

Order small milestones by dependency. For each, describe the resulting behavior or capability, the implementation approach, and observable evidence of completion. File edits alone are not a milestone outcome. Identify any investigation needed to resolve uncertainty before dependent work.

### Validation plan

Map acceptance criteria and milestones to appropriate checks from `AGENTS.md`. Specify working directories, exact commands or manual steps, prerequisites, and expected results. Include relevant simulation regression coverage, integration paths, and browser flows when affected. For reproducibility, record architecture, workload/scenario, seed, and control ticks when relevant. Honor execution restrictions and state the validation gap if only static inspection is allowed.

### Progress log

Use dated entries or checkboxes for completed, in-progress, and remaining milestones. Record actual validation commands/steps and results with concise evidence, distinguishing failures, pre-existing failures, and checks not run. End with the next concrete action and any state needed to resume safely.

### Discoveries and decisions

Record each material finding or decision, its evidence or rationale, and its effect on the approach. Note rejected alternatives only when they explain a tradeoff or prevent repeated investigation. Update earlier sections when a decision changes them.

### Risks / blockers

List unresolved risks, unknowns, blockers, and decisions needing user direction. State their impact and the next mitigation or unblocking step. Do not treat missing validation as a passing result.

### Final verification and outcome

Compare delivered behavior with the acceptance criteria. Summarize changed files, final checks and results, remaining risks, and untested behavior. Inspect the final diff for scope. Mark the plan complete only when the agreed outcome and required validation are satisfied; otherwise explain exactly what remains.
