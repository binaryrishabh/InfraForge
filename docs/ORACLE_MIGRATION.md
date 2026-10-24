# Move the backend from EC2 to Oracle A1

Target: **Ubuntu 24.04, aarch64, 2 OCPUs, 8 GB RAM, 100 GB boot volume,
Mumbai**. This is an owner-executed procedure, prepared without host access.
Owner controls OCI/GitHub/GoDaddy/secrets and approves the window. Lead merges
reviewed changes, checks evidence and performs the technical steps with the owner.
All shell blocks below are **Bash on the explicitly named host**, except the
labelled workstation commands. Stop on any failure; do not continue by removing
locks, identity checks or maintenance markers.

This plan deliberately starts **fresh PostgreSQL and Redis volumes**, as requested.
Old accounts, designs, runs, sessions and queued jobs do not migrate. Owner must
confirm that this still matches the intended data decision before fencing EC2.
If EC2 has acquired data that must survive, stop this fresh-start procedure and
use a separately rehearsed dump/restore migration. Never copy x86 image layers,
the old Redis AOF, generated Prisma output or accepted release records to A1.

Reserve **60–120 minutes of maintenance as an unmeasured planning allowance**.
The first native build (0.20 CPU quota), DNS convergence, ACME, migrations and
verification all contribute. A1 build duration and resolver caching are unknown;
replace this allowance with a timed rehearsal plus margin. This is not a downtime
promise. The documented path issues TLS after DNS cutover and runs the initial
release afterward; it does not assume a preaccepted backend can serve before DNS.

## 1. Owner and lead: prerequisites before the window

1. Owner: VM exists in the **home region** Mumbai, with Always Free eligibility
   confirmed for shape, 2 OCPUs, 8 GB, boot and combined tenancy storage. Record
   instance/volume IDs, image version and public IPv4 privately. A1 capacity and
   uptime are not guaranteed. Keep access to the OCI console and recovery console.
2. Lead: merge this documentation plus the reviewed w48 R2 work and w50 release
   hygiene work into main, resolving their overlaps. Require normal successful
   exact-main CI; do not run a release from this worktree branch. Recheck the
   [ARM audit](operations/oracle-arm64-audit.md), especially the unpinned BuildKit
   default and optional msgpackr acceleration. Reaudit any changed pins/lockfile.
   This task ran no Docker integration runner or Linux proof containers. Actual
   A1 build, CLI, product/load and reboot evidence must be recorded by the lead.
3. Owner: retain the old EC2 IP, host fingerprint, deploy credentials and current
   accepted SHA/image/frontend deployment reference in the private operational
   record for rollback. Preserve its disks and backups. Never send their values
   through chat or log resolved Compose environments.
4. Owner: in GoDaddy, domain **lapwork.in → DNS → Records**, locate the existing
   backend record (normally Name **infraforge.backend**, resulting in
   `infraforge.backend.lapwork.in`). Confirm authoritative DNS is actually hosted
   there. Record its previous A/AAAA/CNAME values and TTL. At least one **old TTL**
   before the window (preferably the day before), lower the backend A record TTL
   to **600 seconds**, or the lowest supported value if 600 is unavailable, and
   record that actual value. Wait the previous TTL before relying on the new one.
   Do not change Vercel's `infraforge.lapwork.in` frontend record or nameservers.
5. Lead: review enabled OAuth/mail/private scoring dependencies. Preserve the
   stable auth secret and approved origins via the owner's secret manager.
   Optional SES credentials must remain valid without an EC2 instance role;
   do not activate new features as part of moving hosts. No Model 2 activation,
   runner socket or grant is part of this move.
6. Owner: announce maintenance and the explicit fresh-account reset. Lead: ensure
   R2 credentials, independent stale/missing-backup alerting and a separate scratch
   restore destination are ready using section 8. A local dump on this VM alone
   is not an offsite recovery plan.

On the **trusted owner workstation** with authenticated GitHub CLI:

```sh
gh variable set PRODUCTION_RELEASE_ENABLED --body false --repo binaryrishabh/InfraForge
gh run list --workflow deploy.yml --repo binaryrishabh/InfraForge --limit 5
```

