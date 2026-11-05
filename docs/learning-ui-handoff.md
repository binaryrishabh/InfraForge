# Learning presentation handoff

Replace the markup in `apps/web/src/features/learning/*.tsx` while retaining the
data modules below. Components render projections and forward events; filtering,
ordering, eligibility, copy decisions, persistence and effects belong outside JSX.
No new progress store, attempt history, evaluator or simulator is needed.

## Routes and states

`apps/web/tests/learningRouteStates.test.tsx` inventories the actual routes from
`app/App.tsx` and runs a case for every declared state in `LEARNING_VIEW_STATES`
(`viewModels.ts`). Adding a state without a case fails the inventory gate and
test typecheck. The gate has a negative test that adds an untested state.

| Route/surface | States to preserve |
| --- | --- |
| `/learning` | Loading; failure with retry; results; no filter matches; empty catalog; draft lesson/module/track hidden; all server activity labels. |
| `/learning/lessons/:lessonId` | Loading; missing/draft/unavailable lesson with retry and Back to Learning; three lesson kinds; available/busy/unavailable lab; absent/unanswered/correct/incorrect check; unused/saved/denied device storage; advisory prerequisite links or explicit missing references. |
| Lesson's secondary data | Catalog links loading or error with their own retry while the lesson remains usable; absent/loading/error/retained latest report; absent guided review; eligible comparison or no eligible pair; matching lab summary or no summary; missing measurements remain Unknown. |
| `/home` Continue learning | Loading; retry; server suggestion with reason; no visible suggestion and Browse Learning. |
| `/runs/:deploymentId` lesson follow-up | Loading; retry; linked visible lab; absent/non-lab renders nothing. |
| `/design` after opening a lab | Shared challenge attempt flow owns prediction, busy, quota and refusal. Preserve the supplied error and leave the workspace usable; never imply an attempt started after rejection. Inventory tests exercise the real start client/state helper with refused HTTP seams. |

Drafts never become catalog rows, suggestion targets or prerequisite links. Direct
draft lookups return the normal unavailable lesson state. Prerequisites are advice,
not locks. Opening a lab opens its workspace; it does **not** start a run. The
existing `useOpenChallenge` handles active/starting run guards, navigation and
workspace errors. `AttemptDialog` and `startAttempt` own the later start/refusal UI.

## Data boundary

Learning shapes are in `packages/contracts/src/learning/index.ts`; measurement
definitions are in its `measurements.ts`. Clients use authenticated requests via
`client/httpClient.ts`. Learning GET responses add `success: true` to these shapes:

| Endpoint | Consumed shape |
| --- | --- |
| `GET /api/learning` | `LearningCatalog`: `tracks[]`, `lessons[]` summaries, lab-only `progress[]`, `suggestions: { continue, nextLesson, reviewCandidates[] }`. Suggestions carry `{ lessonId, reason }`. |
| `GET /api/learning/lessons/:id` | Current-only `LearningLessonDetail: { lesson, progress: LessonProgress \| null, challenge: LearningChallengeSummary \| null }`. IDs are URL encoded. No archive/version lookup is used by the UI. |

Tracks contain `{ id, title, summary, availability, modules[] }`; modules contain
`{ id, title, summary, availability, lessonIds[] }`. Summary fields are `id`,
`contentVersion`, `trackId`, `moduleId`, `title`, `summary`, `kind`, `level`,
`availability`, `prerequisites`, `experiment`, `limitations`. Detail adds `problem[]`,
`explanation[]`, `followUp?`, `check`. A check has `question`, `{ id, text }[]`
choices, `correctChoiceId`, `explanation`. Only labs have
`experiment: { challengeId, prediction, evidenceToInspect? }`; other kinds have
`experiment: null`. Challenge summaries expose `id`, `version`, `specHash`, `title`,
`summary`, `evaluationSeconds`, `requirementCount`, `executable`.

Reuse these existing clients rather than inventing lesson endpoints:

