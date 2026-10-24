# Backups and email alerting

This is an owner-operated installation procedure, not a record of an installed
system. The repository changes create no AWS resources, contact no database and
install no host services. Self-hosted PostgreSQL has no managed restore history; these daily off-host
snapshots are mandatory. For a managed provider, separately verify its actual
restore-history window. The independent backup RPO
is up to one day. Recovery time and actual database size are **Unknown** until
measured. There is no automatic production restore.

The configuration lives in `ops/backup-alerts/stack.json`, `runner.py`, `run.sh`
and `systemd/`. It reuses `ops/bootstrap/postgres-backup.sh`,
`postgres-restore-verify.sh` and `prove-backup.sh` without modifying them.

## Storage, access and retention

CloudFormation creates an unnamed private bucket in the stack's region with
SSE-S3 default encryption, versioning, owner-enforced ownership, all four Block
Public Access switches, a TLS-only policy and retained deletion/replacement
policies. Uploads explicitly request AES256 and a SHA256 transport checksum.
Only the archive and its byte-exact SHA256SUMS receipt enter the tar object;
private database diagnostics are excluded. SSE-S3 is encryption at rest, not
client-side encryption or Object Lock.

One successful backup per UTC date is stored at
`backups/daily/YYYY-MM-DD.tar`. The first successful backup of each ISO week is
also uploaded at `backups/weekly/YYYY-Www.tar`; missed Monday runs therefore
catch up later in that week. Daily and weekly objects expire after 28 days, matching the backup window in
the legal drafts, targeting 28 daily plus 4 weekly copies during healthy operation.
Lifecycle expiry is asynchronous and rounds to UTC day boundaries: these are
age windows, not an exact object count or a guarantee when jobs fail. Retrying
the same date/week creates a version; noncurrent versions expire after one day
and expired delete markers are cleaned up. Budget for temporary overlap. No host
retention process deletes S3 objects.

The added host policy grants only `s3:PutObject` to the two backup prefixes and
`cloudwatch:PutMetricData` restricted to `InfraForge/Ops`. It grants no S3 read,
list, delete, multipart or role-assumption access. IAM permissions are additive:
the owner must remove pre-existing wider grants or use a dedicated EC2 role.
The uploader uses single PUTs, refuses tar objects above 5,000,000,000 bytes and
does not silently request broader permissions for larger databases.

The local latest archive and temporary working copies contain production data.
They require encrypted EBS, root-owned mode-0700 state, and disk headroom for
the previous dump, next dump, its tar, and a disposable restored database. The
next run removes interrupted dump directories; the last successful local copy
is retained until its replacement uploads successfully. Never share its contents
or private diagnostics in tickets or logs.

## Owner's one-time AWS steps

1. In **EC2 → Instances**, select the host. Record its **region**, instance ID
   and IAM role name (not the instance-profile name). Confirm every volume
   containing `/var/lib/infraforge-ops`, `/tmp` or Docker data is encrypted under
   **EBS → Volumes → Encryption**. Do not proceed with plaintext local staging.
   Confirm the host really uses Ubuntu 24.04, Docker Compose and systemd.
2. In **IAM → Roles → the host role → Permissions**, audit attached and inline
   policies and bucket grants. Ensure no other policy grants S3 read/list/delete
   or writes outside the backup prefixes. Keep existing application permissions
   only after reviewing them. Do not give the instance administrative credentials.
3. Switch the **CloudFormation console to that same EC2 region**. Choose
   **Create stack → With new resources → Upload a template file** and upload
   `ops/backup-alerts/stack.json`. Name the stack `infraforge-backup-alerts`.
   Set `HostRoleName`, `InstanceId`, and `AlertEmail` to the recorded values and
   the owner's alert address. Review the change set, acknowledge named IAM
   capabilities, and create it. CloudFormation creates storage, policies, SNS and
   alarms only; it does not modify EC2, Compose, Neon or application code.
4. Wait for **CREATE_COMPLETE**. Record the `BucketName`, `Region`, and
   `TopicArn` outputs. In **SNS → Subscriptions**, confirm the email subscription
   by following the email sent to the owner. It must show a subscription ARN,
   not `PendingConfirmation`. No alarms can deliver email before confirmation.
5. In **S3 → the new bucket → Properties/Permissions/Management**, check SSE-S3,
   versioning, Block Public Access, TLS policy and all three lifecycle rules.
   In **CloudWatch → Alarms**, expect seven alarms. Initial missing-data alarms
   are expected until the metrics publisher, first backup and first drill pass.

## Owner's one-time host steps

Run these only after separately approving the AWS/host installation. Use a
reviewed immutable source checkout; do not run them during repository validation.
The host needs PostgreSQL **18** clients, Python 3.11+, GNU coreutils, `flock`,
AWS CLI v2, Docker and Bash. Install the clients without creating a local database
service. Ubuntu commands for the PostgreSQL upstream package repository are:

