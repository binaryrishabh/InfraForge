# Controlled release

B0.5 is a release process, not evidence that the hosted application is ready. Use an
approved maintenance window and a verified database backup/restore plan. Never run
these commands against production during development validation.

## Owner setup before the first release

1. Retire the old API, WS and **all** workers, including services outside the new
   `infraforge` Compose project. Remove their public exposure. An old worker without
   advisory locking cannot be detected reliably by the new worker. The first release
   has no accepted rollback image. Park the old browser-auth frontend in maintenance.
2. On EC2 install Bun 1.3.14, Docker/Compose and a patched host Nginx. Keep the checkout
   at `~/InfraForge`; create `/var/lib/infraforge/releases` owned by the release
   operator with mode `0711`. Nginx needs directory traversal to stat the maintenance
   marker; only the operator can list/write the directory and read private state files.
   Parent directories must also allow Nginx traversal. Install [the proxy template](../ops/nginx.conf.template), replacing
   `DOMAIN` and certificate paths. The proxy must read that exact state directory's
   `maintenance` file. Validate Nginx configuration and certificate renewal.
3. Publish only HTTPS/443 (and HTTP/80 for redirect/certificate validation). Keep
   API/WS bound to loopback; do not publish worker, Redis or PostgreSQL. Restrict SSH
   by security group. The single trusted proxy must replace forwarded headers;
   do not add another proxy or expose container ports without revisiting that trust.
4. Store operator configuration in `/etc/infraforge/release.env`, readable only by
   the operator. Provide `DATABASE_URL` for API/WS, `MIGRATION_DATABASE_URL` for a
   direct migration connection, `WORKER_DATABASE_URL` and `WORKER_DATABASE_MODE=direct`
   or `session`, plus [auth settings](AUTHENTICATION.md). All URLs must reach the same
   database. Confirm PostgreSQL TLS/certificate settings with the actual provider.
   Do not print or commit this file. Keep a stable auth secret across releases.
