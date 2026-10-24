# Fresh PostgreSQL cutover and provider switches

The owner decided on 2026-10-24 to **abandon the old Neon data and start fresh**
after its network-transfer quota was exhausted. This procedure does not migrate
old users, designs, runs or sessions. No production change is performed by this
document. Run these commands only on the selected production host after the lead
merges the readiness transfer fix and this change, CI passes, and the owner
selects the new full `main` SHA. Docker packaging proof must pass first.

PostgreSQL 18 is an ordinary PostgreSQL service; there is no provider SDK in the
runtime path. `/etc/infraforge/release.env` selects the API/WS, worker and migration
connections. Backups read its migration URL too. Remote servers must present a
certificate trusted by the clients and use `sslmode=verify-full`; a private CA
needs trust installed in the application image and backup host before switching.
`channel_binding=require` is optional. Worker/migration endpoints must preserve
sessions, even if a provider calls a transaction endpoint "direct". Static URL
checks and live advisory-lock/session and same-database checks remain mandatory.

The exact local endpoint `postgres:5432` may omit TLS: the production Compose
service has only the internal `application` bridge and no host-published port.
Traffic never leaves this machine. Arbitrary private IPs and `localhost` do not
receive that exception. Do not add a PostgreSQL security-group rule, port mapping
or egress network. The production service uses the same multi-platform
`postgres:18-alpine` digest as CI and stores PostgreSQL 18 data at the named volume
`infraforge_postgres_data`, mounted at `/var/lib/postgresql`.

## Fresh-start owner runbook

Prerequisites: the existing Nginx HTTPS/maintenance configuration, Bun 1.3.14,
Docker Compose with `up --wait`, encrypted Docker/EBS and backup storage, and the
existing release operator. Keep `BETTER_AUTH_SECRET`, public origins and any
enabled mail/OAuth settings unchanged. First provision the S3 bucket and EC2 IAM
instance role using [backup installation](operations/backup-alerts.md); do not
put static AWS keys on this host. Its daily and weekly retention is 28 days.

1. Pause automated deployment during the cutover. In the release operator shell,
   select the approved commit in the existing checkout:

   ```sh
   cd ~/InfraForge
   git fetch origin main
   read -r -p 'Approved new full main SHA: ' RELEASE_TARGET
   test "$RELEASE_TARGET" = "$(git rev-parse origin/main)"
   test -z "$(git status --porcelain)"
   git checkout --detach "$RELEASE_TARGET"
   test "$(bun --version)" = 1.3.14
   test ! -e /var/lib/infraforge/releases/release.lock
   ```

   Each command must succeed before continuing. Use a **new SHA**, not either
   retained accepted SHA; the release refuses rebuilding an accepted image.
   If a lock exists, use the interrupted-release investigation in
   [PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md), never delete it blindly.

2. Fence old writers before changing the database. The release normally sets
   maintenance after preflight; for this intentional database replacement set
   it now, and stop the old API/WS/worker using their Compose project:

   ```sh
   printf '%s\n' "$RELEASE_TARGET" > /var/lib/infraforge/releases/maintenance
   RELEASE_SHA="$RELEASE_TARGET" RELEASE_IMAGE="infraforge-backend:$RELEASE_TARGET" \
     docker compose --project-name infraforge --env-file /etc/infraforge/release.env \
     -f apps/backend/docker-compose.yml stop --timeout 30 api ws-server worker
   ```

   Verify the public `/api/auth/providers` and `/ws` return HTTP 503 with
   `X-InfraForge-Maintenance: true`. Fence any older non-Compose host/process too.
   Do not attempt to read or repair the exhausted Neon database for this fresh
   start. Never erase Redis, release history or an existing PostgreSQL volume.
   If `infraforge_postgres_data` already exists unexpectedly, stop and inspect it;
   initialization credentials only apply to an empty volume.