| Related endpoint | Client result / use |
| --- | --- |
| `GET /api/deployments/:id/report` | `{ report: RunReport }`; latest attempt identity/challenge checked before display. |
| `GET /api/deployments/:id/compare-options` | `{ runs: RunSummary[] }`; up to 100 finished candidates, not the full history. |
| `GET /api/deployments/compare?a=...&b=...` | `{ comparison: RunComparison }`; server availability and recorded challenge conditions govern the link. |
| `POST /api/challenges/:id/workspace` | `{ fresh: false }` -> `{ designId, created }`; navigate to `/design?design=...`. |
| `POST /api/challenges/:id/improvement-workspace` | `{ sourceRunId }` -> `{ infrastructure }`; shared improvement form requires the learner's own hypothesis. |
| `POST /api/challenges/:id/attempts` | `{ infrastructureId, prediction, improvement? }` -> `{ createdDeployment }`; shared challenge flow supplies optional pinned version for improvements. The server owns workload, seed, rules and verdicts. |

Report/comparison shapes remain in `packages/contracts/src/reports/`; prediction
and improvement shapes remain in `packages/contracts/src/challenges/`. A lesson
summary reads `report.challenge` verdicts, exact `terminal`, topology resource IDs
and the last retained monthly estimate from `stages`. It never rejudges a run or
substitutes a checkpoint for a missing terminal measurement.

## Functions and hooks

Paths below are relative to `apps/web/src/features/learning/` unless qualified.

| Module / exports | Inputs -> outputs |
| --- | --- |
| `discovery.ts`: `availableLessons`, `discoverLessons`, `discoveryTerms` | Catalog (+ filters or lesson) -> available lessons in authored track/module/lesson order; combined level/kind/resource/track/all-search-word matches; indexed concepts and mentioned resource tags. Tags do not promise executable support. |
| `discovery.ts`: `prerequisiteLessons`, `lessonMode`, `activityLabel`, `KIND_LABEL` | Lesson/catalog/server progress -> resolved or missing advisory references; conceptual/lab mode; matching lab activity wording or null; honest kind labels. |
| `viewModels.ts`: `requestView`, `lessonPageView` | Request flags/data/error -> loading/error/optional-empty/ready; lesson destination key (`loading`, `unavailable`, or `id:contentVersion`). Loading takes precedence over stale data. |
| `viewModels.ts`: `catalogView`, `lessonRowView` | Catalog + filters (or lesson) -> visible grouped rows, review suggestions with conceptual prerequisites, sorted resource options, available track options, count/empty text, labels and links. Input arrays are not mutated. |
| `viewModels.ts`: `lessonBodyView`, `lessonSections` | Detail + optional catalog + device state + storage availability (or kind) -> section order, next visible lesson **within the same track**, launch eligibility, evidence checklist, prediction/follow-up defaults, validated answer, feedback, device copy and latest-report link. |
| `viewModels.ts`: `comparisonView`, `reportLessonView`, `lessonRunSummaryView` | Comparison/detail/report + lesson -> display links/condition wording, linked lab follow-up, or matching lab report projection; ineligible data returns null. |
| `viewModels.ts`: `changeLearningFilter`, `selectCheckAnswer`, `toggleReadMark`, `lessonHref` | Current value + event value/ID -> new immutable value or encoded URL. |
| `deviceLocal.ts`: `readDeviceLesson`, `saveDeviceLesson` | Lesson ID + content version (+ value), guarded storage getter -> `{ value: { read, answer }, available }` or save boolean. Key: `infraforge:learning:<encoded-id>:v<version>`. Corrupt/denied storage falls back safely. |
| `hooks.ts`: `useLearningCatalog`, `useLearningLesson(id)`, `useReportLesson(challengeId)`, `useLessonActivity(detail)`, `useLessonComparison(report)` | Identity inputs -> `{ data, loading, error, retry }`. Reuse `useRequest`: ignore late responses after identity change/unmount; retry clears stale data. |
| `hooks.ts`: `useDeviceLesson(id, version)`, `useLearningFilters`, `useLearningOwner`, `useLearningFocus(destination)` | Keyed mount -> device state/availability/update; filter value/setter; current owner key; heading container ref with destination-dependent focus effect. Pages remount session state on owner changes; device controls remount on lesson/version changes. |
| `lessonActivityData.ts`: `latestLessonRun`, `getLatestLessonReport`, `getLessonComparison` | Detail/report -> matching lab run ID, checked recorded report, or server-eligible distinct comparison pair. Prefer the recorded improvement source, then the first eligible option. |
| `reportLessonData.ts`: `findReportLesson` | Challenge ID -> first visible linked lab detail, rechecked after fetch, or null. |
| `runSummaryData.ts`: `lessonRunMeasurements` | Existing report + authored evidence labels -> `{ label, value }[]` with recorded units/resource IDs; missing/unrecognised/non-finite data is Unknown. |
| Contracts `selectLearningSuggestions`; dashboard `learningNextStep` | Authored order + attempts (+ optional local read IDs) -> server suggestion reasons; catalog -> visible Continue suggestion, then Next suggestion, else null. Home's other recommendation priorities remain separate. |