5. Use a provider-verified session-preserving worker endpoint. Transaction pooling
   breaks session advisory locks; see [PgBouncer's feature matrix](https://www.pgbouncer.org/features.html).
   Startup rejects known transaction-pooling settings and probes independent sessions;
   runtime checks ownership. These probes cannot certify an arbitrary transparent
   proxy. Provider mode verification remains required. API pooling is permitted;
   migration/worker pooling must preserve sessions.
6. In GitHub configure the `production` environment with required owner approval,
   no self-approval/bypass, and deployment restricted to `main`. Set EC2 host/user/key
   and independently verified `EC2_HOST_FINGERPRINT`. The workflow is **manual**, takes
   a full main SHA and validates that exact tree before SSH. A develop push only runs CI.
7. In Vercel change root to `apps/web`, enable source outside that root, use Vite,
   retain production branch `main`, and remove conflicting install/build overrides.
   Verify hosted Bun 1.3.14 and public HTTPS `/api` / WSS `/ws` values. Keep previews on
   approved nonproduction endpoints. Before the first promotion, disable/disconnect
   automatic Git production deployment until the new root/config is effective.
   The repository then disables automatic main deployments using
   [git.deploymentEnabled](https://vercel.com/docs/project-configuration/git-configuration).
   No hosted settings were changed by B0.5.

## Backend sequence

Tear down active runs through the authenticated API first. The release refuses
pending/running/live runs and active runtime markers. Capture backup/restore evidence,
current backend image and frontend deployment before approving the maintenance window.
If historical ownerless runs are still marked active, stop here and prepare a separately
approved retirement plan. Stopping their old process does not clear those records,
and this release never invents an owner or rewrites their status automatically.
Use operator-controlled PostgreSQL service/password files, not passwords in command
history. For example, `PGSERVICE=infraforge_backup pg_dump --format=custom --file BACKUP`
then `PGSERVICE=infraforge_restore pg_restore --exit-on-error --no-owner --dbname APPROVED_DISPOSABLE_DATABASE BACKUP`.
Verify restored records and the recorded migration/auth/image version. These service
definitions and actual backup location are owner configuration, not repository defaults.
After owner promotion to main, dispatch **Release InfraForge** with its full SHA.
The workflow fetches main, requires a clean checkout, checks out that exact commit and runs:

```sh
bun --no-env-file scripts/release.ts apply FULL_SHA /etc/infraforge/release.env /var/lib/infraforge/releases
```

The operator command builds a commit-tagged image with an OCI revision and embedded
SHA/auth contract/migration fingerprint. It preflights history and database targets,
closes public API/WS access through the maintenance file, verifies the real TLS proxy
returns maintenance, stops API/WS, rechecks idle runs, then stops the single worker.
It refuses a remaining worker lock before migrations. Original migrations are unchanged;
nonempty databases older than the first eight migrations need a separate upgrade plan
because the old outbox migration drops data. The final two migrations are additive;
legacy owners/run inputs are not invented.

Installed Prisma **7.9.1** is used from `apps/backend`:

```sh
bun --no-env-file --no-install run --bun prisma migrate deploy --config prisma.config.ts
bun --no-env-file --no-install run --bun prisma migrate status --config prisma.config.ts
bun --no-env-file --no-install run --bun prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config prisma.config.ts
```

Postchecks require exact successful history/checksums, no schema diff, and enabled SQL
triggers with their reviewed definitions. Runtime startup also rejects missing or future
migration history, preventing an older guarded worker from starting on a newer schema.
API/WS readiness requires PostgreSQL, Redis and database guards. Worker readiness also
requires the lock, both queue connections, a running queue loop and recent outbox polling.
`/health/live` proves only process liveness. Readiness reports the actual release SHA.

Start exactly one worker and wait for all three containers and the public TLS readiness
response to match the image/SHA. Only then record acceptance and reopen the proxy.
No database rollback occurs automatically. A failed migration/postcheck leaves services
stopped and maintenance active. Failures after stopping begins retain `release.lock`
and stop owned migration helpers, including a helper left behind by a CLI timeout.
Interruption also retains the lock and any maintenance marker;
inspect child/container state and migration history before recovery. Never blindly
remove these markers or run `migrate resolve`. This is downtime deployment, not a
zero-downtime or checkpoint-recovery system. Interrupted runs still fail explicitly.

## Frontend order

Prepare a **production** frontend build from the same clean approved SHA. Stage it
without assigning the live domain, following [Vercel's deploy options](https://vercel.com/docs/cli/deploy):

```sh
# From apps/web, with owner-authorized Vercel project access and production settings:
vercel pull --environment=production
RELEASE_BUILD=1 RELEASE_SHA=FULL_SHA vercel build --prod
vercel deploy --prebuilt --prod --skip-domain
# After backend acceptance, from the repository root:
bun --no-env-file scripts/release/frontend-check.ts FULL_SHA STAGED_HTTPS_ORIGIN API_HTTPS_ORIGIN
# After owner smoke tests:
vercel promote STAGED_DEPLOYMENT_URL
```

The build rejects missing identity or insecure/mismatched public endpoints. Both
artifacts must have the same SHA and auth contract before promotion. Deployment
protection may require owner-authorized inspection of the staged artifact; never
weaken protection to make a check pass. OAuth/session smoke tests require an approved
same-site staging domain and exact Origin configuration; an unrelated vercel.app URL
cannot share SameSite=Lax API cookies. Verify Google/GitHub login, expiry/sign-out,
owned designs, authenticated WS and a small deploy/control/teardown flow. First release
must keep the old incompatible frontend parked until these checks pass. Subsequent
breaking frontend/API changes also need maintenance, not an assumed compatibility claim.

## Container rollback

With a clean checkout at the **currently accepted** SHA:

```sh
bun --no-env-file scripts/release.ts rollback CURRENT_SHA /etc/infraforge/release.env /var/lib/infraforge/releases
```

Only a recorded previous image with identical migration fingerprint, auth contract
and settings fingerprint can return. Retain both accepted images; never retag/prune
them during a release. Applying an already retained SHA is refused before rebuilding.
Stop API/WS and worker, repeat database checks, start the exact
previous image and verify readiness before acceptance. New-release health failure uses
this same compatible container rollback; if rollback health also fails, services stay
stopped. No old unauthenticated version is eligible.
The auth contract is a maintained compatibility version: bump it in backend and
frontend release metadata when identity/session rules become incompatible. Matching
version numbers do not replace reviewing compatibility of the proposed release.

Rollback cannot undo migrations, recover deleted data, restore simulations, downgrade
identity rules, or reverse auth-secret/provider/origin changes. Schema/auth/settings
changes require an explicit restore or forward repair plan. Frontend rollback is a
separate owner promotion of a recorded compatible deployment, after comparing its auth
contract/backend API compatibility. A backup that was never restored in rehearsal is
not recovery evidence.

## Disposable rehearsal

Build an explicitly test-only local image and run:

```sh
docker build --build-arg RELEASE_SHA=FULL_SHA --label org.infraforge.rehearsal=true -f apps/backend/Dockerfile -t infraforge-release-test .
bun --no-env-file scripts/release/rehearse.ts infraforge-release-test
```

The runner refuses remote Docker contexts/overrides, uses a unique Compose project,
private fresh PostgreSQL/Redis, fake test image identities, real session rows and a
one-day fixture TLS certificate. It checks migration success/failure, legacy quarantine,
drift/guards, active-run refusal, competing workers, dependency loss, compatible rollback,
real session/transaction poolers and TLS/WS/session security. It removes only its owned
containers/volumes/networks/images and temporary files. GitHub packaging runs it too.
The fixture also dumps the pre-release database and restores its legacy records into
a separate disposable database. This verifies local restore mechanics. It does not
verify hosted backup retention/restoration, EC2 networking, provider pooling,
production certificates, Vercel promotion or external OAuth credentials.
