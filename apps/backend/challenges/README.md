# Authoring challenges

Challenges are source-controlled. There is no admin interface and no database-authored rule.

## Identity and versions

A challenge attempt is judged by `challengeId + challengeVersion + specHash`. The spec hash covers
every authored field, so an attempt always records the exact rules it ran under.

- Each version lives in `definitions/<id>/v<n>.ts` and is registered in `definitions/index.ts`.
- **A published version never changes and is never removed.** Old attempts are judged by it forever.
- To change anything, add `v<n+1>.ts`, register it and pin its hash in
  `tests/challengeAuthoring.test.ts`. The list shows the latest version; old reports keep theirs.
- Versions run 1, 2, 3… without gaps. Seeds are per version (`challenge:<id>:v<n>`).

A new version is required for any change to: workload, evaluation second, criteria, prediction
questions, the starter, the experiment, hints, debrief, story, objective, title or summary. Spelling
and punctuation are included: a published version is byte-for-byte immutable, so a typo fix waits
for the next material change or ships as its own version. This keeps "the rules this attempt saw"
exact without a separate notion of cosmetic edits.

Shared helpers used by published versions (`starter.ts`, `definitions/modelNote.ts`) must not change
behaviour; the pinned hashes fail if they do.

## Workspaces

A workspace design belongs to one challenge version. Opening a newer version never reuses an earlier
workspace silently: the learner starts from the new starter, or explicitly copies the earlier design.
Attempts always run the latest version, from a workspace of that version.

## Resilience challenges

An optional `experiment` makes a resilience challenge: one fault InfraForge applies itself.

- `fault`: a model-1 fault (`crash`, `cpu-spike`, `memory-leak`, `network-delay`, `disk-failure`).
  Read its engine semantics before writing about it.
- `target`: a named starter resource and its type. The learner must keep it, in the serving path
  (and for an app server, behind a load balancer that manages a pool). Nothing is substituted.
- `atSimulatedSecond`: no earlier than the end of the 60-second ramp.
- `evaluationSeconds` must be the fault's last active second (`at + model duration`), so the fault's
  durable action closes with "fault ended" before the terminal capture.
- Only ask predictions the retained evidence proves: `baseline-health` (recorded when the fault is
  applied), `survivor-health`, `database-health`, `busiest-type`, `scale-out`. Overall health during
  a crash is always critical in this model, so do not ask it.

## Check

```
bun run check:challenges
```

It validates every version (structure, bounded text, unique ids, contiguous versions, unchanged
published hashes, valid starter graph, experiment target and timing), runs every latest version
against the real engine (the starter fails, a hidden reference passes) and confirms the hidden
reference designs, which live only in `tests/challengeHarness.ts`, are not imported by runtime code
or packaged.
