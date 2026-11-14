# InfraForge project state

_Production state below is as of 2026-10-27; the learning and backend state is as of 2026-11-14. History lives in git (`git log`), not in this file._

## What InfraForge is

A laboratory for seeing why infrastructure behaves the way it does: people draw a system
(DNS, CDN, firewall, load balancer, virtual machines, container registry, cache, database,
object storage, message queue, monitoring), run it under load and faults, and read where
and why it breaks. Two audiences share one engine and one run record: learners (guided
challenges) and engineers (a free canvas).

## Engines

- **Model 1** — the original tick-based simulator, removed in October 2026. Reports of its
  runs stay readable and are never relabelled; its runs cannot be rerun or improved.
- **Model 2** — an event-by-event causal engine (`packages/simulation/src/model2`): every
  request is followed through load balancer, application, database session, transaction and
  outcome, deterministically, with provenance and honest "unknown" values. Mechanisms exist
  for all 11 component types.
- **How runs work:** every new run, rerun and challenge attempt is a Model 2 run. It executes
  in the browser; when it ends, the server replays its inputs and actions for the official
  result. Eight guided challenges run on Model 2; cache-failure and after-the-cache-returns
  are retired until Model 2 models database connection pools. Public launch: **6 November 2026**.

## Learning curriculum and backend (backend + learning V1, not yet on `main`)

Measured from the registries (`apps/backend/scripts/registry-counts.ts`, `curriculum-audit.ts`), not from prose:

- 12 learning tracks, 59 modules, 121 current lessons (71 runnable labs, 32 conceptual exercises, 18 readings) plus 52 archived earlier lesson versions.
- 82 challenges (104 versions); 71 are taught by a guided one-change lab and 11 are free-design catalogue challenges.
- Published lesson and challenge versions are immutable. Corrections are version-forward: a new lesson or challenge version, the old one stays resolvable.
- Optional saved capabilities added in this phase (each unset = historical behaviour byte for byte, each with its own captured adapter profile): DNS publication after negative caching, artifact cache capacity, autoscaling from delivered telemetry, gateway quota scope, worker external wait, queue redrive with worker repair, cache stale-if-error, cache write invalidation, row lock order, successful empty-answer caching. See [reality/saved-capability-notes.md](reality/saved-capability-notes.md) for what each one models and what it does not claim.
- Deliberately not modelled (future scope, never started): a load-balancer outage with a restart state machine, an editable caller attempt timeout, consensus, cluster membership, distributed storage, real protocol or physical timing.

## Production

| Part | Where |
| --- | --- |
| Backend API, worker, WebSocket server, PostgreSQL 18, Redis | Owner-operated home server, Docker Compose, reached only through a Cloudflare Tunnel → nginx. See [HOME_HOST.md](HOME_HOST.md). |
| Frontend | Vercel, https://infraforge.lapwork.in |
| Backend URL | https://infraforge-backend.lapwork.in |
| Backups | Daily `pg_dump` with a restore check, to a private Cloudflare R2 bucket, 14 days ([HOME_HOST.md](HOME_HOST.md#database-backups)) |
| Monitoring | UptimeRobot on `/health/ready` |

## How changes ship

1. Work happens on a branch, is replayed onto `main`, and passes the full validation suite
   (the same jobs as `.github/workflows/validate.yml`).
2. The branch is fast-forwarded into `main`; GitHub validates the exact commit.
3. **Release InfraForge** (`.github/workflows/deploy.yml`) releases that commit to the home
   server (~4 minutes): database backup, image build, migration checks, health check, then
   the frontend. If a release fails before any schema change, the previous version is
   started again automatically. Details: [DEPLOYMENT.md](DEPLOYMENT.md).

## Accounts and sign-in

Google, GitHub (with verified account linking), and email with a confirmed signup link that
works across devices, password reset, a breach-checked password rule (8+ characters with
lowercase, uppercase, number and symbol) and Cloudflare Turnstile. Details:
[AUTHENTICATION.md](AUTHENTICATION.md).

## Other documents

- [DESIGN.md](DESIGN.md) — interface truth rules.
- [PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md) — rebuilding a host from scratch.
- [legal/](legal/) — privacy policy and terms (effective dates are set at publication).
