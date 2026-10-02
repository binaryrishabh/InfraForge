# Local integration baseline

From `Backend/`, `bun --no-env-file --no-install test tests/integration` runs the safety guards and skips the process test unless `INTEGRATION_RUN=1`.

The process test needs installed dependencies, the existing generated Prisma client, and **fresh disposable local PostgreSQL and Redis services**. It runs the installed Prisma migration CLI against that disposable database, then starts the authored API, worker/simulator, and WebSocket entrypoints. It installs nothing and changes no application configuration.

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

The test takes about 75–100 seconds because it exercises the actual one-minute checkpoint schedule. It checks:

- Saved infrastructure create, read, and explicit update.
- Real HTTP transaction rollback when the outbox insert fails, plus deployment/outbox creation and dispatch.
- Duplicate outbox deliveries retaining one job ID and one ordered set of gates; readiness failure completes a queue job; reserved job ID `0` is rejected by the installed BullMQ queue and exhausts outbox retries.
- Live listing, stage and snapshot envelopes, and exact Redis-to-WebSocket payload delivery.
- Fixed architecture, workload, seed, and recorded command boundaries; initial engine-to-host equivalence without wall-clock metadata comparisons.
- Load, chaos, vertical and pool scaling, speed, pause, topology, saved/live layout separation, disconnect/subscription cleanup, reconnect, and active teardown.
- A real checkpoint and current worker resurrection behavior: the same seed and saved layout restart at tick one, with speed one and reset cost. Persisted checkpoints and live-only topology are **not restored** by the current host.

Commands are sent while paused and their Redis payloads are checked before resuming. The host has no control acknowledgement, so command boundaries describe the last observed tick; they do not claim a durable control log or exact scheduling under arbitrary process stalls. Each advancement asserts its expected tick count, so an unexpected extra tick fails the fixture.

The test writes a JSON evidence file in the OS temporary directory and prints its path. It contains the architecture, workload, seed, control ticks, recorded Redis/WS events, checkpoint, restart snapshot, process IDs and lifecycle timestamps, Redis readiness checks, sanitized process logs, and cleanup results. Keep it as local verification evidence. It does not dump environment variables or credentials.

Cleanup stops only the child processes it started and deletes only its fixture rows. It does not flush Redis, drop/reset databases, remove containers, or change existing migrations. Migration tables and Redis queue keys remain in the disposable services. The caller owns their disposal; every new run needs fresh services/database state. Run serially: fixed WebSocket port 3001 prevents parallel lifecycle tests.