```sh
sudo apt-get update
sudo apt-get install -y postgresql-common ca-certificates python3 unzip
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-client-18
pg_dump --version
pg_restore --version
aws --version
docker version
```

If AWS CLI v2 is absent, follow the official signed Linux x86_64 installer
[instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
Use the existing EC2 instance profile through IMDS; **do not run `aws configure`**
or put AWS access keys on the host. The runner clears ambient credentials and
profiles and uses only that role. For a remote database, the host must reach PostgreSQL over verified TLS and S3,
CloudWatch, the public site and API over HTTPS. Prefer the existing S3 gateway
endpoint if present; this stack creates no endpoint, NAT gateway or network rule.

From the reviewed checkout root:

```sh
sudo install -d -m 0755 /opt/infraforge-ops/backup-alerts /opt/infraforge-ops/bootstrap
sudo install -m 0644 ops/backup-alerts/runner.py /opt/infraforge-ops/backup-alerts/
sudo install -m 0755 ops/backup-alerts/run.sh /opt/infraforge-ops/backup-alerts/
sudo install -m 0644 ops/bootstrap/postgres-backup.sh ops/bootstrap/postgres-restore-verify.sh ops/bootstrap/prove-backup.sh ops/bootstrap/postgres-backup-proof.sh ops/bootstrap/backup-proof-isolation.test.sh /opt/infraforge-ops/bootstrap/
sudo install -d -m 0700 /etc/infraforge/ops /var/lib/infraforge-ops
sudo install -m 0600 ops/backup-alerts/config.example.json /etc/infraforge/ops/config.json
sudoedit /etc/infraforge/ops/config.json
```

Replace every placeholder with the stack outputs, host ID and actual public
HTTPS URLs. The API URL must end at its `/health/ready` route. Set
`worker_container` to the exact active Compose worker container name, discovered
with `docker ps --format '{{.Names}}'`. Update this setting if release tooling
replaces the worker with a different name. No worker port is published.

Pre-pull and approve the PostgreSQL 18 image during installation:

```sh
sudo docker pull postgres:18
sudo docker image inspect postgres:18 --format '{{index .RepoDigests 0}}'
```

Set `drill_image` to `postgres:18@sha256:` followed by that digest. Keep the
`postgres:18` tag pointing to the same approved PostgreSQL 18 image because the
unchanged synthetic proof uses that tag. Reapprove/update both regularly; the
actual snapshot drill uses `--pull=never` with the pinned digest. The synthetic
proof and snapshot restore run sequentially: their database limits are 1 CPU /
768 MiB and 0.25 CPU / 384 MiB respectively. Account for production memory and
Docker disk headroom on the 4 GiB host before enabling the drill. The unit's
MemoryMax bounds the client processes, not Docker-daemon-created containers.

The daily backup uses the same literal `MIGRATION_DATABASE_URL` as the release.
For any remote provider use a direct endpoint with `sslmode=verify-full` and a
certificate trusted by the system CA store. Optional `channel_binding=require`
is retained if requested; it is not a provider-wide requirement. No pooler host,
routing option, duplicate query option or weaker TLS mode is accepted. Credentials
must be percent-encoded. Keep the URL on one `MIGRATION_DATABASE_URL=...` line;
single/double quotes are allowed, interpolation and whitespace are refused.

For the local `postgres:5432` service, `sslmode=disable` is permitted. The runner
resolves its current bridge address using Docker labels, verifies exactly one
running container in project `infraforge`, service `postgres`, no published ports,
and exactly one owned internal bridge. Host-side libpq reaches that private
address without a published listener; traffic never leaves the machine. Other
hosts, including RFC1918 and loopback addresses in the URL, still require TLS.
The local initial owner role can dump all application tables. For a remote backup
role, ensure read access to every application table/sequence, including RLS.

```sh
sudo install -m 0644 ops/backup-alerts/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/infraforge-backup.service /etc/systemd/system/infraforge-restore-drill.service /etc/systemd/system/infraforge-ops-metrics.service
```

`LoadCredential=release-env:/etc/infraforge/release.env` supplies a fresh private
copy at each backup start. Only the migration URL is extracted, never sourced or
printed; no extra backup URL needs updating on a provider switch. The runner
uses an otherwise clean libpq environment, and the existing custom-format dump
script receives no URL argument. AWS and restore commands receive no database
credentials. AWS still uses only the instance role. The old `neon-url` credential
is no longer consumed; remove it through the owner's secret-management process.

Run the first jobs sequentially, check their results, then enable schedules.
On the 4 GiB host, run the full restore drill in a maintenance window with the
application stopped, or on an encrypted scratch host: its synthetic proof adds
1 CPU / 768 MiB beyond the client cgroup. Do not automatically enable the monthly
drill timer on the live self-hosted stack. Daily backup and metrics timers fit
the documented allowance; serialize backups and release builds.

```sh
sudo systemctl start infraforge-backup.service
sudo systemctl start infraforge-restore-drill.service
sudo systemctl start infraforge-ops-metrics.service
sudo systemctl status infraforge-backup.service infraforge-restore-drill.service infraforge-ops-metrics.service --no-pager
sudo journalctl -u infraforge-backup -u infraforge-restore-drill -u infraforge-ops-metrics --since today --no-pager
sudo systemctl enable --now infraforge-backup.timer infraforge-ops-metrics.timer
# Enable infraforge-restore-drill.timer only on a separately budgeted drill host.
sudo systemctl list-timers 'infraforge-*' --all
```

Oneshot services normally show **inactive (dead)** after success; check
`Result=success`, exit status and PASS log lines. The daily backup runs at 02:15
UTC plus up to five minutes jitter; the monthly drill at 04:15 UTC on day 1 plus
up to five minutes jitter. Persistent timers catch up once after downtime; they
do not recreate missed daily/weekly recovery points. Jobs share a nonblocking
lock and log a failure if they overlap. There is no unbounded retry loop. Their
outer budget is 45 minutes and systemd budget 46 minutes; individual DB calls
retain the bootstrap script's bounds. Metrics run every minute with a 50-second
outer budget. Configure bounded system journal retention under the host's
existing logging policy; no database output is sent to CloudWatch Logs.

## Alarm behavior and acceptance

The stdlib publisher supplies all seven metrics; **no CloudWatch agent is
required**. Namespace `InfraForge/Ops`, dimension `InstanceId=<host ID>` must
match the template. It publishes one standard-resolution batch per minute.

| Metric | Trigger | Observation |
| --- | --- | --- |
| SiteReady | Below 1 for 3 minutes | Public HTTPS GET returns 200 |
| ApiReady | Below 1 for 3 minutes | Public HTTPS readiness returns 200 and `success: true` |
| WorkerReady | Below 1 for 3 minutes | Execute the existing readiness probe inside the exact worker container; checks queues, ownership and outbox success within 15 seconds |
| DiskUsedPercent | Above 80% for 5 minutes | Maximum usage of `/`, state and `/var/lib/docker` filesystems |
| MemoryUsedPercent | Above 85% for 5 minutes | `(MemTotal - MemAvailable) / MemTotal` from `/proc/meminfo` |
| BackupAgeSeconds | Above 93,600 seconds for 2 minutes | Snapshot start time of last fully successful daily/required-weekly upload |
| RestoreDrillHealthy | Below 1 for 2 minutes | Last attempt passed and success is no older than 35 days |

Every alarm treats missing data as breaching and emails on ALARM and recovery.
Missing/invalid/future backup receipts omit the age metric, never report zero.
The drill writes failure before starting, so a killed job remains unhealthy;
`ExecStopPost` removes only its recorded random container after termination.
A failed cleanup fails the drill too. Do not reset receipts to quiet an alarm.

In **CloudWatch → Metrics**, verify the seven metrics and same instance ID.
In **SNS → Topics → the stack topic → Publish message**, send a harmless test
message and verify receipt. To exercise an alarm route using the owner's AWS
identity, use a harmless temporary alarm state (normal evaluation will resume):

```sh
aws cloudwatch set-alarm-state --region REGION --alarm-name EXACT_STACK_ALARM_NAME --state-value ALARM --state-reason 'Owner acceptance test'
```

Use the generated alarm name from the console. Do not stop production to test
alerts. Monitoring runs on this EC2 host: host/network loss produces missing
metric alerts, but an independent regional/site synthetic checker is not part
of this stack. The worker check measures poll-loop/readiness health, not a
guarantee that every outbox item has completed; investigate retry backlogs
separately.

## Restore drill, retrieval and incident handling

Each drill runs the unchanged owned-container synthetic backup/proof first,
then copies the latest successfully uploaded snapshot into a new PostgreSQL 18
container with `--network none` and no published ports. The hardened verifier
checks its checksum, creates a random database, restores atomically, reads all
application tables and removes that database. The container and anonymous
volumes are removed afterwards. No database URL or remote destination can enter
the verifier. Incompatible extensions, insufficient memory/disk, corruption,
empty archives and restore errors fail the drill. That is not a reason to skip
tables or silently loosen validation.

**Scope:** this automated drill uses the retained local copy to preserve the
host role's upload-only S3 permission. It proves dump readability and local
restoration, not S3 retrieval, source equality during live writes, application
recovery, provider settings/roles or measured RTO. A successful PUT plus SHA256
does not replace an independent retrieval check.

The owner should perform an initial and periodic S3 retrieval check with a
**separate operator identity**, on a separate encrypted disposable machine. The
owner's identity needs `s3:GetObject` (and `s3:GetObjectVersion` for historical
versions) on the exact key; it need not grant the host any access. In the S3
console, select the exact daily/weekly key and version from a successful run,
or use these commands under that operator identity:

```sh
umask 077
mkdir -m 700 retrieved-backup
aws s3api get-object --region REGION --bucket BUCKET --key backups/daily/YYYY-MM-DD.tar retrieved-backup/backup.tar
tar -tf retrieved-backup/backup.tar
# Expected regular files only: archive.dump and SHA256SUMS. Reject other entries.
tar --extract --file retrieved-backup/backup.tar --directory retrieved-backup --no-same-owner --no-same-permissions archive.dump SHA256SUMS
RESTORE_DISPOSABLE=local-only bash ops/bootstrap/postgres-restore-verify.sh "$PWD/retrieved-backup" 55432 local_restore_role
```

The loopback PostgreSQL 18 server and `local_restore_role` must be newly
provisioned disposable resources; never choose an existing application server.
Keep archive checksums byte exact. On a real incident, restore S3 data into a **new** database/server (or use
a separately verified managed-provider restore point),
recreate required roles/provider settings, validate application login and old/new
run reports in isolation, and obtain the owner's explicit cutover approval.

For a backup alarm, check unit status, disk, direct endpoint configuration and
private diagnostics before one manual rerun. The last successful receipt must
stay unchanged after a failed upload. For a drill alarm, fix the restore or
cleanup failure and rerun the unit; leave the failure latched until success.
After a host reboot during a drill, inspect the root-private
`drill-container.json` and only the named `infraforge-restore-drill-<random>`
container. An interrupted synthetic proof can require manual cleanup of its
`infraforge-backup-proof-<random>` container. Never use broad Docker prune on
this shared production host. To pause maintenance, disable the relevant timer;
the missing/stale monitoring alerts intentionally remain active.

