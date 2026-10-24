# PostgreSQL backups to R2 and independent alerts

This is an owner-run installation procedure. Repository validation accessed no
host, bucket, database or secret. Daily off-host snapshots are mandatory for
self-hosted PostgreSQL. The recovery point is up to one day; database size, restore
time and successful production retrieval remain **Unknown** until measured.
There is no automatic production restore.

The owner selected Cloudflare R2 so loss of the AWS account cannot erase these
backups. **Do not deploy `ops/backup-alerts/stack.json`.** It is optional legacy
AWS-only infrastructure, retained for reference and template validation. The
current runner does not use its policy, lifecycle, CloudWatch or SNS. Replace old
scripts/configuration and verify a new remote receipt; an old S3 receipt is not
evidence of an R2 upload. Receipts are bound to endpoint/bucket/region; changing
the target requires fresh daily and weekly uploads, and old receipts cannot pass
the status check or start a restore drill against the new target.

## Storage and safety

AWS CLI v2 acts solely as an S3-compatible client. Configuration requires an
explicit HTTPS `endpoint_url`, `bucket` and `region` (`auto` for R2). The endpoint
is an origin without a bucket path, credentials, query or fragment. There is no
AWS endpoint or instance-role fallback. Other compatible services must implement
the same conditional PUT, HEAD/GET and list/delete operations. This pruner targets
unversioned R2 objects; versioned AWS storage needs its own version-retention design.

Each run writes `backups/daily/YYYY-MM-DD-<random>.tar`. The first successful run
of an ISO week also writes `backups/weekly/YYYY-Www-<random>.tar`. Unique names
allow retries after partial failures; every PUT uses `If-None-Match: *` and
refuses overwrites atomically. Keep both prefixes exclusive to this runner;
never manually replace these objects or run another writer against them.

Only `archive.dump` and `SHA256SUMS` enter the tar. Single PUTs are limited to
5,000,000,000 bytes. Content-MD5 checks transport, followed by a remote GET and
SHA256 comparison against the uploaded tar. R2 encrypts storage at rest; the
runner omits AWS-only SSE-S3 headers and unsupported full-object SHA256 request
checksums. This is not client-side encryption. The required R2 bucket age locks
below enforce minimum retention at the storage boundary. See the official
[R2 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) reference.

After verified uploads, explicit retention prunes objects **strictly older than
28 days**, using remote `LastModified`. Only exact daily/weekly tar key shapes
are accepted, including historical names without the random suffix. Listing is
restricted to those two prefixes, at most four pages of 1,000 entries per prefix.
The full plan is checked before deletion. More than 128 candidates, unexpected
keys, invalid timestamps or incomplete pagination fail the job. Each candidate's
age is checked again with HEAD immediately before deletion. Objects exactly 28
days old remain until a later run. There is no broad bucket delete, automatic
budget increase or AWS lifecycle dependency. HEAD is only a change check: it does
not protect against clock skew or replacement before DELETE. Required bucket
age locks protect the object storage actually sees. Failed jobs or a stopped host delay
pruning; this is a job-based retention window, not an expiry guarantee.

The success receipt advances only after required uploads, readbacks and pruning
succeed. Failure retains the previous receipt/local dump. Interrupted work is
cleaned beneath the private backup root on the next run. Encrypted local storage
needs room for the previous dump, new dump, tar, remote readback and restored DB.
Never share dumps, credentials, source URLs or private diagnostics in logs/tickets.

## Owner: create the bucket and keys

1. In Cloudflare **R2 Object Storage**, create one dedicated **Standard** bucket.
   Keep public access, `r2.dev` and public custom domains disabled.
2. Under **Manage R2 API tokens**, create an **Object Read & Write** token scoped
   to **only this bucket**, as already decided by the owner. Never select all
   buckets or account administration. Verification/restore need read; retention
   needs list/delete. Prefix restrictions are code guards, not token restrictions;
   keep unrelated data in other buckets.
