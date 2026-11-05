# Learning content

This folder supplies static learning content, not a simulator, judge or attempt store.
The learner registry exposes only `available` tracks, modules and lessons. Prerequisites
are advice: a caller can open a later lesson without completing earlier ones.

## Authoring

- Register a track in `content/index.ts`. Each `content/<trackId>/index.ts` exports
  `track` and `lessons`; `track.ts` lists modules and their ordered lesson ids.
  Keep one lesson per file under `lessons/`. Track order and module order define the path.
- Use globally unique lesson ids and module ids unique within their track. Every current
  lesson belongs to exactly one module, with matching `trackId` and `moduleId`.
- Use `reading` for explanation and `conceptual-exercise` for a question about ideas.
  Both have `experiment: null`. A conceptual exercise must have a check with at least
  two distinct choices, an existing correct choice id and an explanation.
- Use `executable-lab` only to wrap an existing challenge. Set `experiment.challengeId`;
  the registry's latest version must exist. Supply a prediction prompt or use that
  challenge's predictions. Read its current definition, debrief and model limitations
  first. Launch and evaluate through the existing challenge system; never add a judge here.
- Every lesson needs limitations. Non-executable text must not claim simulated outcomes.
  The small phrase blocklist is an editorial guard, not automated proof that text is true.
  Authors must review claims outside the blocklist too. Labs may discuss outcomes only
  when actual recorded evidence supports them, under its stated conditions.
- Keep titles to 80 characters, summaries to 240, and individual paragraphs to 600.
  Problem: 1-2 paragraphs; explanation: 2-4; limitations: 1-4. Checks: 2-6 choices.
  `CONTENT_LIMITS` and the schema in `validate.ts` define the remaining bounds.
- Prerequisites must exist and have no cycles. A beginner lesson cannot require an
  advanced lesson. Finer level judgments remain editorial; levels do not lock access.
- `draft` content can be authored and validated but never returned to learners. A draft
  parent hides its children, and visible module lists omit draft lesson ids.

## Published versions

A published lesson's `id + contentVersion` is immutable, including spelling and punctuation.
Never reword a published contentVersion. New text requires a higher contentVersion.
Keep the previous lesson object in its own version file and register it in
`learningContent.archivedLessons`; the current version remains in `lessons`. Old versions
stay resolvable through `findLearningLesson(id, contentVersion)`. Preserve their track and
module identity and keep previous version files packaged. Do not remove a published lesson
or its parents. Archived lessons cannot be drafts or equal/newer than the current version.

The foundations v1 text is pinned by hashes in `learningContent.test.ts`. Retain old pins
and add new ones when publishing another version; never replace a pin to permit rewording.
The validator checks structure and references; it cannot infer prior publications from
an isolated input or enforce history by itself.

`findLesson(id)` returns the current available version; an explicit version lookup can
resolve an archived available version. Listing is current-only and supports track,
module and challenge filters. Results are detached copies so callers cannot mutate the
registry. No request-time randomness, clock, environment, database or progress is used.

## Foundations

Track 1 contains ten original beginner lessons across requests/routing, compute/data and
load/limits. All are reading or conceptual exercises. DNS lookup is distinct from the
application request path. There are no claimed runs, capacity measurements or completion
scores. The `first-runs` module is intentionally reserved for Lane B's runnable lessons.

## Checks

```text
bun --no-env-file test apps/backend/tests/learningContent.test.ts scripts/tests/dockerfile-folders.test.ts
bun --no-env-file scripts/check-boundaries.ts
```

When adding files, keep `apps/backend/Dockerfile` and `.dockerignore` in sync. The packaging
test checks every learning TypeScript file, including nested content and future version files.