3. Generate a 256-bit password **on the host**, and replace only the database
   settings in the existing private file. Run as the release operator who owns
   that file. This writes no credential to the terminal or shell history:

   ```sh
   python3 - <<'PY'
   import os, pathlib, secrets, stat
   path = pathlib.Path('/etc/infraforge/release.env')
   info = path.lstat()
   assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
   assert stat.S_IMODE(info.st_mode) == 0o600
   lines = path.read_text().splitlines()
   assert all(sum(line.startswith(key + '=') for line in lines) == 1
              for key in ('BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'APP_ORIGINS'))
   password = secrets.token_hex(32)
   url = 'postgresql://infraforge:' + password + '@postgres:5432/infraforge?sslmode=disable'
   values = dict(POSTGRES_USER='infraforge', POSTGRES_DB='infraforge',
                 POSTGRES_PASSWORD=password, DATABASE_URL=url,
                 MIGRATION_DATABASE_URL=url, WORKER_DATABASE_URL=url,
                 WORKER_DATABASE_MODE='direct')
   lines = [line for line in lines if line.split('=', 1)[0].strip() not in values]
   temporary = path.with_name('release.env.next')
   fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
   with os.fdopen(fd, 'w') as target:
       target.write('\n'.join(lines + [k + '=' + v for k, v in values.items()]) + '\n')
       target.flush()
       os.fsync(target.fileno())
   os.replace(temporary, path)
   PY
   ```

   Exact database keys are `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`,
   `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, and
   `WORKER_DATABASE_MODE`. Required existing application keys are
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ORIGINS`. `RELEASE_IMAGE` and
   `RELEASE_SHA` are supplied by the release, not saved in this file. A new host
   must first create those application keys privately using the bootstrap guide.
   Do not print `docker compose config` or inspect container environments.

4. Run the release. It pre-pulls the pinned PostgreSQL dependency, starts it and
   waits for health **before migration preflight**. Empty-volume initialization
   creates the role/database; Prisma applies all migrations. It verifies public
   maintenance, checks idle runs, stops all application containers, refuses a
   remaining worker lock, then verifies migration history/schema before startup:

   ```sh
   bun --no-env-file scripts/release.ts apply "$RELEASE_TARGET" \
     /etc/infraforge/release.env /var/lib/infraforge/releases
   ```

   Success records the accepted image and removes maintenance. A failed migration
   must leave the application stopped. Investigate privately; never bypass schema,
   worker, identity or history checks. This database/configuration change cannot
   automatically roll back to the old provider.

5. Check acceptance externally, substituting the actual public API origin:

   ```sh
   read -r -p 'Public API origin (https://...): ' API_ORIGIN
   curl --fail --silent --show-error -D - "$API_ORIGIN/health/ready"
   curl --fail --silent --show-error -D - "$API_ORIGIN/api/auth/providers"
   docker ps --filter label=com.docker.compose.project=infraforge \
     --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
   ```

   Require `success: true`, the exact full SHA, healthy API/WS/worker/PostgreSQL,
   and maintenance false. PostgreSQL must have **no host port mapping**. Run
   actual signup/login, authenticated WS, save/run/report smoke; old accounts
   intentionally do not exist. Re-run the same-SHA workflow for frontend staging
   and promotion after backend acceptance, then re-enable normal deployment.

6. Follow the [backup host installation](operations/backup-alerts.md) to install
   PostgreSQL 18 clients, AWS CLI v2, scripts, config and systemd units. Use the
   existing instance role, never `aws configure`. The unit reads the new migration
   URL automatically. Run the first backup before declaring recovery complete:

   ```sh
   sudo systemctl start infraforge-backup.service
   sudo systemctl show infraforge-backup.service -p Result -p ExecMainStatus
   sudo journalctl -u infraforge-backup --since today --no-pager
   sudo systemctl start infraforge-ops-metrics.service
   sudo systemctl enable --now infraforge-backup.timer infraforge-ops-metrics.timer
   sudo systemctl list-timers 'infraforge-*' --all
   ```

   Require PASS, `Result=success`, exit 0, both required S3 PUTs and confirmed SNS
   email delivery. The daily timer is 02:15 UTC plus up to five minutes jitter.
   Restore time and data size remain Unknown until the following test. Keep the
   monthly full restore timer off this live 4 GiB host unless its extra resources
   have been measured and budgeted. Do the first scratch restore now, then schedule
   monthly owner drills on a separate host or in a maintenance window.

## Restore a backup into a scratch database

