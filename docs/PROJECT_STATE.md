# InfraForge project state

_Current state as of 2026-10-27. History lives in git (`git log`), not in this file._

## What InfraForge is

A laboratory for seeing why infrastructure behaves the way it does: people draw a system
(DNS, CDN, firewall, load balancer, virtual machines, container registry, cache, database,
object storage, message queue, monitoring), run it under load and faults, and read where
and why it breaks. Two audiences share one engine and one run record: learners (guided
challenges) and engineers (a free canvas).

## Engines

- **Model 1** — the original tick-based simulator. It runs every public simulation today
  (live runs, controls, reports, the 12 guided challenges). It is being replaced.
- **Model 2** — an event-by-event causal engine (`packages/simulation/src/model2`): every
  request is followed through load balancer, application, database session, transaction and
  outcome, deterministically, with provenance and honest "unknown" values. Mechanisms exist
  for all 11 component types.
- **Plan (locked 2026-10-28):** Model 2 replaces Model 1 for every new run before the
  public launch on **6 November 2026**; Model 1 code is then removed. Runs execute in
  the browser; the server re-runs each finished run's inputs for the official result.
  Old Model 1 runs and reports stay readable and are never relabelled.

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
