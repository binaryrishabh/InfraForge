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
qualification. The previous concurrent-build budget does not apply.

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
   writable. Files are bounded to 16 KiB and opened without following symlinks.
6. If the dedicated host verifier is later approved, apply the explicit
   `ops/first-stack-verifier.compose.yml` override alongside the backend Compose
   file to publish Redis only on 127.0.0.1:6380. The override also attaches Redis
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

## Qualification and renewal (maximum 24 hours)

The existing full producer in FIRST_STACK_ISOLATION.md is authoritative.
Containment-only/CI output never qualifies this service. Use a new evidence
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
checkedAt/expiresAt and actual service/host measurements. Also measure the extra
supervisor/daemon budget and the real production topology, which differs from
the disposable topology. A valid producer record is necessary; it does not
prove unmeasured production headroom or grant product activation.

Schedule renewal before 20 hours from checkedAt, leaving at least four hours
for an offline qualification window. Disable new API admission, wait for queued
and active reservations to finish, and stop the verifier. Retain the previous
evidence; never extend its expiry or edit failed checks. Rerun full qualification
into a new directory and install the reviewed `qualification.json` atomically:

```sh
sudo install -o root -g root -m 0644 REVIEWED_RECORD /etc/infraforge/verifier/qualification.next
sudo mv /etc/infraforge/verifier/qualification.next /etc/infraforge/verifier/qualification.json
```

After owner-approved activation, install the enabled settings atomically, then
`systemctl start first-stack-verifier`. Probe
`curl --fail http://127.0.0.1:3003/health/ready`. Renewal is also reloaded by the
bounded background probe; missing, invalid, expired, wrong-image/source/daemon
or CI records close availability. Expiry is checked again on every execution
fence, so active visible/hidden work loses authority on expiry. Never advertise
continuous service if the daily offline renewal window has not been arranged.

## Readiness, shutdown and release

The lifecycle owns PostgreSQL advisory lock (186542854,12) before startup
recovery and keeps it through drain. Another lifecycle refuses before recovery.
The per-executor lock (186542854,10) and fixed container name remain separate.
Startup only moves running rows to recovery; it never retries uncertain execution.

Background checks cover qualification, exact local image/daemon, DB session,
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
postcheck also reject the lifecycle lock. Default Compose/rehearsal do not manage
this opt-in host service. After a release, install the matching host tree/image,
qualify again, and explicitly restart. Follow FIRST_STACK_SUBMISSIONS and
FIRST_STACK_ISOLATION recovery procedures for exact token/daemon/image/prefix
review. Never prune or automatically rerun an uncertain job.
