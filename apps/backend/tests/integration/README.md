# Local integration baseline

## Managed local fixtures

From the repository root, run `bun run test:integration:local` with PowerShell 7,
Docker Desktop and installed workspace dependencies. Have `postgres:18-alpine`
and `redis:8-alpine` available locally first; the runner never pulls images.
It creates fresh loopback-only services with random database/Redis ports, a named
disposable volume and network, a unique run ID and four ownership labels. API port
3100 and WebSocket port 3001 must be free. Existing development containers/data
are not used. `pwsh ./scripts/test-integration.ps1 -SafetyGuardsOnly` runs only the
six harness guard tests with the same resource lifecycle.

Temporary resources follow **Create → Use → Capture Evidence → Verify → Remove →
Confirm Cleanup**. Test evidence (`resources.json`, `stdout.log`, `stderr.log`) stays
in the printed OS temporary directory, outside the containers. Normal completion,
failure and Ctrl+C enter cleanup: stop only owned child processes/containers,
check every ownership label, remove the exact fixtures, then verify no resources
remain for that run. Referenced volumes/networks and mismatched labels are preserved
and reported as errors. Cleanup errors return a nonzero exit code.

A host crash or force-killed PowerShell process can prevent `finally` from running.
Forced termination can also leave Windows Bun/Turbo launcher descendants. Match
their ancestry, command and creation time to the recorded run before stopping them;
an absent parent PID does not prove that every child stopped.
After confirming that the recorded test process and its children have stopped,
select the same local Docker context and run:

```powershell
pwsh ./scripts/test-integration.ps1 -CleanupRun <32-character-run-id>
```

Recovery retains the original evidence and writes a separate cleanup record. Do not
run recovery on an active test. Keep logs/results through review; dispose of redundant
install/build copies afterward. Give temporary build images a unique tag and ownership
labels; remove exact unneeded tags only after checking container references. Shared
development data, common images/caches and resources with uncertain ownership are
preserved. Broad Docker pruning and host-wide disk cleanup are not part of this policy.

## Caller-managed services and CI

From `apps/backend/`, `bun --no-env-file --no-install test tests/integration` runs the safety guards and skips the lifecycle and migration tests unless `INTEGRATION_RUN=1`.

The process test needs installed dependencies, a generated Prisma client, and **fresh disposable local PostgreSQL and Redis services**. Root integration tasks generate the client automatically; before calling `bun test` directly, run `bun run db:generate`. The test applies committed migrations only to its disposable database, then starts the authored API, worker/simulator, and WebSocket entrypoints. It installs nothing and changes no application configuration.

Set these variables explicitly in the test shell:

```powershell
$env:INTEGRATION_RUN = '1'
$env:INTEGRATION_DISPOSABLE = 'local-only'
$env:INTEGRATION_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55432/infraforge_it_0123abcd'
$env:INTEGRATION_REDIS_PORT = '56379'
$env:INTEGRATION_API_PORT = '3100'
bun --no-env-file --no-install test tests/integration
```

These are example service addresses; provision the matching disposable services first. The database name must match `infraforge_it_<8 or more hex characters>`. PostgreSQL must use a loopback host, an explicit user, and no URL options. Its public schema must be empty, with no extra application schemas. Redis must be a dedicated loopback server, initially empty with no Pub/Sub channels. Redis port 6379 is rejected. A separate Redis database number is insufficient because the application uses shared Pub/Sub channels and queue names.

API port 3100 is the default. Port 3000 requires `INTEGRATION_ALLOW_API_3000=yes` and a separately verified disposable setup. The current WebSocket entrypoint always binds port 3001. Both application ports must be free; the harness refuses to replace an existing process. Child processes receive only system path/temp variables and explicit local service settings. Automatic Bun env loading is disabled; dotenv receives a nonexistent temporary file path. Ambient PostgreSQL, dotenv, and runtime injection variables are excluded from child environments. The parent test shell must have no `PG*` environment variables: the harness rejects them before opening any connection, because the installed PostgreSQL client can use ambient settings when a supplied option is empty.

The test takes about 90–120 seconds because it exercises the actual one-minute checkpoint schedule and transient queue retries. It checks:

- Saved infrastructure create, read, and explicit update.
- Real Better Auth database sessions for two users. Cross-user reads, updates,
  deletion, creation, all seven controls and WebSocket subscriptions are rejected.
  Rejections change no domain rows/outbox and emit no simulator controls.
- Origin/CSRF rejection, tampered cookies, session expiry/revocation, actual server
  sign-out, ownerless records/jobs and explicit dry-run-first ownership recovery.
  Session fixtures use the real adapter; no test login endpoint or fake OAuth exists.
