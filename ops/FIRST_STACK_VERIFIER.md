# Trusted verifier lifecycle (activation off)

The dedicated launcher role `verifier` is prepared for one production host.
Nothing starts it in default Compose, the API, or the ordinary worker. No public
route or UI is mounted. `settings.enabled` defaults false; activation requires a
separate owner decision and the remaining authenticated browser/API integration.
`purpose: "shared"` requests verification and creates no public link.

## Placement and budgets

Use the supplied systemd host service, `ops/first-stack-verifier.service`, with a
dedicated `infraforge-verifier` account and its own rootless Docker daemon. The
daemon must enforce cgroup v2 memory, CPU and PID controls. Do not give this
account membership in the rootful Docker group. Its explicit endpoint is
`unix:///run/user/UID/docker.sock`; no context, remote fallback or credential
helper is used. Executor containers receive neither socket nor credentials.

The supervisor has 512 MiB memory, no swap, 0.15 CPU, 128 tasks and 512 FDs.
The executor separately has 768 MiB/no swap/0.5 CPU and the existing containment
limits. With the existing 1664 MiB/1.25 CPU stack, ceilings sum to 2944 MiB/1.90 CPU.
The remaining 1152 MiB/0.10 CPU covers OS, nginx and both daemon overheads; these
are arithmetic ceilings, not measured headroom. The rootless daemon lives outside
the supervisor cgroup so its child retains the independent executor budget.
Measure both daemons and the supervisor during intended-host qualification.
Disable verification and stop the service before builds, migrations, backups or
full qualification. Routine live renewal uses the existing executor slot while
ordinary production continues. The previous concurrent-build budget does not apply.

Connection ceilings: one producer Redis connection with a 2-second command
deadline/no offline queue, one consumer plus its one blocking connection, two
pooled DB connections, one lifecycle session, and one active executor session.
The two temporary session-validation connections close before these open.
This adds four steady DB slots to BACKEND_CAPACITY's 54: budget at least 58
application slots plus the existing operational/other-consumer reserve.

A Compose supervisor with a rootful socket would package the runtime more
simply, but would grant root-equivalent authority and need a Docker CLI in the
image. The host unit keeps that authority out of the ordinary application
containers, selects a dedicated rootless daemon and gives the supervisor its
own cgroup. Its trade-off is an additional immutable host installation and
explicit operator coordination with releases. No automatic fallback is supported.

## Install while disabled

1. Owner: reserve a maintenance window on the 2 vCPU/4 GiB c7i-flex.large and
   arrange full qualification and representative shared/scored measurements.
   Latency, throughput, observed memory, CPU and cost remain Unknown until measured.
2. Operator: install Bun 1.3.14, the Docker CLI and a dedicated rootless Docker
   daemon for `infraforge-verifier`. Enable user lingering and delegated cgroup v2
   controllers according to the host's rootless Docker installation procedure.
   Record the actual UID/socket. Refuse rollout if the existing host qualification
   cannot prove every control on that daemon; never switch to rootful silently.
   The fingerprint implementation supports Debian/Ubuntu hosts with the dpkg
   package database, `runc`, overlay2/overlayfs and the systemd cgroup driver.
   Install the runtime executables root-owned and not group/world writable.
   The supported layout uses merged `/bin` -> `/usr/bin`, with `runc`,
   `containerd-shim-runc-v2` and `docker-init` in `/usr/bin`. The managed
   containerd must itself run from `/usr/bin/containerd`, because containerd
   also falls back to a shim beside its own executable; qualification rejects
   a containerd loaded from anywhere else. Set the dedicated
   Docker user unit's `Environment=PATH=/usr/bin:/bin` and
   `WorkingDirectory=/usr/bin` so its managed containerd inherits both. This
   makes containerd's working-directory, PATH and cached shim lookup select
   the same protected file. Arbitrary PATHs, shim environment/plugin overrides,
   external containerd and custom runtimes are unsupported. The observer hashes
   loaded dockerd/containerd/rootlesskit executables and the selected helpers
   through their actual process namespaces, not the supervisor's PATH. Missing
   helpers, inaccessible procfs, writable search directories and ambiguous
   configuration all reject qualification. The managed containerd uses its
   Docker-generated version-2 config at
   `/run/user/UID/docker/containerd/containerd.toml`; custom imports/proxy plugins
   are refused. No process environment is retained in evidence.
   Root installs `/etc/infraforge/verifier/daemon.json` (0644); the dedicated
   daemon must start with the literal argument
   `--config-file=/etc/infraforge/verifier/daemon.json`. Use an explicit protected
   configuration with `"cgroup-parent": "user.slice"` and
   `"init-path": "/usr/bin/docker-init"`; arbitrary executor parents
   and command-line parent overrides are unsupported. The fingerprint resolves
   the running user manager's `ControlGroup` through systemd, then observes that
   manager's `user.slice` and its ancestors separately from dockerd's ancestry.
   Install this configuration before restarting the daemon. Its ctime must
   predate that launch and its bytes/metadata must agree in the daemon's mount
   namespace; an edited-but-not-reloaded file is not accepted as effective policy.
   The delegated daemon cgroup and every
   ancestor below the cgroup root must expose memory, swap, CPU, PID and cpuset
   controls. Missing/unreadable facts refuse qualification.
