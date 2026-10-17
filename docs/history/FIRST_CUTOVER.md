# Historical first-cutover procedure

Retained from deployment documentation at 0bcf74c. These are historical investigation and recovery procedures, not current production state or the normal release path. The owner completed a fresh-database cutover on 2026-10-17. Start with [current deployment](../DEPLOYMENT.md) and [bootstrap](../PRODUCTION_BOOTSTRAP.md). Do not repeat destructive retirement or old-database migration steps on the current fresh production database.

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
Confirm the child identity, then select **that disposable branch only** in Neon's
Roles view and reset every role password that the rehearsal will use. Build its
direct/pooled URLs with those branch-only credentials. Never supply inherited
production credentials or reset a production role for this rehearsal. Roles are
branch-scoped and copied when branching; see [Neon role management](https://neon.com/docs/manage/roles).
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
| `REHEARSAL_CREDENTIAL_ACK` | `disposable-clone-branch-credentials-reset` |
| `REHEARSAL_ISOLATION_EVIDENCE` | Non-secret reference to the verified child identity and branch-only credential reset |

All three URLs must use verified TLS and the same database. API metadata must prove
each endpoint belongs to the disposable child of the independently identified
production branch; same-branch, default/protected, wrong-parent or ambiguous
endpoints are refused. Do not guess production identity from rehearsal credentials.
Real identifiers and credentials are never examples committed to this repository.
The hostname is the only endpoint-routing authority. Decoded password prefixes
`endpoint=` and the deprecated `project=` are refused, including the documented
`;`/`$` routing forms and incomplete directives; harmless partial text is allowed.
Query routing overrides remain forbidden. See [Neon's password-routing documentation](https://github.com/neondatabase/website/blob/main/content/docs/connect/connection-errors.md#d-specify-the-endpoint-id-in-the-password-field).
The tool cannot compare against production passwords, which it must never know.
API branch/parent/endpoint proofs and repeated identity checks remain mandatory.
The rehearsal acknowledgement does not assert production writers stopped; the
production retirement acknowledgement is separate and cannot substitute for it.
The PostgreSQL 18 dump container uses `PGSSLROOTCERT=system` with `verify-full`,
so libpq validates Neon against its system CA store rather than expecting a local
`~/.postgresql/root.crt`. See [libpq TLS settings](https://www.postgresql.org/docs/18/libpq-connect.html#LIBPQ-CONNECT-SSLROOTCERT).
Its branch-only password is in a private temporary libpq password file, mounted
read-only and copied to mode 0600 inside the dump container (Docker Desktop mounts
can report 0777 despite host chmod), rather than `PGPASSWORD` in configuration/inspect. API/WS receive
the API URL, worker its direct URL, and migration the URLs needed for target checks.
These necessary service URLs are still visible to the local Docker administrator;
restrict host/Docker access and capture output privately. The API key and operator
acknowledgements are not forwarded to children.

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
   workflow. Do not rely on reset/rotation behaviour for existing sessions; provider
   documentation differs. Explicit session inspection/termination and rechecks below
   remain mandatory, regardless of whether reset itself disconnects clients.
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
transaction-local settings (including UTC), then deterministic NOWAIT table locks
precede every query that fixes the snapshot; row locks protect the selected records.
Version/history/worker/client/outbox checks follow the table lock. Any mismatch rolls
everything back. Operator timeline and update timestamps use UTC. Exactly
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
Before primary cutover, separately review rules/pg_rewrite, types/domains/enums,
owners/default privileges, inheritance, publications, role/database settings and
sequence parameters. The disposable baseline checker does not certify these.

Run final idle/history/baseline/session/backup preflight, then the approved exact-SHA
release for migrations 9/10 and postchecks. Require 28 ownerless historical designs,
historical `test-user`, no live legacy runs, matching guards, direct single worker and
API/WS/worker/dependency readiness. Deploy backend, stage same-site frontend from the
same SHA, complete real OAuth/session/ownership/run smoke, then promote frontend.
No legacy image is eligible for container rollback after this schema/auth cutover.
Failure means continued maintenance and owner-approved forward repair or tested
database fallback; never reconnect an old worker automatically or resume checkpoints.