## Estimated monthly cost

Planning example, **not measured production cost**: US East (N. Virginia), one
host, seven metrics/alarms, a 1 GB tar snapshot, 32 retained copies, 35 PUTs,
43,200 metric batches, and fewer than 1,000 email deliveries/month. Excluding
free tiers, seven metrics at $0.30 plus seven standard alarms at $0.10 are
about **$2.80/month**. S3 Standard at $0.023/GB-month adds about **$0.74/month**
for the nominal 32 GB, plus well under $0.01 for those PUTs. At $0.01 per 1,000
API requests before free-tier allowances, 43,200 metric batches add about $0.43.
Allow roughly
**$3–4/month** for this example and lifecycle/version overlap. Reprice in the
actual EC2 region before activation.

The **full cost is Unknown**: dump size, remote backup-read/compute/egress impact,
encrypted EBS capacity, actual retained versions, existing NAT/data paths,
operator downloads, taxes and application baseline are unmeasured. This stack
adds no EC2 host, paid external checker, KMS key, agent logs or NAT gateway.
CloudWatch metric/API free-tier eligibility and SNS free tiers vary by account;
do not assume the bill is zero. See official [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/),
[S3 pricing](https://aws.amazon.com/s3/pricing/), and [SNS pricing](https://aws.amazon.com/sns/pricing/).

## Offline validation

Once dependencies/tools are installed, these checks need no credentials,
network, database or Docker daemon:

```sh
python3 -m venv .agent/w17-tools
.agent/w17-tools/bin/pip install cfn-lint==1.46.0
# Subsequent validation is offline; do not use cfn-lint --update-specs.
.agent/w17-tools/bin/cfn-lint -t ops/backup-alerts/stack.json
bash -n ops/backup-alerts/run.sh
shellcheck ops/backup-alerts/run.sh
python3 -B ops/backup-alerts/test_runner.py
bun --no-env-file --no-install test scripts/tests/backup-alerts.test.ts
```

The Python tests mock HTTP and every external command, explicitly prohibit
sockets, and exercise daily/weekly encrypted PUT paths, failed uploads, state
retention, invalid routing, worker timeout, corrupt archives, failed restores and
cleanup. Template and shell checks also run in the operations CI job; the Bun
wrapper runs through `test:tooling`. No measured restore result is claimed by
these offline checks. Official references: [Neon pg_dump guidance](https://neon.com/docs/manage/backup-pg-dump),
[S3 lifecycle semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html),
and [PostgreSQL libpq TLS parameters](https://www.postgresql.org/docs/18/libpq-connect.html).

For the fresh-start owner cutover and a URL-only provider switch, see [SELF_HOSTED_POSTGRES.md](../SELF_HOSTED_POSTGRES.md). No backup or restore result is claimed until the owner runs and records it.