- Invalid JSON and oversized bodies returning 400/413, malformed saved/live resources returning 400, and subsequent valid requests still succeeding.
- Real HTTP transaction rollback when the outbox insert fails, plus deployment/outbox creation and dispatch.
- Duplicate outbox deliveries retaining one job ID and one ordered set of gates; readiness failure completes a queue job; reserved job ID `0` is rejected by the installed BullMQ queue and exhausts outbox retries.
- A real transient SQL failure keeping the deployment RUNNING between queue attempts, then recovering without a premature failure event; a later job cannot resurrect a torn-down deployment.
- Editing/corrupting a saved design after creation cannot alter the captured run or its gates. Retry recovery/exhaustion after a completed gate does not duplicate stage or timeline entries. Started notifications can repeat on retries.
- Malformed legacy saved layouts being rejected before deployment creation.
- Notification delivery exhaustion leaving the running simulation LIVE. This briefly disables `PUBLISH` in the dedicated Redis ACL and restores the original command rules in `finally`.
- Live listing, stage and snapshot envelopes, and exact Redis-to-WebSocket payload delivery.
- Repeated subscription messages retaining exactly one Redis subscription per socket.
- Closing during a real Redis-paused pending subscription leaving no subscriber; oversized subscription messages closing with 1009 while the server remains available. The application checks bytes before parsing because Bun 1.3.14 does not enforce the `ws` server's `maxPayload` setting.
- Captured architecture, fully resolved workload and generated/persisted seed; original tick-zero snapshot and exact tick-one engine-to-host equivalence without comparing wall-clock metadata. SQL attempts to overwrite inputs/seed are rejected.
- Load, chaos, vertical and pool scaling, speed, pause, topology, saved/live layout separation, disconnect/subscription cleanup, reconnect, and active teardown.
- Stale and duplicate jobs cannot replace inputs or initialize another simulator. A competing worker cannot acquire the database's session advisory lock.
- Durable live topology revision checks reject stale/concurrent editors. Live edits never change original inputs or the saved design; stale Redis topology messages have no authority.
- Active design deletion is rejected through the API and direct cascade deletion. Creation/deletion races cannot orphan a run; teardown releases deletion only after runtime acknowledgement.
- A real diagnostic checkpoint is preserved across worker crash/restart. Interrupted LIVE runs explicitly fail; they never restart at tick one. Legacy records are not backfilled and historical records are retained.
- Terminating the owned worker's PostgreSQL ownership session stops its process and snapshots; the replacement records interruption explicitly. This is a disposable fixture session, never a development/production connection.
- Applying the authentication migration over the previous SQL schema preserves
  all legacy fields/runs and leaves verified ownership NULL. This check creates and
  drops its own temporary database on the guarded disposable PostgreSQL server;
  it never invents ownership or backfills original inputs.
- The separate B0.2 migration regression still verifies that legacy runs receive
  no reconstructed inputs when the original run-input migration is applied.
- PostgreSQL 18 cutover checks use separate owned migration-eight databases with
  synthetic 28/331/348 records. A SELECT-only role exercises evidence capture;
  baseline drift is deliberately detected. Retirement rejects peers, wrong/missing
  IDs, extra active work, pending outbox and repeated execution. A trigger failure
  proves atomic rollback; successful retirement preserves checkpoints, input fields,
  historical ownership and every unrelated row. The Docker release rehearsal
  separately executes custom-format dump/restore and deliberate restore corruption.

Commands are sent while paused. Load/chaos/scaling/speed Redis payloads are checked before resuming; topology edits instead check the committed database revision. There is no durable acknowledgement/log for the other controls, so their boundaries describe the last observed tick rather than exact scheduling under arbitrary process stalls. Each advancement asserts its expected tick count, so an unexpected extra tick fails the fixture.

The test writes a JSON evidence file in the OS temporary directory and prints its path. It contains captured inputs, control ticks, Redis/WS events, checkpoint and explicit restart outcome, process IDs/timestamps, readiness checks, sanitized process logs and cleanup results. Keep it as local evidence. It does not dump environment variables or credentials.

The lifecycle harness stops only the child processes it started and deletes only its fixture rows. It does not flush Redis, drop/reset its supplied database, remove containers, or change existing migrations. The separate migration check drops only the generated temporary database it created. Migration tables and Redis queue keys remain in the disposable services. The caller owns their disposal; every new run needs fresh services/database state. The managed local runner above supplies and disposes of those services; CI owns its service containers. Run serially: fixed WebSocket port 3001 prevents parallel lifecycle tests.
