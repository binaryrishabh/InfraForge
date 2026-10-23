# First-stack queue recovery and retained storage

Verification remains OFF until the existing activation/qualification gates pass.
These operations never resume uncertain execution or mark work verified.

## Operator observation

The dedicated verifier binds `127.0.0.1:3003` only. Poll
`curl --fail http://127.0.0.1:3003/health/operations` from that host, at most once
per minute. Never proxy this route through nginx or a public API. Existing
`/health/ready` remains the dependency/qualification admission gate. Metrics are
not included in the browser engine-availability record.

The operator response contains numeric aggregates only:

- Redis waiting/active/delayed and retained completed/failed counts;
- oldest queued age and oldest undelivered age (`deliveryLagMs`), across
  submissions and replays; NULL means no such pending row;
- maximum measured delivery latency over 30 days; historical delivery timestamps
  were not recorded, so missing measurements remain NULL;
- current recovery reservations and failed/stalled/reconciled events over 30 days.
  Events are observations, not distinct-run counts, and do not survive losing
  PostgreSQL. A dependency/query failure returns HTTP 503 with unknown (null)
  metrics, never fabricated zero counts;
- recorded reservation bytes across all history, current live reservation bytes,
  complete retained run/cut/result/replay JSON bytes and physical storage bytes.
  Result JSON includes the **full hidden scored audit**, and repeated serial cuts
  each count. Values disclose sizes only, never inputs, rubric details or errors.

Alert on any recovery reservation, any new failed/stalled event, delivery lag
over 15 seconds, or oldest queued age over 60 seconds. The latter is a triage
threshold, not a promised verification latency. Alert if storage `warning` is
true (80% of the finite-pilot history ceiling); stop admitting new work at the
ceiling. Record measured disk free space separately: database allocation is not
free disk, WAL, backup, or Redis memory usage. A missing scrape is an alert.
No paging integration or host throughput measurement is claimed by this change.

## Delivery loss and failure

One attempt and zero stalled retries remain enforced. Each delivery poll checks
delivered **queued** submission/replay rows against their stable Redis IDs.
A missing, failed or completed job is quarantined. Waiting/active/delayed jobs
are left alone. Redis lookup errors fail the poll and readiness; they are never
interpreted as a missing job. Worker and reconciliation use the same transaction
lock and conditional queued claim, so a real worker claim wins safely.

Quarantine atomically captures a fresh submission token/current trusted daemon,
then moves running to recovery, **without launching Docker**. Replays use their
existing replay ID as token. This uses the unchanged SQL state/evidence guards;
the transient running claim is only a reservation fence, not evidence of an
execution. A subsequent Redis delivery sees recovery and cannot execute it.
No result is appended, no capacity is released and no automatic redispatch is
performed. Startup separately quarantines previously running work as before.

Operational event receipts contain only event kind and time and expire after
30 days during polling. This deletes no run, cut, result, replay or review.
Redis terminal jobs are expendable transport diagnostics: successes retain at
most 128 / one day; failures at most 256 / 30 days. BullMQ removes lazily on
terminal transitions; a minute maintenance pass also removes expired/excess
legacy jobs in batches of 256. Existing oversized sets converge over successive
passes. Maintenance never removes waiting/active/delayed jobs. During downtime,
cleanup pauses; PostgreSQL remains the authoritative record.

## Offline recovery and release

1. Disable admission; stop `first-stack-verifier.service` and confirm the old
   supervisor/executor stopped. Stop any independent executor using the same DB.
   Inspect Redis/dependencies before attributing a missing delivery to loss.
2. From the immutable installed host workspace, inspect reservations with the
   packaged operator command below. It prints captured IDs/tokens/daemon/image
   and latest fingerprints, not hidden payloads. Reconcile any still-undelivered
   work by restoring dependencies and running the normal supervisor first, or
   use the existing owner cancellation path for queued work. Never edit outbox
   flags or force state with SQL.
3. Follow `FIRST_STACK_ISOLATION.md` to inspect the exact daemon, pinned image,
   fixed container name and token label. Remove only the verified stopped owned
   container. A quarantine token may have no container: record `not-created`
   only after checking that exact daemon and confirming no uncertain orphan.
   Preserve the committed prefix and original input. Unknown cleanup remains
   recovery. A failed job or empty Redis key alone is insufficient proof.