3. Save the S3 Access Key ID and Secret Access Key privately. Copy the account's
   S3 API endpoint, including a jurisdiction hostname if applicable, usually
   `https://<account-id>.r2.cloudflarestorage.com`. See
   [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/).
4. Preserve independent Cloudflare account recovery access. Rotate a lost token
   in Cloudflare and replace the private file below; never print it to inspect it.

### Required storage age locks before destructive pruning

In **R2 → this bucket → Settings → Bucket lock rules**, add two **enabled age**
rules: `backups/daily/` for **28 days (2,419,200 seconds)** and `backups/weekly/`
for the same duration. Longer age locks are accepted, but can delay pruning.
Do not use date-based or disabled rules as substitutes. Cloudflare documents
that [bucket locks protect existing/new objects against deletion and overwrite](https://developers.cloudflare.com/r2/buckets/bucket-locks/).
Keep these rules enabled; a host clock error or replacement between HEAD and
DELETE must still be rejected by storage while the affected object is young.

`prune_enabled` defaults to **false**. Even when explicitly enabled, every
destructive prune must verify live age-rule coverage through Cloudflare's fixed
[GET bucket lock rules API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/methods/get/).
Missing/short/disabled rules, endpoint/account mismatch, API failure or unreadable
credentials fail the job before any HEAD/DELETE. Dry run works while disabled
and does not establish protection. A backup cannot advance its success receipt
until required retention verification/pruning succeeds. Generic S3 uploads and
retrieval still work, but destructive pruning is supported only for verified R2.

Keep the existing **Object Read & Write storage token scoped to this one bucket**.
It cannot call Cloudflare's configuration REST API. Verification needs a separate
**Workers R2 Storage Read / Admin Read only** API bearer token, restricted to the
selected account, in `/etc/infraforge/ops/r2-lock-read.token` (root:root 0600).
Cloudflare's [permission documentation](https://developers.cloudflare.com/r2/api/tokens/)
states that configuration read permission is account-scoped and also permits
object reads in that account: it is broader than the one-bucket object token.
Provision this distinct read-only credential only after reviewing that scope;
do not grant configuration write/admin-write or broaden the original storage
token. Without it, leave destructive pruning disabled. This change provisions
no token or account permission. The bearer is read only by the fixed HTTPS
control request, rejects redirects, and is never passed to AWS/DB/Docker or argv.

After installing the scripts/private directories in the host section below,
create the empty file, then enter the single literal
bearer token privately in the editor (never shell commands or environment dumps):

```sh
sudo install -o root -g root -m 0600 /dev/null /etc/infraforge/ops/r2-lock-read.token
sudoedit /etc/infraforge/ops/r2-lock-read.token
sudo /bin/bash /opt/infraforge-ops/backup-alerts/run.sh verify-retention-locks
```

Do not use the empty-file install command during rotation. The verification
derives account/jurisdiction from the configured R2 endpoint and uses the exact
configured bucket. Require `VERIFY-RETENTION-LOCKS PASS` before opting in.

**Owner acceptance check (live storage, not performed by offline tests):** In
the dashboard upload a tiny harmless fixture to each backup prefix using the
recognized `YYYY-MM-DD-<32 random lowercase hex>.tar` daily or
`YYYY-Www-<32 random lowercase hex>.tar` weekly shape. Record these exact keys
privately as acceptance fixtures, never restore sources or success receipts.
Immediately attempt to delete each: storage must refuse, and each object must
still exist. Check the enabled 28-day rules again. If either deletion succeeds,
stop; do not enable pruning. Protected fixtures remain for 28 days and the normal
bounded prune can later remove them. Only after both refusals and successful
live rule verification set `prune_enabled: true` in private `config.json`, then
run the first backup below. A local timestamp or another HEAD is not evidence
of server-enforced retention.

R2 Standard includes 10 GB-month storage, 1 million Class A and 10 million Class B
operations monthly, with no egress charge; allowances are shared with other
account usage. See [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
Roughly 28 daily plus four weekly copies are retained, with extra copies from
retries and temporary overlap. At 300 MB per tar, 32 copies alone use 9.6 GB;
this is planning arithmetic, not measured size or a spending cap. Check account
usage and first archive size before enabling unattended backups. Total cost is
Unknown; the 5 GB object guard is not a free-tier guard.

## Owner: install on the host

Use a reviewed immutable checkout after merge/CI. These are owner instructions,
not repository validation commands. The Linux host needs Python 3.11+,
PostgreSQL **18** clients, Bash, GNU coreutils, `flock`, Docker, and current AWS
CLI v2 supporting `put-object --if-none-match`. Install clients without starting
a second DB service. Use the [signed CLI installer](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
if needed; no AWS account or `aws configure` is required.

```sh
pg_dump --version
pg_restore --version
aws --version
sudo install -d -m 0755 /opt/infraforge-ops/backup-alerts /opt/infraforge-ops/bootstrap
sudo install -m 0644 ops/backup-alerts/runner.py /opt/infraforge-ops/backup-alerts/
sudo install -m 0755 ops/backup-alerts/run.sh /opt/infraforge-ops/backup-alerts/
sudo install -m 0644 ops/bootstrap/postgres-backup.sh ops/bootstrap/postgres-restore-verify.sh ops/bootstrap/prove-backup.sh ops/bootstrap/postgres-backup-proof.sh ops/bootstrap/backup-proof-isolation.test.sh /opt/infraforge-ops/bootstrap/
sudo install -d -o root -g root -m 0700 /etc/infraforge/ops /var/lib/infraforge-ops
sudo install -o root -g root -m 0600 ops/backup-alerts/config.example.json /etc/infraforge/ops/config.json
sudoedit /etc/infraforge/ops/config.json
sudo install -o root -g root -m 0600 /dev/null /etc/infraforge/ops/r2.credentials
sudoedit /etc/infraforge/ops/r2.credentials
```

The last install command creates an empty credentials file: use it only for
initial installation, not rotation. Enter this structure **only in sudoedit**,
replacing placeholders with the R2 keys. Never put keys in shell commands,
environment dumps, service `Environment=`, arguments or journal:

```ini
[default]
aws_access_key_id=REPLACE_PRIVATELY
aws_secret_access_key=REPLACE_PRIVATELY
```

Exact path: **`/etc/infraforge/ops/r2.credentials`**, root:root, **0600**, under
the root-owned **0700** directory. The runner refuses symlinks, wrong owner/mode
and extra profiles/keys. It supplies keys only to the S3 subprocess. DB/restore
processes receive neither key; ambient AWS profiles and metadata are disabled.
Check metadata only with `sudo stat -c '%U %G %a %n' /etc/infraforge/ops/r2.credentials`.

The daily backup uses the same literal `MIGRATION_DATABASE_URL` as the release.
The service requires Docker and starts after it. For the private local endpoint,
the runner retries missing-container or SQL connection failures for 180 seconds
(each Docker/SQL call is capped at 10 seconds), revalidates the owned internal
bridge on each attempt, and requires an authenticated `SELECT 1` before dumping.
An ownership/network mismatch fails immediately. Exhausting startup recovery
fails the job without advancing its receipt or deleting the prior archive; the
independent monitor retains failed/missing-backup status and the 26-hour age check.
During provider changes, pause the backup timer before editing the URL and resume
it only after release acceptance and the first successful backup, as described in
[the provider-switch procedure](../SELF_HOSTED_POSTGRES.md#switch-to-neon-or-another-postgresql-provider).
For any remote provider use a direct endpoint with `sslmode=verify-full` and a
certificate trusted by the system CA store. Optional `channel_binding=require`
is retained if requested; it is not a provider-wide requirement. No pooler host,
routing option, duplicate query option or weaker TLS mode is accepted. Credentials
must be percent-encoded. Keep the URL on one `MIGRATION_DATABASE_URL=...` line;
single/double quotes are allowed, interpolation and whitespace are refused.

Set `endpoint_url`, the one `bucket`, `region: "auto"`, public site/API readiness
URLs, active worker container name and approved `drill_image`
(`postgres:18@sha256:<digest>`) in `config.json`. Pre-pull/inspect that image on
the drill host; the synthetic proof also uses its `postgres:18` tag. Set
`alert_email` to the operator mailbox or leave empty for status-only monitoring.
No credential belongs in `config.json`.

Systemd `LoadCredential` supplies the existing literal `MIGRATION_DATABASE_URL`
from `/etc/infraforge/release.env`. Local PostgreSQL resolves only the owned
internal Compose service; remote databases need direct verified TLS. Never source
or print `release.env` or export a source URL in shell history.

## First backup and alerts

```sh
sudo install -m 0644 ops/backup-alerts/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo /bin/bash /opt/infraforge-ops/backup-alerts/run.sh prune-dry-run
sudo systemctl start infraforge-backup.service
sudo systemctl show infraforge-backup.service -p Result -p ExecMainStatus
sudo journalctl -u infraforge-backup --since today --no-pager
sudo systemctl start infraforge-ops-metrics.service
sudo /bin/bash /opt/infraforge-ops/backup-alerts/run.sh status
sudo systemctl enable --now infraforge-backup.timer infraforge-ops-metrics.timer
sudo systemctl list-timers 'infraforge-*' --all
```

Require `BACKUP PASS`, `Result=success`, exit 0 and `STATUS PASS`. Daily runs start
at 02:15 UTC plus up to five minutes jitter. In **Cloudflare → R2 → the bucket →
Objects**, open `backups/daily/` and `backups/weekly/`. Match the exact keys from
root-private `/var/lib/infraforge-ops/backup.json`, UTC time and sizes; both
first-run objects must exist. Dashboard visibility is not a restore proof.

The minute timer writes local observations and checks backup **and restore**
health without CloudWatch/SNS. Backup failure, missing/invalid/future receipts or age over 26 hours
writes `ok: false` to **`/var/lib/infraforge-ops/ops-status.json`** and a generic
journal message. Failure remains latched even with a fresh previous receipt.
Systemd pre-start/stop hooks cover lock refusal, timeout, SIGKILL and service
failure; interrupted running markers become unhealthy after 46 minutes.

An existing failed, interrupted or corrupt `drill.json` also makes status
unhealthy and sends a restore-specific alert, even if the backup is fresh or
a later backup succeeds. Only a successful restore drill clears that latch.
The example uses `restore_drill_required: false`: a deliberately disabled timer
does not require a nonexistent drill, and a past successful drill does not expire.
It still never hides a known failed attempt. If a scheduled monthly drill is
enabled, set `restore_drill_required: true` and
`restore_drill_max_age_days: 35` (integer 1–366). Then missing drills and passes
older than that interval are unhealthy too. `status` checks this predicate live;
it cannot pass using an old healthy monitor snapshot after a restore failure.

If existing literal release settings are `TRANSACTIONAL_EMAIL_PROVIDER=resend`,
`TRANSACTIONAL_EMAIL_FROM=<verified mailbox>` and `RESEND_API_KEY=<key>`, and
`alert_email` is configured, the runner uses the same
[Resend API](https://resend.com/docs/api-reference/emails/send-email).
Only these three mail settings are parsed from the private systemd credential.
Email distinguishes backup and restore failure without DB/bucket details. Sent alerts repeat
at most hourly while unhealthy; failed/unconfigured delivery retries at most
every 15 minutes. A newly changed failure reason alerts immediately, even during
the prior reason's suppression interval. `alert_delivery` records `sent`, `failed` or `unconfigured`;
`sent` means API acceptance, not confirmed inbox delivery.

Without Resend, **connect an independent uptime monitor to the operator command**
`sudo /bin/bash /opt/infraforge-ops/backup-alerts/run.sh status`, for example through
an existing restricted SSH check. Exit 0 requires a fresh successful backup,
restore health under the policy above, and a healthy monitor observation no
older than three minutes. Exit 1 or inability to
reach the host must alert. Only generic PASS/failure text is emitted; the private
JSON is never served publicly. This change installs no public HTTP route or
external monitor. Application readiness alone cannot detect backup failure.
The independent checker must also detect host/account loss: a lost host cannot
send email.

Test alerts on a fresh host **before** its first backup: configure/start
`infraforge-ops-metrics.service` and require missing-receipt failure status and
mail if configured. Inspect private `alert_delivery` and confirm inbox delivery.
Then run the first backup and require `STATUS PASS`. Do not damage a working DB
or credentials for an alert test. Failed mail delivery never clears failure.

## Restore drill, retrieval and incident handling

Use a **separate encrypted disposable Linux host**, not the live 4 GiB backend,
for the first restore and periodic owner drills. Install scripts/client and
private config as above, but use a separate bucket-scoped **Object Read** token
in its own 0600 credentials file. Keep the production token off this machine.
`retrieve` checks size, ETag-pinned download, exact regular tar members and dump
SHA256. Select an exact daily key from the dashboard; the destination must not exist:

```sh
read -r -p 'Exact R2 daily backup key: ' BACKUP_KEY
sudo /bin/bash /opt/infraforge-ops/backup-alerts/run.sh retrieve "$BACKUP_KEY" /var/lib/infraforge-ops/retrieved-backup
```

Then follow [the scratch database commands](../SELF_HOSTED_POSTGRES.md#restore-a-backup-into-a-scratch-database).
The verifier creates a random empty DB, runs `pg_restore --exit-on-error
--single-transaction`, reads every application table and drops only that generated
DB. Record bucket/key, image digest, checksum, PASS and elapsed time privately.
This proves remote archive readability, not application recovery or equality
with a changing source.

The optional monthly `infraforge-restore-drill.service` also retrieves the latest
daily key from R2 before synthetic refusal checks and a restore in a new
network-isolated container. It uses no source DB credentials. Keep its timer off
on the live 4 GiB host unless resources have been measured/budgeted. Use a
suitable host/maintenance window with matching private receipt/configuration;
require `drill.json` with `ok: true` and PASS. No Docker drill was executed here.
The drill unit reads only the required literal mail settings from its private
systemd credential for immediate failure notification; Docker/restore children
still receive neither database-source nor mail/storage credentials.

On failure inspect unit status, disk, private config and token permissions,
then rerun once. Never edit success receipts to clear failure. A successful
backup clears its latch; a successful drill clears its drill latch. For prune
bounds/unexpected keys, review contents and dry run; never broaden prefixes or
budgets just to pass. Never run broad Docker prune; inspect only recorded owned
random containers. A real recovery restores into a new empty server, recreates
roles/settings, validates login/reports/readiness in isolation, and requires
owner cutover approval. Never restore over the active database.

## Offline validation

```sh
python3 -B ops/backup-alerts/test_runner.py
python3 -B ops/backup-alerts/test_mutations.py
bash -n ops/backup-alerts/run.sh
shellcheck ops/backup-alerts/run.sh
bun --no-env-file --no-install test scripts/tests/backup-alerts.test.ts
```

Tests prohibit sockets and mock external commands/mail. They cover endpoint and
credential policy, conditional uploads, readback corruption, size limits, prune
bounds/dry run/age, live lock-verification refusal, simulated storage enforcement
under clock skew/replacement, failed/missed backups, failed/overdue remote drills,
mail failure, stale monitoring and remote restore corruption/isolation/cleanup.
The mutation suite makes all eight escaped review changes fail their targeted
regressions in memory; an unrelated fixture error is not accepted as detection.
The Bun wrapper also validates
legacy AWS template invariants; CI retains cfn-lint. No production upload,
deletion, delivery or restore result is claimed by these offline checks.