Owner/lead: inspect any active release and let it finish before changing target
settings or fencing. Disabling admission does not cancel an active run. Hold other
main releases during cutover; a newer main SHA invalidates the exact-main gate.

## 2. Owner and lead: bootstrap the new Oracle VM

Owner: apply the OCI security-list/NSG and IPv4 routing rules in
[Oracle host setup](PRODUCTION_BOOTSTRAP.md#oracle-a1-network-firewall-clock-and-swap).
Only application ports 80/443 are public; SSH 22 has approved source CIDRs.
Verify the new SSH ECDSA host fingerprint through the **trusted OCI console**:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub -E sha256
```

Compare this record with the first SSH connection and install the authorized
public release key for the existing non-root `ubuntu` operator. Never trust an
unverified `ssh-keyscan` alone. The Actions SSH client needs the **ECDSA**
fingerprint, not an Ed25519 fingerprint from a different host key.

On **Oracle**, as `ubuntu`, select the reviewed full current main SHA:

```sh
set -euo pipefail
test "$(uname -m)" = aarch64
. /etc/os-release
test "$ID:$VERSION_ID" = ubuntu:24.04
sudo apt-get update -qq
sudo apt-get install -y git ca-certificates
test ! -e "$HOME/InfraForge"
git clone https://github.com/binaryrishabh/InfraForge.git "$HOME/InfraForge"
cd "$HOME/InfraForge"
git fetch origin main
read -r -p 'Approved full current main SHA: ' RELEASE_TARGET
printf '%s\n' "$RELEASE_TARGET" | grep -Eq '^[a-f0-9]{40}$'
test "$RELEASE_TARGET" = "$(git rev-parse origin/main)"
git checkout --detach "$RELEASE_TARGET"
test -z "$(git status --porcelain)"
```

Lead: **before Docker installation**, run the bootstrap guide's exact iptables
insertion/persistence block, then its UTC/NTP/disk/swap checks. Do not create swap
on the initial 8 GB host; do not count existing swap as usable RAM. Then:

```sh
sudo bash ops/bootstrap/host.sh ubuntu
```

Reconnect SSH to acquire Docker group membership (root-equivalent access). In
the new Oracle Bash session restore the non-secret selections:

```sh
set -euo pipefail
cd "$HOME/InfraForge"
RELEASE_TARGET=$(git rev-parse HEAD)
BACKEND_DNS_NAME=infraforge.backend.lapwork.in
API_ORIGIN="https://$BACKEND_DNS_NAME"
FRONTEND_ORIGIN=https://infraforge.lapwork.in
test "$(bun --version)" = 1.3.14
case "$(docker info --format '{{.Architecture}}')" in
  aarch64|arm64) ;; *) echo 'ARM64 Docker daemon required'; exit 1 ;;