Use a separate encrypted disposable Linux host and an operator IAM identity with
read access to the exact S3 object/version. The production instance role remains
upload-only. [Backup retrieval and drill](operations/backup-alerts.md#restore-drill-retrieval-and-incident-handling)
documents S3 retrieval, exact archive members and checksums, and the reusable
`postgres-restore-verify.sh` command. That verifier creates a random empty
`infraforge_restore_*` database, restores with `--exit-on-error --single-transaction`,
reads every application table, and removes only that generated database on exit.

For a copy-paste network-isolated drill after retrieving and safely extracting
`archive.dump` and `SHA256SUMS` to `retrieved-backup`, run on that scratch host:

```sh
set -euo pipefail
docker pull postgres:18
DRILL_IMAGE=$(docker image inspect postgres:18 --format '{{index .RepoDigests 0}}')
DRILL_NAME="infraforge-restore-drill-$(openssl rand -hex 16)"
trap 'docker rm -fv "$DRILL_NAME" >/dev/null' EXIT
docker run -d --pull=never --name "$DRILL_NAME" --network none \
  --memory=384m --cpus=0.25 -e POSTGRES_HOST_AUTH_METHOD=trust "$DRILL_IMAGE"
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$DRILL_NAME" pg_isready -h 127.0.0.1 -U postgres; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
docker exec "$DRILL_NAME" mkdir -m 700 /restore
docker cp retrieved-backup/archive.dump "$DRILL_NAME:/restore/archive.dump"
docker cp retrieved-backup/SHA256SUMS "$DRILL_NAME:/restore/SHA256SUMS"
docker cp ops/bootstrap/postgres-restore-verify.sh "$DRILL_NAME:/restore/verify.sh"
docker exec "$DRILL_NAME" env -i PATH=/usr/local/bin:/usr/bin:/bin \
  RESTORE_DISPOSABLE=local-only bash /restore/verify.sh /restore 5432 postgres
```

Record the image digest, S3 key/version, checksum, PASS and elapsed time privately.
Trust authentication is only for this new `--network none` scratch container.
This proves archive retrieval/readability, not exact equality with a changing live
source or application recovery. A real recovery restores into a new empty server,
recreates roles/permissions and validates login, reports and readiness in isolation
before the owner approves the URL switch. Never restore over the active database.

## Switch to Neon or another PostgreSQL provider

1. Provision PostgreSQL 18 with sufficient connection allowance and trusted TLS.
   If keeping data, fence writes, take a final backup and restore it into the new
   empty database first. **Changing a URL does not copy data.** Verify schema,
   roles, extensions and restore evidence before cutover.
2. Privately edit **only the three URL values** in `/etc/infraforge/release.env`:
   `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`. Use
   `postgresql://ROLE:ENCODED_PASSWORD@HOST:PORT/DB?sslmode=verify-full` for a
   direct endpoint; all may be the same URL. For Neon, API/WS may use its pooler
   URL, while migration/worker must use direct URLs. Leave
   `WORKER_DATABASE_MODE=direct` unless deliberately adopting a verified session
   pooler (`session`). Optional channel binding may be appended if supported.
3. Select a new approved full `main` SHA and run the same `scripts/release.ts apply`
   command above. Preflight verifies all targets reach the same database. No
   provider flag, source edit or Compose edit is required. The local database
   is not started for remote URLs; an already-running local server/volume is
   retained for recovery, never automatically deleted.
4. Verify readiness, authenticated behavior and a first backup. Backups pick up
   the new migration URL at their next start. Do not change any auth secret merely
   to change database providers. Stop the unused local service later only after
   acceptance; retain its volume until the owner's retention decision.

The old Neon-specific `scripts/release/neon.ts` belongs to the historical,
disposable-Neon-clone proof only. Its API-verified branch/endpoint, password-routing
and reset-credential checks remain intact; ordinary releases never invoke it.

Capacity: [BACKEND_CAPACITY.md](../ops/BACKEND_CAPACITY.md) records 2432 MiB /
1.75 CPU for the steady stack, 768 MiB / 0.20 CPU for a release builder, and the
896 MiB / 0.05 CPU arithmetic host allowance during builds. These are ceilings
and allowances, not measured headroom. PostgreSQL shares a failure domain with
the application; daily dumps give up to a one-day RPO, not point-in-time recovery.
Disk, query performance, actual RTO and successful S3 restores remain unmeasured.

References: [PostgreSQL verified TLS](https://www.postgresql.org/docs/18/libpq-ssl.html),
[PostgreSQL image volume layout](https://hub.docker.com/_/postgres), and
[S3 lifecycle expiry](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html).