## Section claims and progress vocabulary

Render `lessonSections(kind)` in order: **Problem -> Plain explanation -> Prediction
prompt -> [Experiment -> Evidence to inspect, labs only] -> Limitations -> Follow-up
-> Check question**, followed by device-local reading controls. Latest recorded
attempt/review/comparison and the run summary follow the lesson body.

Reading and conceptual exercises explain ideas and invite reasoning. Their check
feedback compares a choice with an authored explanation; it proves neither a run
outcome nor mastery. They must not show experiments, measured outcomes or server
completion. Labs can invite a prediction and a run, but only recorded reports may
state simulated outcomes. No attempt means no known result. A terminal-second p95
is not a whole-run SLO; the first Healthy sample proves neither continuous health
nor recovery time. Always retain the lesson's authored limitations and evidence limits.

`LessonProgress` is server-derived, lab-only activity:

- `not-started`: no recorded attempts; UI says **No recorded attempts**.
- `attempted`: a recorded attempt exists; UI says **Recorded attempt**, regardless
  of whether it is judged or meets requirements.
- `improved-after-attempt`: an evaluated improvement of its recorded earlier source,
  with the same classified conditions and requirement total, met more requirements;
  UI says **Recorded improvement**. This is not a general causal claim.
- `requirements-met`: a recorded evaluated attempt met the current pinned challenge
  version's requirements; UI says **Current requirements met**.

Earlier-version activity remains visible with its qualifier; it does not satisfy
current-version requirements. `lastRunId` names the most recently started attempt,
not necessarily the best result. `predictionReviewed` means a retained prediction
and judged attempt, not proof a person read the review. Comparison eligibility is
server classified. Reading marks/check answers are device-local personal notes,
versioned by content, shared by users of that device, and never server progress.

Never show mastery scores, learning/progress percentages, streaks or fake timestamps.
Do not manufacture completion rates, substitute zero for Unknown, invent cloud
benchmarks, or turn a hint into a learner's submitted hypothesis. Recorded report
measurements keep their real units (including CPU percent) and stated time scope;
they are not a learning percentage. Progress timestamp fields are not measurement
timestamps and are not currently displayed.

## Accessibility and verification

After navigation and lesson loading/error/identity changes, focus the page's `h1`
with `tabIndex=-1`; do not steal focus on filters, answers, read marks or progress
refresh. Preserve native links, buttons, select/search controls and radio keyboard
operation, field/legend labels, `aria-describedby`, read toggle `aria-pressed`,
polite result/check/storage announcements, and failure alerts with a named retry.
Keep prerequisite and report-follow-up accessible names and heading hierarchy.

`learningViewModels`, `learningHooks`, `learningRouteStates`, `learningPages`,
`learningDiscovery` and `learningReturn` tests cover these boundaries. The 24
`learningPresentation` snapshots were captured before extraction and preserve
existing markup/classes/copy. `learningApi`, `learningLaunch`, `learningLoop` and
`learnerJourney` exercise the existing HTTP/navigation/real-engine seams. Hook and
server-rendered control tests are not live-browser keyboard or visual QA.