esac
docker compose version
docker buildx version
timedatectl status
test "$(timedatectl show -p NTPSynchronized --value)" = yes
docker info --format 'cgroup={{.CgroupVersion}} driver={{.CgroupDriver}}'
free -m
df -h /
df -i /
bun install --frozen-lockfile
```

Require cgroup v2/systemd and verify the actual 2 CPU/memory limits during the
native release. Measure free bytes/inodes for image/cache, both retained releases,
PostgreSQL WAL/data, Redis AOF, logs and backup staging; 100 GB is an allocation,
not measured sufficient free space. Do not increase resource/admission limits.

Owner: use the private secret-manager workflow from
[bootstrap configuration](PRODUCTION_BOOTSTRAP.md#private-configuration-and-data-connections)
to create `/etc/infraforge/release.env`, owned by `ubuntu`, mode `0600`. Do not
paste credentials into commands/history. Supply `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL=https://infraforge.backend.lapwork.in`,
`APP_ORIGINS=https://infraforge.lapwork.in` and the existing approved optional
OAuth/mail settings. Then execute **step 3's private Python block** from
[the fresh PostgreSQL procedure](SELF_HOSTED_POSTGRES.md#fresh-start-owner-runbook)
on Oracle: it generates a password without printing it and sets all seven exact
database keys (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, `WORKER_DATABASE_URL`, `WORKER_DATABASE_MODE`). All three
URLs select `postgres:5432/infraforge?sslmode=disable`, mode `direct`, with the
generated password. This plaintext exception is only the same-host internal
Docker bridge. Do not save `RELEASE_SHA`/`RELEASE_IMAGE` in the private file.

Lead: verify fresh volumes without displaying environments:

```sh
test "$(stat -c '%U:%a' /etc/infraforge/release.env)" = ubuntu:600
test ! -L /etc/infraforge/release.env
test ! -e /var/lib/infraforge/releases/accepted.json
test ! -e /var/lib/infraforge/releases/release.lock
test -f /var/lib/infraforge/releases/maintenance
test -z "$(docker volume ls -q --filter name=infraforge_postgres_data)"
test -z "$(docker volume ls -q --filter name=infraforge_redis_data)"
sudo bash ops/bootstrap/nginx.sh "$BACKEND_DNS_NAME" http
```

An unexpected existing volume is a stop/inspect condition, never permission to
delete it. From outside OCI, `curl -H 'Host: infraforge.backend.lapwork.in'
http://NEW_ORACLE_IPV4/api/auth/providers` must reach HTTP 503. Substitute the
owner's real new address. This proves port 80, not TLS or app health.

## 3. Owner: set the exact GitHub target settings

Use GitHub **Settings → Secrets and variables → Actions**, privately pasting
values. The workflow retains its existing names, including `EC2_*` on OCI.

| Location / exact name | Owner value or action |
| --- | --- |
| Repository secret `EC2_HOST` | New Oracle public IPv4 (not a hostname still resolving to EC2) |
| Repository secret `EC2_USERNAME` | `ubuntu` (or the deliberately selected existing release operator) |
| Repository secret `EC2_SSH_KEY` | Private deploy key whose public key is authorized on Oracle; preserve old access privately for rollback |
| `Production` environment secret `EC2_HOST_FINGERPRINT` | Independently verified Oracle ECDSA `SHA256:...` fingerprint |
| `Production` environment secret `VERCEL_TOKEN` | Retain valid token; update only if it actually needs rotation |
| `Production` variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Retain current Vercel team/project |
| `Production` variable `PRODUCTION_BACKEND_ORIGIN` | `https://infraforge.backend.lapwork.in` |
| `Production` variable `PRODUCTION_FRONTEND_ORIGIN` | `https://infraforge.lapwork.in` |
| Repository variable `PRODUCTION_RELEASE_ENABLED` | Keep `false` through the manual first release; enable at section 7 |

These are all five explicit secret names and all five configuration variable
names referenced by `.github/workflows/deploy.yml:26,53-56,68-72`. Keep Production
owner review/no admin bypass/main-only policy. Check for old environment-level
`EC2_HOST`/username/key overrides that would shadow repository values; remove or
update deliberately without printing secrets. Ensure approved release-runner SSH
CIDRs are admitted. Do not open SSH worldwide to make a hosted retry pass.

## 4. Lead with owner: drain and fence EC2

Maintenance begins here. On **old EC2 only**, in the current accepted checkout,
as its release operator (never substitute Oracle settings):

```sh
set -euo pipefail
cd "$HOME/InfraForge"
test ! -e /var/lib/infraforge/releases/release.lock
OLD_SHA=$(python3 -c 'import json; print(json.load(open("/var/lib/infraforge/releases/accepted.json"))["current"]["sha"])')
OLD_IMAGE=$(python3 -c 'import json; print(json.load(open("/var/lib/infraforge/releases/accepted.json"))["current"]["imageId"])')
old_compose() {
  RELEASE_SHA="$OLD_SHA" RELEASE_IMAGE="$OLD_IMAGE" \
    docker compose --project-name infraforge --env-file /etc/infraforge/release.env \
    -f apps/backend/docker-compose.yml --profile database "$@"
}
printf '%s\n' "$OLD_SHA" > /var/lib/infraforge/releases/maintenance
old_compose stop --timeout 30 api ws-server
old_compose run --rm --no-deps migration bun release/cli.ts preflight
old_compose stop --timeout 30 worker
for id in $(old_compose ps -aq api ws-server worker); do
  test "$(docker inspect --format '{{.State.Running}}:{{.State.Restarting}}' "$id")" = false:false
  docker update --restart=no "$id" >/dev/null
done
```

The old database preflight must be reachable and report no live work. If it
refuses active runs, leave maintenance on and let the worker finish, then repeat
the preflight and stop. If the old installation lacks accepted state, uses a
different process manager or its database is unavailable, stop here for lead
inventory and a recorded equivalent fence; these commands cannot certify that
unknown layout. Verify no cron/systemd/deploy mechanism can restart old writers.
Keep old PostgreSQL/Redis and data volumes intact. Pause old backup timers only
after confirming the active backup finished and preserving the last recoverable
backup; do not erase existing backups or disable their alerts without replacement.

From outside EC2 verify both `https://infraforge.backend.lapwork.in/api/auth/providers`
and `/ws` return **503 with `X-InfraForge-Maintenance: true`** before DNS changes.
Do not boot both hosts' workers even though the new database is empty. Its lock
cannot fence a worker connected to a different database. Keep EC2 Nginx answering
maintenance for cached clients throughout the observation period.

## 5. Owner DNS cutover; lead TLS on Oracle

Owner: GoDaddy DNS → edit the backend **A** record's value to Oracle's public
IPv4, retaining the lowered TTL. Remove stale backend AAAA records (and resolve
any conflicting CNAME); retain the frontend/Vercel records. Record timestamp and
old value privately. Check all authoritative nameservers and an independent
resolver from the workstation, for example:

```sh
nslookup -type=NS lapwork.in
nslookup infraforge.backend.lapwork.in 1.1.1.1
nslookup -type=AAAA infraforge.backend.lapwork.in 1.1.1.1
```

Require the new A and no stale AAAA. Some caches retain old records beyond the
nominal TTL; they must see maintenance, never an old writable backend.
[GoDaddy's A-record procedure](https://www.godaddy.com/help/edit-an-a-record-19239)
describes the record value and TTL controls.

On **Oracle**, in the section 2 shell, after public DNS reaches Oracle:

```sh
sudo certbot certonly --webroot -w /var/lib/infraforge/acme -d "$BACKEND_DNS_NAME"
sudo bash ops/bootstrap/nginx.sh "$BACKEND_DNS_NAME" tls \
  "/etc/letsencrypt/live/$BACKEND_DNS_NAME/fullchain.pem" \
  "/etc/letsencrypt/live/$BACKEND_DNS_NAME/privkey.pem"
sudo nginx -t
sudo certbot renew --dry-run
sudo systemctl enable --now certbot.timer
sudo systemctl list-timers certbot.timer --all
```

Complete Certbot's registration/terms prompts as owner. Validate real TLS, SNI and
maintenance externally on API and WS; never use `curl -k`. The bootstrap installed
the Nginx reload hook. ACME needs public 80 and correct A/AAAA; stop on validation
failure. There is no copying of EC2 TLS private keys in this procedure.

## 6. Lead: first native release, fresh PostgreSQL

The workflow refuses a new state directory in maintenance and cannot bootstrap
it. On **Oracle** run the existing guarded operator **once**, after DNS and TLS.
Its HTTPS maintenance/readiness requests must reach this Oracle host
(`scripts/release.ts:70-81`), not the still-fenced EC2 host.

```sh
git fetch origin main
test "$RELEASE_TARGET" = "$(git rev-parse origin/main)"
read -r -p 'Oracle public IPv4 from the OCI console: ' ORACLE_IPV4
test "$(getent ahostsv4 "$BACKEND_DNS_NAME" | awk '{print $1}' | sort -u)" = "$ORACLE_IPV4"
test "$RELEASE_TARGET" = "$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
test ! -e /var/lib/infraforge/releases/release.lock
bun --no-env-file scripts/release.ts apply "$RELEASE_TARGET" \
  /etc/infraforge/release.env /var/lib/infraforge/releases
```

This builds on ARM, fetches pinned Redis/PostgreSQL, initializes only the new
PostgreSQL volume, applies migrations and exact schema/history/session/identity
checks, starts one worker and records acceptance. It clears maintenance only
after acceptance. A failure retains recovery evidence as appropriate; investigate
the actual lock/maintenance/helper state. Never delete markers, `migrate resolve`,
change engine targets blindly or rebuild an already accepted SHA to get past it.

Record the image and exercise the actual native binaries without secrets:

```sh
IMAGE_ID=$(python3 -c 'import json; print(json.load(open("/var/lib/infraforge/releases/accepted.json"))["current"]["imageId"])')
test "$(docker image inspect "$IMAGE_ID" --format '{{.Architecture}}/{{.Os}}')" = arm64/linux
docker run --rm --network none --workdir /app/apps/backend "$IMAGE_ID" \
  bun --no-env-file --no-install run --bun prisma -v
docker run --rm --network none --workdir /app/apps/backend "$IMAGE_ID" \
  bun --no-env-file -e 'import {pack,unpack,isNativeAccelerationEnabled} from "msgpackr"; const value={text:"Oracle ARM64 ✓ हिन्दी",bytes:new Uint8Array([0,127,255])}; const got=unpack(pack(value)); if(got.text!==value.text || got.bytes.length!==3 || got.bytes[2]!==255) throw Error("MessagePack round trip failed"); console.log({arch:process.arch,nativeAcceleration:isNativeAccelerationEnabled});'
docker ps --filter label=com.docker.compose.project=infraforge \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Prisma must report the native Linux ARM64 target and schema-engine version. Its
version command must not need a different downloaded binary to succeed offline.
MessagePack round-trip must pass; native acceleration may be false as explained
in the audit. API/WS bind only 127.0.0.1:3000/3001; worker, Redis and PostgreSQL
have no host ports. Inspect **only** `HostConfig.Memory`, `MemorySwap`, `NanoCpus`,
`CpuQuota`/`CpuPeriod` for service containers and the builder while it exists;
compare to [capacity policy](../ops/BACKEND_CAPACITY.md). Never print full inspect
or `docker compose config` with private environment data. Require healthy services,
no OOM kills and no unexpected listener in `sudo ss -lntp`.

## 7. Lead verifies; owner enables the same-SHA workflow

From an **independent workstation checkout** of the same merged main, with Bun
1.3.14 and dependencies installed (these checks access public metadata only):

```sh
read -r -p 'Accepted full current main SHA: ' RELEASE_TARGET
bun --no-env-file scripts/release/public-check.ts "$RELEASE_TARGET" https://infraforge.backend.lapwork.in
```

Require HTTPS 200, success, exact full SHA/auth contract 1, maintenance false and
credentials enabled. Owner: signup/login a new account (old sessions/accounts were
intentionally reset); verify enabled OAuth, authenticated WS updates, design
save/load, representative run/report and worker/queue progress. Lead: compare
latency, run duration, errors, memory and queue behavior against recorded EC2
baseline under the same representative workload. Unknown performance is not
parity. Do not enable public use if these checks fail.

Owner, workstation: enable admission and dispatch the accepted current SHA:

```sh
gh variable set PRODUCTION_RELEASE_ENABLED --body true --repo binaryrishabh/InfraForge
gh workflow run deploy.yml --ref main -f "release_sha=$RELEASE_TARGET" --repo binaryrishabh/InfraForge
```

Approve the pending **Production** release for that SHA. It reuses accepted
backend state only after checks, then stages/verifies/promotes Vercel at the same
SHA. Do not call the normal configure script mid-cutover: `-Enable` also dispatches
a release. Retain Vercel API/WSS settings for the same backend hostname and OAuth
callbacks; no split API/WS domain. Verify after promotion:

```sh
bun --no-env-file scripts/release/frontend-check.ts "$RELEASE_TARGET" \
  https://infraforge.lapwork.in https://infraforge.backend.lapwork.in
```

Require matching full frontend/backend SHA, auth contract, HTTPS API and WSS URLs.
Keep release receipts and timings privately. Maintenance ends when public product
smoke and acceptance pass, not merely when DNS changes.

## 8. Owner and lead: R2 backup acceptance after w48

**Merge gate:** this branch's [backup guide](operations/backup-alerts.md) still
uses AWS S3/IMDS/CloudWatch/SNS and describes an x86 AWS CLI install. Do not run
those EC2 installation steps on OCI or assume an IAM instance role follows it.
w48's report describes R2 support, but unmerged implementation is not a deployment
claim. After w48 is merged, use its updated guide's exact **Oracle/ARM64 host
installation, R2 endpoint/bucket/prefix/private credential and independent monitor**
steps. Lead must confirm the installed cloud client is ARM64. No secret values
or speculative R2 config keys are provided here. Completion of this section is a
required migration acceptance gate; it is not delegated to a later unspecified task.

Owner: provide R2 account endpoint, bucket, scoped write/prune credentials,
separate retrieval credentials, approved retention and alert destination through
the merged private configuration procedure. Use a new host-specific prefix so
retention cannot prune EC2's recovery material. Keep TLS verification and secrets
outside the checkout. Independent monitoring must detect a missing VM/heartbeat,
not just failures emitted by a surviving process on that VM.

After the merged installer has created the existing backup units, on **Oracle**,
serialize this with builds and use w48's merged status/receipt interpretation:

```sh
sudo systemctl start infraforge-backup.service
sudo systemctl show infraforge-backup.service -p Result -p ExecMainStatus
sudo systemctl start infraforge-ops-metrics.service
sudo systemctl enable --now infraforge-backup.timer infraforge-ops-metrics.timer
sudo systemctl list-timers 'infraforge-*' --all
```

Require exit 0, verified R2 objects/checksums/readback, correct new destination,
and actual independent success/failure/stale-notification delivery using w48's
documented test procedure. Inspect diagnostics privately. Retrieve a real new
backup from R2 with the separate recovery identity and restore into an isolated
scratch PostgreSQL 18 destination using the merged guide. Record archive SHA256,
object identity, restore PASS, readable application tables, elapsed restore time
and product recovery evidence; never restore over production. A timer being
enabled is not proof of recoverability. Daily backups imply up to roughly a day
of data loss; measured recovery time remains unknown until the drill. Schedule
monthly restore drills off the live host; don't add an unbudgeted restore workload.

## 9. Lead observes; owner decommissions EC2

Observe at least **48 hours**, including two daily backup cycles, real native
release acceptance, representative load and a controlled Oracle reboot. Before
reboot confirm how the worker resumes: it may deliberately have restart disabled;
use the existing guarded same-SHA recovery/retry, never an extra worker. Verify
clock synchronization, persisted iptables, SSH, Nginx/TLS, Docker limits, exactly
one healthy worker, public identity/product checks, backup timers and independent
alerts after reboot. Record memory/CPU/network trends and OCI notices for the
first **seven days** as well. Keep EC2 fenced until the owner accepts all evidence.

Owner may keep the fenced rollback host seven days if the AWS credit deadline
allows; proposed minimum 48 hours is not proof against a seven-day reclaim event.
Restore a normal backend DNS TTL (for example the prior value) only after stable
acceptance. Owner then explicitly terminates EC2 and inventories retained EBS,
snapshots, Elastic IPs and backup/monitoring resources for continuing charges.
Stopping EC2 is not complete decommissioning. Delete only resources specifically
approved after recovery retention is secured; keep required backups. Revoke old
deploy access when rollback retention ends. Nothing here authorizes automated
deletion of either host's data volumes.

## Rollback

Disable release admission first and inspect active runs. On Oracle set maintenance,
stop API/WS, check idle runs and stop the sole worker using the same fenced
procedure as section 4 with **Oracle's accepted** SHA/image. Verify all writers
stopped and no automatic restart path before allowing any EC2 writer.

**Before Oracle accepts user writes:** owner restores the old GoDaddy A/AAAA
records and old GitHub target secrets/fingerprint from the private record. Lead
resumes the unchanged accepted EC2 deployment through its reviewed recovery
procedure and verifies TLS, readiness, exact frontend/backend identity and actual
auth/WS. Keep Oracle fenced during DNS overlap. Its fresh state can be retained
for diagnosis. An old exhausted Neon database cannot be made healthy by DNS rollback;
if EC2 has no usable database, repair forward on Oracle or restore a verified backup.

**After Oracle accepts user writes:** a DNS-only return to EC2 would discard or
diverge new accounts/runs. Fence Oracle, take/verify its latest database backup,
then rehearse/perform a reverse restore into a **new empty** compatible EC2
PostgreSQL database and reconcile the queue/outbox under the lead's recovery plan,
or repair forward. Rebuild/retain architecture-correct EC2 images; never load an
ARM image there. Restore schema/auth/private configuration consistently, verify
data and only then resume one host's writers and switch routing. Downtime for this
reverse recovery is unknown. The release `rollback` subcommand only changes
compatible retained images on one host; it does not migrate data or reverse this
fresh-database cutover. Never erase new Oracle state to make old state appear current.

## Idle reclaim and capacity

Oracle may reclaim Always Free A1 when **all** are below 20% over a seven-day
period: CPU's 95th percentile, network utilization and memory utilization. Oracle
explicitly specifies p95 for CPU; do not invent the same aggregation for memory
or network. Memory alone at or above the threshold may keep the idle condition
false, but this is not an availability guarantee.
[Oracle policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
also limits free compute to the tenancy's home region.

[Capacity policy](../ops/BACKEND_CAPACITY.md) (`ops/BACKEND_CAPACITY.md:9-26`)
budgets five **ceilings**, not measured
steady use: API 384 + worker 768 + WS 256 + Redis 256 + PostgreSQL 768 = **2432 MiB**,
or **29.69% of 8192 MiB**. The 20% threshold on an assumed 8192 MiB host is
**1638.4 MiB**. A release builder adds 768 MiB transiently; the 192 MB PostgreSQL
shared buffer setting does not reserve the whole database cap. Neither build peaks,
cached pages, swap nor `docker stats` can establish OCI's seven-day memory result.
The observed steady working set is **unknown**, so do not claim memory protects
this instance until the provider's metric confirms it. Use actual guest/provider
memory totals if they differ from 8192 MiB.

The least wasteful safeguard is genuine service operation plus **OCI Compute
Instance Monitoring**, notice delivery and independent R2 recovery readiness.
Owner: enable the Oracle Cloud Agent's Compute Instance Monitoring plugin and
confirm CPU/network/**MemoryUtilization** arrive in OCI (a missing memory series
is unknown). Inspect seven-day CPU p95 and the documented network/memory metrics;
set a conservative low-memory warning around 25% plus missing-data notification,
and review the combined idle condition daily during the first week. An early
warning is not a guaranteed prediction of Oracle's reclamation evaluation.
[Oracle monitoring prerequisites](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/enablingmonitoring.htm)
explain the agent/plugin and network requirements; the
[compute metric reference](https://docs.oracle.com/en-us/iaas/Content/Compute/References/computemetrics.htm)
identifies `CpuUtilization`, `MemoryUtilization`, `NetworksBytesIn` and
`NetworksBytesOut` in `oci_computeagent`. Network byte counts require conversion
against the instance's actual bandwidth; they are not already a utilization
percentage and must not be compared directly to the 20% policy threshold.

Do **not** install CPU burners, fake traffic, allocate unused RAM or inflate
database caches just to consume resources. Real service memory may already exceed
20%; waste would steal the 2-OCPU release budget without proving availability.
Daily backups/health checks serve recovery/observability, not a claim to exceed
idle thresholds. If genuine use remains below all thresholds, owner/lead should
consider a measured smaller RAM allocation **only if build/load/recovery headroom
still passes** (4 GiB is the documented policy floor, not a validated A1 size), or
accept reclaim risk with a tested alternative host. Do not resize blindly or
upgrade to a paid account as an implicit step. Recheck capacity/notice/backup
health regularly; a free single VM has no availability guarantee.