3. Install an immutable copy of the exact release workspace at
   `/opt/infraforge/verifier-release`, including frozen dependencies and the
   generated Prisma client. Use the repository's install/generation and execution
   identity checks on the build host, with LF-normalized inputs. Root owns the
   installed tree; the service user has read/execute access and cannot write it.
   Load the exact release image into the dedicated daemon. Record its full image
   ID and the checked execution source; no tags or prefix matching are accepted.
4. Root creates `/etc/infraforge/verifier` (0755). Install a direct PostgreSQL URL
   as `/etc/infraforge/verifier/database-url` (0600, root). systemd passes it through
   `LoadCredential`; do not put it in command lines or logs. The runtime rejects
   known pooler URLs and probes independent session locks. A transaction pooler
   is unsupported. Keep the credential out of the executor image and inputs.
5. Install root-owned 0644 `/etc/infraforge/verifier/settings.json` with this shape,
   substituting the actual immutable image and dedicated account UID:

   ```json
   {
     "enabled": false,
     "image": "sha256:REPLACE_WITH_64_HEX_IMAGE_ID",
     "endpoint": "unix:///run/user/REPLACE_WITH_UID/docker.sock",
     "qualification": "/etc/infraforge/verifier/qualification.json"
   }
   ```

   The image example is deliberately invalid until replaced. Every settings and
   qualification ancestor must be root-owned, non-symlink and not group/world
   writable. Settings and baseline files are bounded to 16 KiB and opened without
   following symlinks. The separate protected canary has a 2 MiB file ceiling.
6. If the dedicated host verifier is later approved, apply the explicit
   `ops/first-stack-verifier.compose.yml` override alongside the backend Compose
   file to publish Redis only on 127.0.0.1:6380 and worker health on
   127.0.0.1:3002. Use the existing API loopback port 3000 for this supported host.
   The live monitor requires API live/ready and worker ready responses below
   three seconds, without redirects. The override also attaches Redis
   to the existing egress bridge: the internal-only bridge cannot serve this
   host listener. Keep Redis firewalled from remote access. API/worker/WS continue
   using their internal Redis origin. Verify the loopback listener on the host
   before starting the verifier; never change the bind address to 0.0.0.0.
