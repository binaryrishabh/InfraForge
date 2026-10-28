# InfraForge design language: the timetable

InfraForge's subject is a system changing over time, so its one picture is a
timetable. Each resource is a **station** with a **rail** running left to right
through simulated time. The same stations sit in the same places on the station
map, the designer's tiles, the live run and the replay, so spatial memory carries
from brief to result.

## Truth rules

Every mark keeps one meaning wherever it appears.

| Mark | Meaning |
| --- | --- |
| Thin grey rail | Recorded Healthy |
| Heavier warm rail (3 / 5 / 6 px) | Recorded Degraded / Saturated / Failed; Failed also carries ticks so it reads without colour |
| Faint field above a rail | Modeled CPU, 0–100% |
| Hatching | Not retained, so **Unknown**. Never drawn as zero or Healthy |
| Empty rail | A second this view did not receive (live). Nothing is filled in |
| Dotted rail behind a veil | Not shown yet (the landing page's run before you predict). Distinct from Unknown |
| Red tint and dashed line | The fault window and the moment it applied |
| Chalk blue (`--if-accent`) | **You**: your predictions (diamonds, filled when matched), your focus, your actions. Never used for simulator state |
| Train (read teal, write amber) | One request, drawn only when a causal journal records its identity (Model 2, internal) |
| Dotted train segment | Between two records the request's position was not recorded |
| Ring at a train's end | No caller outcome by the horizon: outcome Unknown, not failure |

Runs record per-second resource state, so their timetables have rails and state
and never trains. Snapshots and traces are never interpolated: `sampleAt` returns a
sample only inside its own second, and `statesAt` gives `null` health (drawn dashed,
read as "Not retained") when nothing was retained.

## Where it appears

- **Landing** (`features/landing`): a real Model 2 run produced by the engine
  (`scripts/landing-sample.ts`, checked by `scripts/tests/landingSample.test.ts`),
  stopped at the fault. You commit to a prediction, then the recorded run plays.
- **Sign in / sign up**: the same recorded run at its judged second.
- **Brief and home**: the challenge's starter as a station map with the fault target marked.
- **Designer**: station tiles at the existing card footprint; transit rails
  (straight, one 45° run, straight). No moving dashes: live views carry no
  per-connection traffic. Below 1100 px the palette folds to a rail and details open
  as a sheet; on phones both are sheets. There is no width wall.
- **Live run**: the timetable grows one received second at a time beneath the
  canvas; the cursor follows the newest second until moved.
- **Result** (`features/replay`): verdict and prediction first, then the map and
  readout at the cursor, the timetable, and the moments the record points to. The
  full evidence record stays below, collapsed for challenge attempts.
- **Internal connected runs** (`/internal/model2/runs/:runId/timetable`): requests as
  trains from the recorded causal journal, with process-down, not-ready and
  load-balancer-ineligible intervals as bands. Model 2 remains INTERNAL.

## Visual system

Ink (dark) is the default theme and Paper (light) remains available. Colour tokens
live in `apps/web/src/index.css`; colour carries state, never resource category.
Atkinson Hyperlegible Next and Mono are the only typefaces. Corners are 1–4 px.
No gradients or translucent glass. Station pictograms (`ui/StationGlyph.tsx`) show
what a resource does rather than a vendor product, and palette rows describe roles
("Spreads requests across targets") instead of product names.

## Engine and limits

The timetable is a Canvas 2D drawing (`features/timetable/draw.ts`) with one shared
geometry for drawing and pointer input. It is also a slider: arrow keys step between
recorded moments (seconds for Model 1, events for causal runs), Home/End jump to the
ends, and the value is announced as modeled time. Theme changes redraw from CSS
tokens. No new dependencies were added: `bun.lock` is part of the Model 2 execution
identity, so 3D or a scene library would change that identity for presentation only.
Browser code may import only `@infraforge/simulation/tuning` and `/capacity`.

Measured on the production build (2026-10-18): main chunk 351.4 kB (109.5 kB gzip),
up from 316.0 kB (99.4 kB gzip) for the timetable engine and the 7.4 kB recorded
landing sample. The designer, live run, result and internal explorer load on demand.
