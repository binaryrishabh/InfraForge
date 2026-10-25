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
2. Lead: merge this documentation and require the w48 R2, w50 release hygiene
   and **w50b containerd release fix merged and live first** in the approved
   main checkout used on Oracle. Resolve their documentation overlaps. Require normal successful
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
6. Owner: announce maintenance and the explicit fresh-account reset. Complete
   section 2's storage/client checks and section 8's bucket, credentials, lock
   rules, installation and independent monitor setup **before fencing EC2**.
   Prepare a separate scratch restore destination; a local dump is not offsite recovery.
7. Lead/owner: record and rehearse the recovery choice in **Rollback** before
   section 4. Resuming an older accepted EC2 SHA is not supported by the ordinary
   release commands. Default: require a rehearsed forward-repair plan; otherwise
   stop before fencing EC2. The separate public-traffic gate described in section
   6 is also an unresolved prerequisite if maintenance must cover all acceptance.

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

### Read-only storage gate before fencing EC2 or changing DNS

On **Oracle**, from the approved main checkout, run the w50b release preflight
itself. It must already be merged and live; this branch does not supply the fix.
The following import calls only its read-only preflight, not release or pruning.
The measurement wrapper also requires `df` available bytes to meet the same floor:

```sh
set -euo pipefail
cd "$HOME/InfraForge"
bun --no-env-file -e '
import {preflightReleaseSpace, availableReleaseBytes, minimumReleaseFreeBytes} from "./scripts/release/hygiene.ts";
import {command} from "./scripts/release/process.ts";
await preflightReleaseSpace(process.cwd(), "/var/lib/infraforge/releases", command, async path => {
  const output = await command(["sudo", "-n", "df", "-B1", "--output=avail", "--", path], process.cwd());
  const rows = output.trim().split(/\n/);
  if (rows.length !== 2 || !/^\s*\d+\s*$/.test(rows[1])) throw Error(`df unavailable: ${path}`);
  const available = BigInt(rows[1].trim());
  console.log(`df ${path}: ${available} bytes available`);
  if (available < minimumReleaseFreeBytes) throw Error(`df below 8 GiB: ${path}`);
  return await availableReleaseBytes(path);
});'
```