7. Render `REPLACE_WITH_UID` in `ops/first-stack-verifier.service` with the same
   numeric UID used in settings, install it in `/etc/systemd/system/`, run
   `systemctl daemon-reload`, and leave it stopped. For example:

   ```sh
   verifier_uid=$(id -u infraforge-verifier)
   test "$verifier_uid" -gt 0
   sed "s/REPLACE_WITH_UID/$verifier_uid/g" ops/first-stack-verifier.service \
     | sudo tee /etc/systemd/system/first-stack-verifier.service >/dev/null
   sudo systemctl daemon-reload
   ```

   `ProtectHome=tmpfs` hides `/home`, `/root` and `/run/user`; the exact socket
   bind exposes only `/run/user/UID/docker.sock`. Do not bind the whole user
   directory or use `%U` (the system manager's UID). A read-only socket bind
   still permits Docker control; this is trusted daemon authority, not a read-only
   Docker API. The daemon must already be running when the unit starts. Restart
   the verifier after daemon/socket replacement; never accept a changed identity.
   Check access within the sandbox on Linux before activation:

   ```sh
   sudo systemd-run --wait --collect --pipe --property=User=infraforge-verifier \
     --property=ProtectSystem=strict --property=ProtectHome=tmpfs \
     --property=BindReadOnlyPaths=/run/user/$verifier_uid/docker.sock \
     /usr/bin/test -S /run/user/$verifier_uid/docker.sock
   ```

   There is intentionally no
   `[Install]` section or default enable operation. Run the full qualification
   below before supplying a true enabled setting or starting the service.

Before activation, run the opt-in Linux service regression from a complete,
identity-refreshed immutable checkout readable by `infraforge-verifier`, using the
installed `/usr/local/bin/bun` and the dedicated daemon already running:

```sh
sudo env VERIFIER_SYSTEMD_PROOF=owned-local /usr/local/bin/bun --no-env-file --no-install \
  test scripts/tests/verifier-service.test.ts
```

This creates and removes only randomly named `infraforge-verifier-proof-*` units
and `/run` evidence directories. It copies the shipped sandbox and signal policy,
removes production credentials/conditions, checks the exact socket and read-only
Docker `_ping`, then stops a real scored job during both its visible and hidden
subprocesses. It uses the actual engine/scorer with subprocess test receipts;
it creates no containers and is not Docker containment or production qualification.
Both scored jobs must finish, no child may receive the initial SIGTERM, and the
service must exit zero. Keep the separate full qualification and real-container
acceptance gates; do not substitute this regression for them.

## Full qualification after identity changes

The full EC2 producer must now run **inside the installed
`first-stack-verifier.service`**, with its 512 MiB, 0.15 CPU, no-swap, task/FD and
sandbox restrictions. A shell invocation outside that service fails closed.
For the maintenance rehearsal, keep activation disabled and ordinary production
stopped. Use a temporary root-owned runtime drop-in that changes only `ExecStart`
to the full command below and grants write access to a new disposable evidence
directory. Keep the installed base unit unchanged. After collecting evidence,
stop the service, remove that temporary drop-in and reload systemd before the
normal verifier launch. The fingerprint binds effective safety properties,
running cgroup controls, process no-new-privileges/capabilities/FD limit and the
installed base unit; it deliberately excludes the qualification command and
its output-directory exception. Other effective policy changes require new
qualification. Run the intended-host unit validation before activation; it has
not been performed on this development machine.

Both full and live observations require `vm.panic_on_oom=0`,
`vm.oom_kill_allocating_task=0` and `vm.overcommit_memory` equal to 0 or 1. They
also bind the effective allocation/reserve, CPU-bandwidth scheduling, global
task/PID and file-descriptor sysctls. Missing values reject qualification. A
runtime systemd override cannot remove the supervisor ceiling unnoticed: live
kernel cgroup controls and effective systemd properties are both checked.
Executor ancestor limits below the 768 MiB/0.5 CPU/64-task budget are rejected.

The full producer in FIRST_STACK_ISOLATION.md remains authoritative for all
sixteen behavioral gates. Containment-only/CI output and legacy v1 records never
qualify this service. Use a new evidence
directory for every run, the dedicated daemon endpoint, exact release image,
installed PostgreSQL/Redis images, `--target=ec2-c7i-flex.large --topology=full
--allow-disposable-topology`. The producer requires an empty selected daemon and
creates/removes only its own disposable topology. Do not run it alongside work.
Stop the ordinary production stack as well during this full qualification window,
as required by FIRST_STACK_ISOLATION.md; an empty rootless daemon does not imply
that the rootful production stack is stopped. Restore the accepted production
stack and check its readiness after the disposable topology has been removed.

Run from the installed release tree as the dedicated daemon account, replacing
the UID, exact installed image IDs and new evidence directory:

```sh
bun --no-env-file --no-install scripts/first-stack-host/qualify.ts \
  --endpoint=unix:///run/user/REPLACE_WITH_UID/docker.sock \
  --image=sha256:REPLACE_WITH_RELEASE_IMAGE_ID \
  --postgres=sha256:REPLACE_WITH_POSTGRES_IMAGE_ID \
  --redis=sha256:REPLACE_WITH_REDIS_IMAGE_ID \
  --target=ec2-c7i-flex.large --topology=full --allow-disposable-topology \
  --output=/absolute/new/qualification-directory
```

The owner reviews every boolean check, source/image/daemon/policy identity,
checkedAt, fingerprint observation, canary receipt and actual service/host measurements. Also measure the extra
supervisor/daemon budget and the real production topology, which differs from
the disposable topology. A valid producer record is necessary; it does not
prove unmeasured production headroom or grant product activation.

The producer emits a `first-stack-baseline/2` record with no calendar expiry and
a hash-bound `canary.json` containing the exact input and completed reference
cut. Neither file alone grants execution authority. Retain the previous evidence;
never edit failed checks. With the verifier stopped, install both reviewed files:

```sh
sudo install -o root -g root -m 0644 REVIEWED_RECORD /etc/infraforge/verifier/qualification.next
sudo install -o root -g root -m 0644 REVIEWED_CANARY /etc/infraforge/verifier/canary.next
sudo mv /etc/infraforge/verifier/canary.next /etc/infraforge/verifier/canary.json
sudo mv /etc/infraforge/verifier/qualification.next /etc/infraforge/verifier/qualification.json
```

After owner-approved activation, install the enabled settings atomically, then
`systemctl start first-stack-verifier`. Probe
`curl --fail http://127.0.0.1:3003/health/ready`. Startup holds lifecycle ownership
while it runs the live canary, then hands ownership to the queue. Any competing
startup must acquire that same lock; it cannot steal a slot between active jobs.

The fingerprint binds boot ID, kernel build, DMI instance type, CPU models and
memory; Docker server/component versions, storage/security/runtime settings;
content and filesystem identity of Bun, Docker CLI, loaded dockerd/containerd/
rootlesskit, selected runc/shim/init and the dpkg package database; effective
kernel policies, protected daemon config, bounded managed-runtime TOML and
installed supervisor unit; effective systemd safety properties and the separate
supervisor, executor-parent and daemon cgroup ancestries; and runtime process
start identities. Unknown observations fail closed. Exact
source, release image, daemon identity and isolation policy are bound separately.
Regular-file hashes are cached only while inode, size, ownership, mode, mtime and
ctime stay unchanged. Kernel/cgroup values are reread. The selected endpoint's
existing socket/daemon checks remain in force.

Reboot, daemon restart, package/runtime/kernel update, host change, delegated
limit change, release source/image change or baseline replacement closes the
service. Plan full requalification with that change. The implementation is
deliberately conservative about unrelated package updates. A maintenance window
on a spare/replacement host can keep the live product available during host
replacement; seamless transfer of this host's local queue/database is not supplied
by this change. Never copy a baseline to another host or rewrite its fingerprint.

## Automatic live renewal while production runs

Every five minutes after a successful canary, the lifecycle closes new admission,
pauses the Redis queue and waits for its active-job count to reach zero. A scored
job includes its visible and hidden executions. The worker loop, blocking Redis
connection, DB ownership and one-second background checks remain running. The
canary then takes the ordinary executor session lock and fixed Docker name.
There is never a second verifier container. Success resumes the queue; failure
leaves it paused, revokes authority and requires operator review/restart.

The exact release image replays the completed reference cut and must return
`MatchesRecordedPrefix`, a complete protocol, clean exit and confirmed cleanup.
Inside that same bounded container, finite probes require read-only root denial,
FD exhaustion below 128, loopback-only networking and increasing cgroup CPU
throttling counters. The normal inspect/handshake still checks memory/swap, CPU,
PIDs, rlimits, UID/GID, capabilities, Docker security options,
no-new-privileges, mounts, environment, network and image on every container.
OOM, PID exhaustion, CPU-time kill, wall kill, output flooding, orphan tests and
DB-session termination remain full-rehearsal gates; they do not run against live
production. Continuous probes do not claim to remeasure those destructive gates.

Only a successful canary with matching fingerprints before and after grants a
20-minute in-memory lease. Ordinary background refresh never extends it. The
existing execution fences check expiry again for visible and hidden work. Each
background observation revalidates the protected baseline, host fingerprint,
local Linux image, at least 512 MiB host free memory, production health and the
existing DB/Redis/queue checks. Missing facts, drift, stale lease or a failed
canary latch qualification closed; restoring an old file cannot silently reopen
it. No live record is written back over the full evidence.

The five-minute interval, twenty-minute lease, four-second CPU-throttle exercise,
75-second executor supervisor and 720-second whole-renewal deadline are policy
ceilings, not performance measurements. Actual drain/canary time, probe overhead
and full-rehearsal duration are **Unknown** here. Ordinary production does not
stop for renewal; verifier admission pauses while its single slot drains and
checks. There is no daily offline window. Full stress rehearsal still requires
exclusive intended-host time because its disposable service topology, memory
pressure, process deaths and health/headroom attribution would otherwise overlap
the live stack. Its total duration cannot honestly be promised to fit a particular
short window without intended-host measurements.

## Readiness, shutdown and release

The lifecycle owns PostgreSQL advisory lock (186542854,12) before startup
recovery and keeps it through drain. Another lifecycle refuses before recovery.
The per-executor lock (186542854,10) and fixed container name remain separate.
Startup only moves running rows to recovery; it never retries uncertain execution.

Background checks cover baseline/fingerprint, fresh canary lease, exact local image/daemon, DB session,
producer, blocking consumer, worker loop, successful outbox delivery within five
seconds, and undelivered outbox age below 15 seconds. Dependency events invalidate
readiness immediately. The safe Redis availability record lasts at most five
seconds and never outlives qualification; consumers reject expired records and
Redis failures. This finite observation window is not instantaneous remote failure
detection. A stale/missing record disables admission. Historical reads still work.

SIGTERM stops dispatch and new claims, then drains the whole active scored job
(visible plus up to eight hidden executions) under its session lock. The deadline
is 720 seconds, followed by process exit before systemd's 735-second limit.
`KillMode=mixed` sends the initial SIGTERM only to the supervisor, keeping its
attached Docker CLI and health-command children alive during drain. systemd still
kills remaining cgroup processes when the supervisor exits or the stop deadline
expires. Do not replace this with `control-group`, `process` or `none`.
Failure to delete the Redis availability record cannot prevent this drain;
remote readers then fail closed when the record expires within five seconds.
Dependencies and qualification continue to be checked during drain. A deadline,
lost session, failed cleanup or uncertain commit requires operator recovery;
never treat it as a successful score or retry it. Queued reservations remain
durable for the next qualified start. Disable admission and let the queue empty
before a release; simply stopping the service is insufficient for release idle.

Before invoking the existing release tooling, stop this host unit and verify
all nonterminal reservations and executor ownership are cleared. Migration and
postcheck acquire that same session lock before checking idle state and hold it
through all Prisma operations. A release and verifier startup exclude each other
in either order; startup validates schema/history while holding the lock.
The release excludes only its own lock 12 from the worker check, retaining the
checks for other owners and executor locks. Default Compose/rehearsal do not manage
this opt-in host service. After a release, install the matching host tree/image,
qualify again, and explicitly restart. Follow FIRST_STACK_SUBMISSIONS and
FIRST_STACK_ISOLATION recovery procedures for exact token/daemon/image/prefix
review. Never prune or automatically rerun an uncertain job.
