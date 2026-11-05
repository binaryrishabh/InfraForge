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

## Learner progress and API

`GET /api/learning` returns visible tracks/modules, current lesson metadata, lab-only
`progress`, and `suggestions` (`nextLesson`, `continue`, `reviewCandidates`).
`GET /api/learning/lessons/:id` returns the latest full lesson, its lab progress (otherwise
`null`), and its linked challenge summary (otherwise `null`). Unknown ids and drafts,
including content under draft parents, return 404. Both routes use the same session guard
as challenges. Client-supplied owner/version query parameters do not select another owner
or an archived lesson. Prerequisites remain advice, never access controls.

`attempts.ts` queries existing Deployments by authenticated owner and visible challenge ids,
using challenge history's `reportSelection` with comparison's full action projection and
durable action count. It reads all matching attempts: a recent-history limit must not erase
a previous requirements-met result. There is no new table, migration, saved score or attempt
store. `progress.ts` filters ownership again before evaluating any row. Published challenges,
hashes, goldens and lesson text are unchanged.

Progress is a pure derivation through `learningAttempt` (the existing report/evaluator):

- `not-started`: no saved attempt. `attempted`: at least one saved attempt, with no proven
  improvement or current-version requirements-met result. Active, missing and unavailable
  evidence counts as activity, never as requirements met.
- `requirements-met`: some evaluated attempt met the **current** challenge version. The
  evaluator checks that attempt's recorded version, hash and evidence; no old run is
  reinterpreted under new rules. `fromEarlierVersion` records any older-version activity;
  `earlierVersionRequirementsMet` preserves earlier met results for review suggestions.
- `improved-after-attempt`: an evaluated attempt explicitly recorded as an improvement of
  its earlier, same-owner source met more raw requirements, with equal requirement totals,
  under `classifyComparison`'s same challenge conditions. This is a within-version recorded
  difference, not a mastery score, causal conclusion or general ranking. Meeting the current
  requirements takes precedence. `improvement` identifies the source and later run.
- `predictionReviewed` means a prediction was recorded (with its submission time), and that
  attempt was judged met/not-met. It says nothing about prediction correctness or whether a
  person opened a review. `sameConditionsComparison` means an inactive pair exists which the
  existing classifier calls same challenge conditions; it does not assert someone viewed
  Compare, that outcomes are known, or that all causal-comparison checks pass.
- `lastRunId`/`lastAttemptAt` identify the most recently started attempt (created time, then
  id). `lastActivityAt` is the latest saved update across attempts, not a measurement time.

The pure selector exported by `@infraforge/contracts/learning` follows track/module/lesson order, skips current requirements-met labs
and device-marked readings, and advises lessons whose prerequisites were at least attempted
or marked read. Continue uses the most recent real attempt's lesson if it is not met,
otherwise next. Review includes attempted/unmet labs and earlier met versions needing a
current attempt. Every suggestion explains these facts; there is no elapsed-time decay.

The server has no reading/conceptual completion evidence and accepts no reading marks.
Consequently its suggestions start at the first unread prerequisite when none can be known.
A later web caller can supply device-local marks to `selectLearningSuggestions`; those marks
never enter server progress. Foundations currently contains only reading/conceptual content,
so the production catalog legitimately has an empty progress list until lab content is registered.
The focused tests inject validated test-only labs linked to real published challenges.

```text
bun --no-env-file test apps/backend/tests/learningProgress.test.ts apps/backend/tests/learningRoutes.test.ts
```

The HTTP test uses real engine-produced attempt rows, the production reader/query shape,
report evaluator, comparison classifier, router and session middleware. Its session lookup
and database are stand-ins isolated in a child process; it does not establish real database
persistence or Better Auth cookie validation. The optional integration test uses an already
prepared disposable API/worker and real sessions, without applying migrations itself.