Review the measured paths against [release storage discovery](DEPLOYMENT.md#release-disk-capacity-and-image-retention)
in merged main. The imported check reads `docker info --format '{{json .}}'`:
classic `overlay2` must have no snapshotter driver-type; containerd must report
`overlayfs`, exactly `driver-type=io.containerd.snapshotter.v1` and an absolute
`Containerd.Address`. For containerd it runs
`systemctl show containerd.service --property=MainPID --value`, reads that PID's
`/proc/PID/cmdline` and requires **plain containerd with no flags**, then reads
`sudo -n containerd config dump`. The absolute top-level `root` and `[grpc]`
`address` must exist, and the address must equal Docker's socket.

Every measured path needs **8 GiB = 8,589,934,592 available bytes**: Docker root,
classic root's `overlay2` directory, or containerd root plus its
`io.containerd.content.v1.content` and `io.containerd.snapshotter.v1.overlayfs`
directories, and the release state directory (nearest existing parent if absent).
Measure each even if filesystems coincide. Noninteractive sudo for the config,
`df`, and the preflight's private-path `stat --file-system` fallback must work.
Any failed read, missing path, extra daemon flag, socket mismatch, unknown layout
or low-space result **stops the migration here**. Do not guess `/var/lib/containerd`,
create missing image-store paths or switch drivers on a populated host. Provision
a supported host/capacity and repeat the gate; the release repeats it before build.

### Install native backup clients before cutover

On **Oracle Ubuntu noble/ARM64**, install only the PostgreSQL 18 client from the
[signed PostgreSQL Apt repository](https://www.postgresql.org/download/linux/ubuntu/).
This supports noble/arm64 and avoids installing a second database server:

```sh
set -euo pipefail
test "$(uname -m)" = aarch64
test "$(dpkg --print-architecture)" = arm64
. /etc/os-release
test "$ID:$VERSION_ID:$VERSION_CODENAME" = ubuntu:24.04:noble
sudo apt-get update
sudo apt-get install -y curl ca-certificates gnupg unzip groff less
sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
sudo curl --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
sudo chmod 0644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
sudo tee /etc/apt/sources.list.d/pgdg.sources >/dev/null <<'PGDG'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: arm64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
PGDG
sudo apt-get update
sudo apt-get install -y --no-install-recommends postgresql-client-18
test "$(dpkg-query -W -f='${Architecture}' postgresql-client-18)" = arm64
pg_dump --version | grep -E '^pg_dump \(PostgreSQL\) 18\.'
pg_restore --version | grep -E '^pg_restore \(PostgreSQL\) 18\.'
```

Install the signed **Linux aarch64 AWS CLI v2** system-wide, using the
[AWS signature instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
In a fresh staging directory, save the public PGP key from that official page as
`aws-cli-public-key.asc` (public material, not a credential). The expected full
fingerprint is `FB5DB77FD5C118B80511ADA8A6310ACC4672475C`; if AWS rotates it,
stop for review of the new official key. On this fresh host:

```sh
set -euo pipefail
CLI_STAGE=$(mktemp -d)
printf 'Save the official AWS public key in %s/aws-cli-public-key.asc\n' "$CLI_STAGE"
read -r -p 'Press Enter after saving the public key: ' _
test -s "$CLI_STAGE/aws-cli-public-key.asc"
mkdir -m 0700 "$CLI_STAGE/gnupg"
gpg --homedir "$CLI_STAGE/gnupg" --batch --import "$CLI_STAGE/aws-cli-public-key.asc"
test "$(gpg --homedir "$CLI_STAGE/gnupg" --with-colons --fingerprint | awk -F: '$1 == "fpr" {print $10; exit}')" = FB5DB77FD5C118B80511ADA8A6310ACC4672475C
curl --fail --silent --show-error https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o "$CLI_STAGE/awscliv2.zip"
curl --fail --silent --show-error https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip.sig -o "$CLI_STAGE/awscliv2.sig"
gpg --homedir "$CLI_STAGE/gnupg" --batch --status-fd 1 \
  --verify "$CLI_STAGE/awscliv2.sig" "$CLI_STAGE/awscliv2.zip" > "$CLI_STAGE/signature.status"
grep -Eq '^\[GNUPG:\] VALIDSIG FB5DB77FD5C118B80511ADA8A6310ACC4672475C ' "$CLI_STAGE/signature.status"
unzip -q "$CLI_STAGE/awscliv2.zip" -d "$CLI_STAGE"
sudo "$CLI_STAGE/aws/install" --install-dir /usr/local/aws-cli --bin-dir /usr/local/bin
hash -r
test "$(command -v aws)" = /usr/local/bin/aws
aws --version | grep -E '^aws-cli/2\..*aarch64'
AWS_EC2_METADATA_DISABLED=true AWS_PAGER='' aws s3api put-object \
  --generate-cli-skeleton input > "$CLI_STAGE/put-object.json"
python3 - "$CLI_STAGE/put-object.json" <<'PY'
import json, sys
assert 'IfNoneMatch' in json.load(open(sys.argv[1])), 'CLI lacks conditional PUT'
PY
```

Record package/CLI versions and the verified archive checksum (`sha256sum
"$CLI_STAGE/awscliv2.zip"`). The download is mutable, not a repository pin.
The skeleton check is offline and proves CLI support for
[`If-None-Match`](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html),
not a successful R2 write. Actual conditional upload/readback/restore remains
section 8 acceptance. Any install, signature, architecture, major-version or
capability failure stops cutover. Review an existing CLI installation separately;
do not silently overwrite it. Complete section 8's pre-cutover setup now.

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

**Stop gate:** require recorded passes for section 2 storage and client checks,
section 8 pre-cutover setup, and the rehearsed recovery and public-traffic plans
below. Neither the retained-current EC2 recovery nor an independent public gate
is implemented/validated by this document. Do not begin the outage with either
plan unresolved.

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

**Actual traffic boundary:** successful `apply` removes the controller's
maintenance marker immediately after backend acceptance. With DNS already on
Oracle, Nginx then admits public API/WS traffic and writes, **before** sections
7–8's product, frontend and R2 acceptance. `PRODUCTION_RELEASE_ENABLED=false`
only disables workflow admission; announcements do not keep HTTP traffic fenced.
Without a separate gate, assume new writes from this point and use the post-write
recovery branch even if the remaining smoke checks have not begun.

**Open question — public gate (release/proxy owner):** how will public maintenance
last through end-to-end and backup acceptance? Recommended default: **hold cutover**
until a separate, owner-approved gate is implemented and rehearsed. It must keep
ordinary API/WS clients blocked while allowing ACME, the controller's local/public
probes, the approved Actions runner, independent checks and designated testers.
Before section 4, record tests of 503/blocked writes for unapproved clients,
successful maintenance/readiness transitions for release probes, authenticated
tester HTTP/WS and backup/monitor access, plus persistence across proxy reload and
reboot. Prefer a separately managed ingress allowlist; its exact trusted sources,
IPv4/IPv6 coverage and handling of hosted runner/tester addresses require review.
Do not weaken release probes, expose bypass headers to arbitrary clients or take
over the controller's marker. A second marker with no integration/test is not a
validated gate. This branch supplies no gate or claim that these tests passed.
After sections 7–8 and owner acceptance, lift that separate gate, repeat public
checks, and record the actual public-opening time. Designated tester writes still
count as Oracle writes for recovery unless explicitly approved as disposable.

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
parity. Keep the separate public gate closed if these checks fail; absent that
gate, traffic is already open and failure requires incident fencing/recovery.

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
Keep release receipts and timings privately. The controller's maintenance ended
in section 6; lift the separate public gate only after section 8 and owner
acceptance, then repeat these checks from an ordinary public client.

## 8. Owner and lead: isolated R2 setup before cutover, recovery acceptance afterward

The w48 R2 work is on main. Use the merged [backup guide](operations/backup-alerts.md)
from the approved checkout, not this branch's older AWS-only copy. No AWS account,
IMDS role, CloudWatch stack or `aws configure` is needed on OCI. Section 2 supplies
the missing native client installation. Complete the following **before section 4**:

1. **Owner — bucket:** create a separate private Standard **Oracle R2 bucket**.
   Disable public access, `r2.dev` and public custom domains. EC2 keeps its existing
   bucket, credentials and recovery access. Never point Oracle at EC2's bucket.
   The runner has fixed `backups/daily/` and `backups/weekly/` prefixes and no
   host-prefix configuration. Isolation comes from the bucket, not a new config key.
2. **Owner — tokens:** create a new Object Read & Write storage token scoped to
   **only the Oracle bucket**. Supply endpoint, bucket and region `auto` via the
   guide's private configuration, and keys through its root-only credential file.
   Preserve a separate retrieval identity outside the VM, scoped to the Oracle
   bucket. Do not reuse or broaden EC2's credentials.
3. **Owner — lock rules:** in the Oracle bucket's Settings, create enabled age
   locks for both `backups/daily/` and `backups/weekly/`, each at least **28 days
   (2,419,200 seconds)**. Preserve stronger overlapping locks. Leave
   `prune_enabled=false` until the guide's live lock verification succeeds.
   Verification uses a distinct **Workers R2 Storage Read / Admin Read only**
   bearer token: that configuration-read permission is account-scoped and broader
   than the bucket-scoped object token. Review that scope explicitly; never grant
   configuration write or expand the storage token. Without the read credential,
   keep pruning disabled. Do not change EC2's lock rules.
4. **Lead — installation:** after section 2's client checks, follow the merged
   guide's host installation/private configuration and systemd unit installation
   through `daemon-reload`. Keep timers disabled until first backup acceptance.
   Record that the Oracle configuration selects the new bucket; preserve old
   receipts as evidence, never copy them to satisfy Oracle acceptance. Set up the
   independent monitor, alert destination and isolated restore destination now.
   Monitoring must detect a missing VM/heartbeat, not just local process failures.

After section 6's accepted release, on **Oracle**, serialize this with builds
and use the merged guide's status/receipt interpretation. This remains a required
migration acceptance gate; backend acceptance alone does not establish recovery:

```sh
sudo systemctl start infraforge-backup.service
sudo systemctl show infraforge-backup.service -p Result -p ExecMainStatus
sudo systemctl start infraforge-ops-metrics.service
sudo /bin/bash /opt/infraforge-ops/backup-alerts/run.sh status
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
use the recovery path rehearsed before section 4, including retained-current
image/settings/schema/worker checks; a same-SHA workflow retry alone is not a
worker-resume procedure. Never start an extra worker. Verify
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

Before section 4, owner/lead must rehearse each applicable branch below on isolated
equivalent hosts and record evidence/timing. These instructions have not been
executed on a host. Disable release admission and inspect active runs first;
close the separate public gate and verify it before recovery. Inspect the release
controller's process and owned helpers privately; let it exit or use its reviewed
interruption procedure before fencing containers. A still-running controller can
restart writers. Retain maintenance/lock files, images, volumes and diagnostics.

**Open question — retained-current EC2 resume (release owner):** there is no
supported ordinary command here to resume an older accepted current SHA after
main advances. `apply` rejects an already accepted SHA; `reconfigure` and the
normal workflow require current main; the workflow also refuses maintenance.
Image `rollback` selects a compatible previous image, not resume-current. Do not
delete markers or invent an unverified Compose start to bridge this gap.
Recommended default: require an **owner-approved, rehearsed forward-repair plan
on Oracle before fencing EC2**. Record the exact failure-state recovery commands,
current-main release authority, schema/history and worker-lock checks, retained
image/settings verification, public acceptance and measured outage allowance.
Include failures before and after migration/acceptance and retained-lock handling.
If forward repair cannot be rehearsed, stop the migration until the release owner
implements/tests a retained-current recovery path preserving those same checks.
An EC2 fallback remains conditional on that separately reviewed path; this
document does not claim it exists.

### A. No Oracle accepted record

A build/preflight/migration failure may leave no `accepted.json`. Do **not** read
it or reuse section 4's accepted-image lookup. On **Oracle**, once the controller
has exited, inspect actual project containers without environments:

```sh
set -euo pipefail
test ! -e /var/lib/infraforge/releases/accepted.json
test -f /var/lib/infraforge/releases/maintenance
docker ps -a --filter label=com.docker.compose.project=infraforge \
  --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
docker buildx ls
docker ps -a --filter name=buildx_buildkit_infraforge-release- \
  --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
for service in api ws-server worker migration; do
  ids=$(docker ps -aq --filter label=com.docker.compose.project=infraforge \
    --filter "label=com.docker.compose.service=$service")
  for id in $ids; do
    test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}:{{index .Config.Labels "com.docker.compose.service"}}' "$id")" = "infraforge:$service"
    docker update --restart=no "$id" >/dev/null
    docker stop --timeout 30 "$id" >/dev/null
    test "$(docker inspect --format '{{.State.Running}}:{{.State.Restarting}}:{{.State.Paused}}' "$id")" = false:false:false
  done
done
```

No containers is valid for an early build failure. Missing maintenance, paused
containers or any failed inspection/stop is an unresolved fence, not a pass.
Match any residual `infraforge-release-SHA-PID` builder to the failed release's
private record, then stop/remove only that owned builder using
`docker buildx rm --force EXACT_REVIEWED_BUILDER_NAME`; never remove shared/default
builders. Inspect all remaining containers' names/labels for unexpected writers
or helpers and verify no systemd/cron/deploy path can restart them. Preserve
PostgreSQL/Redis. Verify Oracle's API/WS remain blocked from outside the host.
Use the rehearsed forward repair. Returning to EC2 is possible only after its
separately reviewed resume path has passed; absence of Oracle acceptance alone
does not certify data state or that no writes occurred.

### B. Oracle accepted, no external writes

Require evidence from the separate gate and application/database audit, including
designated tester activity. If evidence is missing, use branch C. With no active
release controller/lock, apply section 4's drain/idle/worker fence **on Oracle**
using Oracle's accepted SHA/image and configuration. If a retained lock, helpers
or active runs remain, use the rehearsed incident plan; do not bypass them.
Verify all writers stopped and restart paths disabled before any EC2 writer.
Default to rehearsed forward repair. Only if a separately supported EC2 resume
has been reviewed/rehearsed may the owner restore old target secrets/fingerprint
and DNS after verifying the retained image/settings/schema/worker checks, TLS,
matching frontend/backend identity and actual auth/WS. Keep Oracle fenced during
DNS overlap. An exhausted old database cannot be repaired by changing DNS.

### C. Oracle has writes, or writes are unknown

A DNS-only return to EC2 would discard or
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
