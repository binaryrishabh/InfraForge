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
For historical ownerless runs, complete the explicitly approved first-cutover
retirement below. Stopping their old process does not clear those records; release
startup never invents an owner or rewrites their status automatically.
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

## First cutover: evidence, fencing and recovery

The hosted baseline is PostgreSQL 18.6 with migrations 1–8, 28 historical
`test-user` designs, 331 deployments (223 completed, 8 failed, 4 live, 96
torn-down) and 348 completed outbox rows. Three runs advanced before containment;
the fourth was unknown. Public API/WS maintenance is established, but the legacy
containers still run. None of the following hosted steps was executed by B0.6C.
Keep maintenance active until backend acceptance and frontend/OAuth smoke pass.

Use direct Neon endpoints for migration, backup, evidence and worker ownership.
The API may use Neon pooling. [Neon pooling](https://neon.com/docs/connect/connection-pooling)
uses transaction pooling; its `-pooler` hostname is rejected by the worker. A
successful short probe cannot certify an undocumented proxy's session semantics.
Use `sslmode=verify-full` and provider-approved TLS; never disable verification.

### Read-only evidence and eight-migration drift

Load `CUTOVER_DATABASE_URL` from private operator configuration, with no credentials
in shell history. From `apps/backend`:

```sh
bun --no-env-file cutover/cli.ts evidence > PRIVATE_EVIDENCE_JSON
```

The command uses a repeatable-read, read-only transaction, UTC and fixed date
format. It emits counts, migration state/checksums, active IDs/checkpoint times,
catalog definition hashes, redacted sessions/locks and historical owner markers.
Only Infrastructure/Deployment/Outbox contents are hashed. Auth tokens, email,
OAuth data, query text and application payloads are excluded. Protect the output;
database/object names and deployment IDs are operational identifiers.

Create a fresh owned local PostgreSQL 18 database named
`infraforge_reference_RANDOM_HEX`, set `CUTOVER_REFERENCE_URL` to it, then run:

```sh
bun --no-env-file cutover/cli.ts reference
bun --no-env-file cutover/cli.ts baseline
```

The reference initializer refuses a nonempty database. Baseline comparison makes
no target writes and requires exact successful migrations 1–8 plus equal SQL
catalogs (columns, indexes, constraints, functions, triggers, policies, extensions
and user schemas). Unexpected provider objects fail closed for independent review.
It does not prove role privileges or grants. The rehearsal also introspects this
reference using installed Prisma 7.9.1 `db pull --print`, then runs `migrate diff
--from-config-datasource --to-schema PRIVATE_REFERENCE_SCHEMA --exit-code` against
the target. [Prisma deploy does not detect drift](https://www.prisma.io/docs/cli/v7/migrate).
Checksums alone are insufficient; do not mark baseline PASS from history alone.

### Disposable Neon branch rehearsal

Operator authorization for hosted branch access is separate from local tests.
Clone production into a non-default, unprotected, ready disposable child named
`infraforge-rehearsal-16_RANDOM_HEX`. Do not connect any legacy application to it.
Supply these private environment values outside Git:

| Variable | Required value |
| --- | --- |
| `REHEARSAL_PRODUCTION_IDENTITY_FILE` | Absolute file outside the checkout, independently recorded JSON `projectId`/`branchId` for production |
| `REHEARSAL_PROJECT_ID`, `REHEARSAL_BRANCH_ID` | Explicit disposable branch identity |
| `REHEARSAL_ID` | Exact disposable branch name above |
| `REHEARSAL_DISPOSABLE` | `disposable-neon-branch` |
| `NEON_API_KEY` | Operator-authorized API access; the tool issues identity GETs only |
| `DATABASE_URL` | Verified disposable API endpoint, direct or pooled |
| `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL` | Verified disposable direct endpoints |
| `REHEARSAL_IDS_FILE` | Private JSON array of the four exact legacy live deployment UUIDs |
| `REHEARSAL_FENCE_ACK` | `legacy-writers-stopped-and-credentials-rotated` |
| `REHEARSAL_FENCE_EVIDENCE` | Non-secret reference to actual clone isolation/fencing evidence |

All three URLs must use verified TLS and the same database. API metadata must prove
each endpoint belongs to the disposable child of the independently identified
production branch; same-branch, default/protected, wrong-parent or ambiguous
endpoints are refused. Do not guess production identity from rehearsal credentials.
Real identifiers and credentials are never examples committed to this repository.
The PostgreSQL 18 dump container uses `PGSSLROOTCERT=system` with `verify-full`,
so libpq validates Neon against its system CA store rather than expecting a local
`~/.postgresql/root.crt`. See [libpq TLS settings](https://www.postgresql.org/docs/18/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT).

```sh
# From the repository root, using a verified already-built commit-labelled image:
bun --no-env-file scripts/release/external-rehearse.ts LOCAL_IMAGE > PRIVATE_REHEARSAL_JSONL
```

Before mutation the tool prints only target host/database fingerprints. It uses
fresh OS temporary state, a unique `infraforge_rehearsal_*` local Compose project,
owned local PostgreSQL 18 reference/restore databases and isolated Redis. It never
uses production state, accepted.json, Nginx, credentials or a production Compose
project. Endpoint identity is rechecked before retirement/migration/start. Metadata
verification cannot replace operator control of the branch throughout the run.

It checks the exact eight-migration catalog and Prisma baseline, custom dump/restore
and deliberate restored-row mismatch, then retires only the explicit four runs.
It reuses normal release preflight/migration/postcheck/start/readiness for 9/10 and
the three SQL guards. Real database-backed sessions prove two-user HTTP/WS isolation,
zero historical designs visible, unchanged domain rows and zero unauthorized controls.
Known Neon pooled worker URLs and duplicate workers must fail. An owned worker with
automatic restart disabled is killed with SIGKILL; lock release and acquisition by
a different backend PID must finish within 10 seconds including container replacement.
The measured timing is printed. Excess delay fails; it is never treated as recovery.
This covers process death, not a network partition or simulation checkpoint replay.

Normal completion cleans owned local resources, private dump/schema copies and
fixture users. An interrupted branch may retain fixture records and is never a
production candidate. The Neon branch remains for explicit owner deletion. Capture private output before
cleanup. Hosted TLS/OAuth, real provider timing, grants and fallback remain separate
proofs; local fixtures cannot establish them. Failed migration leaves the disposable
branch for diagnosis; never use `migrate resolve` on primary to imitate fixture repairs.

### Stop and fence every legacy writer

1. Confirm both public namespaces remain maintenance 503, park the incompatible
   frontend and record an active-run evidence sample. Identify the exact legacy
   Compose project, every API/WS/worker process, containers, cron/systemd/PM2 jobs,
   CI deployers and database roles. Stop if any writer cannot be accounted for.
2. Stop legacy API and WS first using their verified project/service names. Check
   BullMQ queue activity, Redis pending jobs and database outbox/run state privately.
   Capture a second evidence sample. Do not delete queue items or rewrite statuses
   to manufacture idleness. Pending/running outbox work blocks retirement.
3. Gracefully stop the legacy worker; verify its process/container is gone. Bring
   that verified Compose application project down **without** `--volumes` or prune.
   Preserve Redis data and recovery evidence. Check no old service still listens on
   application/WS/Redis host ports and no independent worker can restart.
4. Rotate every credential available to old writers using the supported Neon console
   workflow. Rotation prevents reconnects; it does not terminate existing sessions.
   Store new operator/release credentials privately, update approved secrets safely,
   and leave old jobs disabled. Confirm API/migration/worker target the same primary.
5. Through a verified **direct** operator connection, inspect `pg_stat_activity` with
   sufficient visibility. Select exact old sessions/roles/PIDs first; terminate only
   those confirmed old sessions. For example, bind a privately reviewed legacy role
   as the psql variable `legacy_role`, then execute:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname=current_database() AND usename=:'legacy_role'
  AND pid<>pg_backend_pid();
```

6. Wait at least 30 seconds and sample sessions/run checkpoints/outbox twice.
   Stop on unknown clients, reconnects, changed checkpoints or pending work. The
   retirement tool refuses other client sessions, including sessions whose type
   cannot be inspected; it does not stop processes or rotate credentials for you.
   A quiet advisory-lock table is insufficient because the old worker never took
   the new lock. Maintenance 503 alone is not database fencing.

### Recovery branches, explicit retirement and primary migration

First rehearse a production clone and prove fallback/restore on independent
disposable targets. During the approved primary window repeat fencing and exact
baseline checks against the now-frozen primary; reject any changed history/counts.
Create an **as-found recovery branch** before retirement, record its identity/time
and evidence, restrict access and keep applications disconnected. A Neon branch
is writable by default: protection/access restrictions and a tested fallback are
required before calling it an immutable recovery point. Never start a new worker
on its legacy live records; their checkpoints are diagnostic only.

From `apps/backend`, with the direct primary URL explicitly loaded and private IDs:

```sh
bun --no-env-file cutover/cli.ts retire --ids-file PRIVATE_IDS_JSON \
  --fence-ack legacy-writers-stopped-and-credentials-rotated --evidence FENCING_REFERENCE
# Review exact DRY_RUN IDs/count and obtain the approved retirement action:
bun --no-env-file cutover/cli.ts retire --ids-file PRIVATE_IDS_JSON \
  --fence-ack legacy-writers-stopped-and-credentials-rotated --evidence FENCING_REFERENCE --apply
```

All supplied records must be exactly live; no other pending/running/live record,
pending outbox, other client or worker lock is permitted. Serializable transaction,
table and row locks protect the set; any mismatch rolls everything back. Exactly
four records become torn-down with the durable operator event. Inputs, checkpoint,
seed, workload, stages, chaos history and `test-user` marker stay intact. A second
execution refuses. No owner or runInputs is generated.

Create a separate **pre-migration recovery branch** after retirement. Record its
evidence and prove restoration/fallback, including privileges and application
connectivity; never assume a branch name proves backup validity. Take a PostgreSQL
18+ custom dump using private PGSERVICE/PGPASSFILE settings:

```sh
pg_dump --version
PGSERVICE=APPROVED_FROZEN_SOURCE pg_dump --format=custom --file PRIVATE_BACKUP
sha256sum PRIVATE_BACKUP
PGSERVICE=APPROVED_EMPTY_DISPOSABLE_RESTORE pg_restore --exit-on-error \
  --single-transaction --no-owner --no-acl --dbname DISPOSABLE_DATABASE PRIVATE_BACKUP
```

Verify source and destination identity before execution. Restore only to a distinct
empty disposable PostgreSQL 18 database; never use `--clean` or `--create` against
primary. Protect dump/service/password/evidence files with operator-only permissions.
Collect evidence from source before/after and restored destination; run
`cutover/cli.ts compare SOURCE_JSON RESTORED_JSON` and require PASS. Also verify
archive checksum before/after transfer/restore. [Single-transaction restore](https://www.postgresql.org/docs/18/app-pgrestore.html)
fails atomically on an error. `--no-owner --no-acl` intentionally excludes ownership
and grants: separately inventory, review and test required hosted roles/grants,
extensions, TLS, backup retention and provider fallback. Auth row counts are compared;
auth token contents are never hashed or printed. This proof is for the pre-auth
first release, not complete content certification of a later authentication backup.

Run final idle/history/baseline/session/backup preflight, then the approved exact-SHA
release for migrations 9/10 and postchecks. Require 28 ownerless historical designs,
historical `test-user`, no live legacy runs, matching guards, direct single worker and
API/WS/worker/dependency readiness. Deploy backend, stage same-site frontend from the
same SHA, complete real OAuth/session/ownership/run smoke, then promote frontend.
No legacy image is eligible for container rollback after this schema/auth cutover.
Failure means continued maintenance and owner-approved forward repair or tested
database fallback; never reconnect an old worker automatically or resume checkpoints.