4. Root installs an operator-reviewed JSON file readable by the dedicated
   service account, for example `/opt/infraforge/recovery-review.json`. Submission
   review fields: `token`, `daemon`, `image`, `cleanup` (`removed` or
   `not-created`), `reviewer`, `proof`. Replay review uses `token` equal to the
   replay UUID, `daemon`, `cleanup`, `reviewer`, `proof` (no `image` field).
   Do not put database credentials in review files or shell arguments.
5. Run the appropriate closure command. Both helpers now acquire transaction
   locks for the lifecycle and executor before reading/committing recovery. A
   live owner, mismatched identity or missing review refuses. Submission closure
   appends only `interrupted`; replay closure records only `Unavailable`.
   Ordinary evidence now leaves 4 KiB inside the unchanged 32 MiB capture ceiling
   for this reviewed receipt. Existing pre-migration rows that already consumed
   that reserve may still refuse; retain recovery and escalate, without editing
   immutable evidence or disabling guards.
6. Repeat inspect, require no outstanding reservations, then run the existing
   release preflight/postcheck. Requalify exact installed source/image/daemon
   before restarting. Readiness and the release rehearsal's existing `mustFail`
   cases remain mandatory. Historical reads remain available while disabled.

Use the installed Bun 1.3.14 and protected systemd credential, never a URL on the
command line. Run from the root-owned release workspace:

```sh
sudo systemd-run --wait --pipe --collect --uid=infraforge-verifier \
  --working-directory=/opt/infraforge/verifier-release \
  --property=LoadCredential=database-url:/etc/infraforge/verifier/database-url \
  /usr/local/bin/bun --no-env-file --no-install \
  apps/backend/release/firstStackOperations.ts inspect
```

Replace `inspect` with `close-submission RUN_UUID
/opt/infraforge/recovery-review.json` or `close-replay REPLAY_UUID
/opt/infraforge/recovery-review.json`. This command is included by the existing
backend release-directory Docker copy and the release entrypoint/permission
bundle checks. Host systemd behavior still needs Linux operational validation.

## Capacity and proposed history policy

Only nonterminal work (queued/running/recovery) reserves its input + 32 MiB
capture + 4 MiB metadata against live capacity (2 GiB). Outstanding replays
reserve 32 KiB each for their bounded result/metadata. Terminal and private rows
consume zero live capacity. Their actual bytes remain charged as history.

The finite pilot also caps `max(full retained JSON bytes, physical relation
bytes) + live reservations` at 2 GiB. Admission reserves the next run's full
envelope even for private submissions, conservatively covering its immediate
storage. Replays charge 32 KiB. This deliberately double-counts some live input
bytes to preserve headroom. Physical relation bytes include indexes and TOAST;
vacuum/bloat may keep this charge high after existing account operations.
It is a software admission limit, not a database disk guarantee. Provision
additional free space for PostgreSQL/WAL, ordinary application data, backups,
Redis and maintenance. Measured footprint/arrival rate/time to full remain
Unknown until the intended-host pilot records them.

Proposed policy consistent with `docs/legal/privacy-policy.md`: account-linked inputs,
results, cuts, full audits, immutable reviews and report/idempotency records stay
available for the account lifetime; requests for deletion use the existing
account-deletion process. Operational logs have a 30-day rolling window; backups
use the documented planned 28-day rotation once installed, not a claim of active
backups. Redis diagnostics are bounded expendable
copies, not account history. Existing deletion anonymizes profiles and revokes
access while immutable run evidence remains; permanent history erasure/archive
and corresponding legal wording require owner/legal agreement. This task does
not add account-history deletion, archive, TTL or a new promise of erasure.

At 80%: disable new pilot invitations, inspect growth by byte category and daily
physical/free-disk observations, and plan storage expansion. At full: refuse new
work (including private history), keep reads/cancellation/recovery available,
and expand storage only through a reviewed limit/release change. Do not purge
or rewrite immutable history, omit hidden audits from accounting, or keep
increasing limits without measured disk/backup headroom. This remains a finite
pilot until an owner-approved long-term archive/deletion design exists.
