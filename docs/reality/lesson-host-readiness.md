# Dedicated lesson-runner host: verification procedure

## Current truth

**Actual-host access: NO.** The owner confirmed that no dedicated host is available
yet. All intended-host gates below are UNKNOWN. Windows Docker Desktop and rootful
Actions are not that host. No installation, service/configuration, lingering,
firewall, user/group, socket, production or grant change was performed.

Starting integration checkpoint: `085d816c05dcae0e1992166d25d22619a1fb71d8`,
[11/11 CI jobs successful](https://github.com/binaryrishabh/InfraForge/actions/runs/38956540465).
M2M is independently accepted INTERNAL engineering. Model 1 ACTIVE, Model 2 INTERNAL,
production PARKED. This work prepares a host decision; it does not approve preview.

## Research and architecture decision

First-party documentation rechecked for this task:

| Source | Consequence for this bounded gate |
| --- | --- |
| [Docker rootless](https://docs.docker.com/engine/security/rootless/) | Both daemon and containers use an unprivileged user namespace. A nonroot container on a rootful daemon is different. Check actual daemon identity and namespace. |
| [Rootless user service and resource limits](https://docs.docker.com/engine/security/rootless/tips/) | Use a systemd **user** service. Cgroup flags require cgroup v2/systemd; CPU is not necessarily delegated by default. Standard socket, data and config locations differ from rootful Docker. |
| [Rootless limitations](https://docs.docker.com/engine/security/rootless/troubleshoot/) | Distribution/user-namespace, storage-driver and cgroup constraints require host inspection. Do not substitute a privileged Docker-in-Docker container for intended-host proof. |
| [systemd delegation](https://systemd.io/CGROUP_DELEGATION/) | Delegate requests and actual controller availability differ. Read the delegated hierarchy; never write systemd-owned cgroups to force a passing check. |
| [Kernel cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) | Read memory/swap/PID/CPU controls and actual resource events. `cpu.stat` throttling demonstrates quota effects; process CPU termination is a separate rlimit mechanism. |
| [Docker resource controls](https://docs.docker.com/engine/containers/resource_constraints/) | Memory/swap, CPU bandwidth and process limits serve different purposes. Configured values alone cannot establish enforcement. |
| [RootlessKit](https://github.com/rootless-containers/rootlesskit) | User/mount/network namespaces mitigate host-root authority; they do not turn daemon access into a narrow lesson-only capability. |
| [Docker security](https://docs.docker.com/engine/security/) and [socket protection](https://docs.docker.com/engine/security/protect-access/) | Restrict socket and account access. Daemon clients can control that account's containers/mounts; do not share this daemon or expose unauthenticated TCP. |
| [Container attach](https://docs.docker.com/reference/cli/docker/container/attach/) | Client attachment and container lifecycle differ. Parent/client death must be exercised; the independent in-container deadline remains essential. |
| [Image inspection](https://docs.docker.com/reference/cli/docker/image/inspect/) | Require the already installed immutable image ID and reviewed revision/source labels; never silently pull or substitute a tag. |
| [Logging configuration](https://docs.docker.com/engine/logging/configure/) | Parent pipe caps do not bound daemon logs. The default json-file policy can exhaust disk; inspect effective rotation independently. |

Keep the existing engine and executor. Add a **read-only preflight**, followed by
an explicit, separately invoked bounded enforcement probe. There is no automatic
installer, daemon configurator, scheduler or production service. Unknown/failed
preconditions refuse probes. A passing preflight only means *eligible for probes*.
Every output retains `rootlessReady: false`; operational approval is not a boolean
that these tests can infer. Configured, observed and enforced evidence are distinct.

## Repository support and known limits

`scripts/lesson-host/cli.ts` reads a standard local Linux setup as the dedicated
nonroot account. It checks `/run/user/UID/docker.sock`, canonical path/ownership,
private runtime directory, default Docker context, rootful socket access, rootless
server/kernel/systemd cgroup identity, one same-owner namespaced dockerd in the
user service, available user controllers, exact installed image/revision/source,
no implicit image volumes, idle daemon, non-NFS owned data root, conservative
2 GiB available RAM/disk probe headroom and default bounded local logging.
Custom layouts/log options are conservatively Unknown/refused, not repaired.
Commands have bounded output and deadlines; no raw command/environment/service
configuration, hostname, machine ID, username or credentials are retained.
Proof UUID, normalized verifier/source hashes and runtime versions identify each
new proof. The old M2K/M2L/M2M proofs and classifications remain intact.

`probe.test.ts` repeats the preflight, takes a user-runtime exclusive directory
lock and requires an idle daemon. `probeSandbox.ts` uses the existing product
`runSandbox`, limits and kernel handshake with a derivative of the exact approved
image, changing only the trusted test entrypoint. No bind mounts, downloads or
user-authored arguments/code are accepted. Probe startup waits for the parent's
verified-handshake ACK before stress. Memory allocation is capped at 640 MiB even
if a limit fails; PID attempts at 80; descriptor attempts at 160; CPU loops have
finite deadlines. CPU quota proof records real `cpu.stat` throttling; OOM state,
rlimits, UID/GID, capabilities, no-new-privileges, loopback-only interfaces,
read-only root, tmpfs size/noexec, PID/FD refusal and independent wall termination
are checked. The existing orphan helper kills the parent, observes overlap refusal
and waits for the container's own timeout. Partial results survive failed probes.
Unique fixture tags are removed, never daemon-wide prune. No product DB is used.

Disposable rootful CI tests these bounded probes and confirms that preflight
refuses rootful execution. Its artifact explicitly says `disposable-rootful-CI`
and `actualHost: UNVERIFIED`. The actual-rootless wrapper remains skipped there.
Synthetic policy tests prove refusal logic, not a real rootless host.

Important limits to preserve in the operator decision:

- The production Docker helper strips `DOCKER_HOST`/`DOCKER_CONTEXT` overrides and
  selects the account's current context. Passing the inspector does not pin that
  context against later change. The API/worker must run with the verified account,
  HOME/context and endpoint; repeat after config changes. Runtime connection
  stability remains an operational gate, not a proven new application guarantee.
- Rootless daemon authority covers its account. Review all socket clients, login
  access, user service/config ownership, daemon/RootlessKit command/config listeners,
  rootful group access and absence of TCP exposure. The inspector cannot certify
  host-wide listeners or a compromised account. A dedicated account/daemon and no
  unrelated workloads are required. Do not mount the socket into a lesson.
- The application inherits daemon logging defaults. Inspect actual per-container
  LogConfig and effective rotation/cache on the deployed daemon. Local-driver
  preflight is configured evidence; available disk is a point-in-time observation.
- Supported production capacity is **one lesson executor or replay per shared
  database/daemon**, using the database advisory lease and running-container check.
  Extra concurrent requests can refuse/interrupt with a truthful prefix; this is not
  a multi-host scheduler. Standalone probes require API/worker admission parked and
  one operator. No safe throughput or long-term storage capacity is established.
- Normal cleanup removes owned containers; failed cleanup refuses a new lesson.
  Parent death can leave stopped containers/images after the independent timeout.
  Startup cleanup needs the matching retained DB origin/image; parking skips it.
  Never delete unmatched containers or images, and never treat a cleanup failure as
  a completed run. A stale probe lock after SIGKILL requires operator inspection.
- Daemon disappearance, end-to-end cancellation/worker loss and restore/disable
  procedures on the actual deployed service still require a controlled rehearsal.
  Existing M2M durable-prefix CI remains evidence for software behavior only.

## Exact operator sequence on the eventual host

1. Obtain a dedicated Linux host and nonroot account. Establish its operational
   owner and local systemd user session. If Docker/rootless prerequisites, CPU/
   memory/PID delegation, private socket, bounded logging or storage are absent,
   stop and request that **specific** administrator change. Do not run install,
   systemd reload, enable-linger, permission, firewall or user/group commands from
   this procedure without separate owner authorization. No rootful fallback.
2. Keep lesson execution parked and grants unchanged. Use the actual API/worker
   account and HOME/default Docker context, with no Docker endpoint/config/TLS
   environment overrides. No other workloads may use the daemon during probes.
   A host operator must review daemon command lines/config/listeners, service
   ownership/delegation, runtime/data/config directories, local filesystem and
   capacity. The preflight deliberately stores only relevant sanitized facts.
3. Place a reviewed checkout and the **already approved** packaged image on the
   host through the existing authorized distribution process. If the immutable
   image is absent, stop; this tool never pulls or installs anything. Set the exact
   reviewed image ID/revision below. Labels are identity crosschecks, not a trust
   decision about an unreviewed image. Bun must match the repository pin.

```sh
cd /path/to/reviewed/InfraForge
IMAGE='sha256:<approved-installed-image-id>'
REVISION='<approved-40-character-image-revision>'
bun --no-env-file scripts/lesson-host/cli.ts "$IMAGE" "$REVISION" "$PWD/host-preflight-unique.json"
```

Exit 1 refuses; inspect FAILED/UNKNOWN checks without changing the host. Exit 0
permits considering the probes only. A new output path is mandatory; never
overwrite evidence. The CLI performs inspection and writes that proof only.

4. After all preflight prerequisites and manual authority/capacity review pass,
   run the bounded probe as the same account in a maintenance window. This is an
   explicit test action that creates disposable containers, uniquely tagged
   derivative images and proof files; it changes no service or machine settings.

```sh
LESSON_HOST_PROBE=1 MODEL2_LESSON_IMAGE="$IMAGE" \
LESSON_HOST_REVISION="$REVISION" LESSON_HOST_OUTPUT="$PWD/host-probe-unique" \
bun --no-env-file test scripts/lesson-host/probe.test.ts
```

The directory must be new and absolute. Retain `host-proof.json`,
`partial-enforcement.json`, fixture source and Dockerfile, and orphan receipt.
Hash the files and retain them with the exact checkout SHA/CI status in the host
review record. Failure is failure/Unknown, never a manufactured success. Do not
retry until the known failure and any cleanup/lock residue are inspected.

5. Inspect all intended image/container/log/storage residue. No unrelated daemon
   objects are safe to remove. The probe uses exact unique tags; if interrupted,
   inspect its retained Dockerfile/tags/labels, ensure processes stopped, then ask
   the owner for only the necessary cleanup. A probe lock is not automatically
   expired or broken. Check available disk and image count over repeated runs.
6. Rehearse the real API/worker deployment with separate authorized disposable
   accounts/database: normal lesson, cancellation, worker death, ownership loss,
   daemon loss/recovery, image unavailable, cleanup failure and emergency parking.
   Verify truthful durable prefixes, no overlap/inline fallback, readable reports
   and exact retries after runner removal. Do not do this against production.
7. Define emergency disable before any audience approval: removing the lesson image
   from the API configuration and restarting that service refuses new reviews/
   admissions while exact already-admitted retries remain recoverable. Existing
   workers/queued work may continue; separately revoke the affected lesson grants
   or remove the worker image configuration through the approved supervisor to
   stop further execution. Capture-boundary cancellation and the independent wall
   guard bound active work. A worker restart also affects Model 1, so use the
   approved maintenance procedure. Do not stop/delete the daemon merely to park
   lessons. Verify stopped containers after timeout and safe cleanup on recovery.
8. Have the Lead review the actual host evidence, manual control-plane/service/
   monitoring/retention checks, disable rehearsal and known shared-kernel/runtime
   risks. Only that review can decide whether the runner gate is technically
   satisfied. External preview/audience/grants still need separate approval.

## Intended-host gate ledger

| Intended-host gate | Current status | Required next evidence |
| --- | --- | --- |
| Linux/kernel/runtime and intended account identity | UNKNOWN | Actual host preflight plus installed runtime versions |
| Rootless daemon and owner/user namespace | UNKNOWN | Daemon security options, owned process/service/namespace observation |
| Socket ownership, context and rootful selection refusal | UNKNOWN | Same API/worker identity and canonical private socket, repeat after changes |
| Systemd user service and CPU/memory/PID delegation | UNKNOWN | Active user service and actual controllers, then kernel effects |
| Memory/swap, CPU quota/rlimit, PIDs/FDs | UNKNOWN | Bounded real exhaustion and quota-throttling proof on that host |
| UID/GID, capabilities, network, readonly, tmpfs/noexec | UNKNOWN | Actual kernel/runtime fixture observations |
| Exact approved installed image | UNKNOWN | Local immutable ID and approved revision/source; no pull/substitution |
| Parent deadline, orphan termination, no overlap and cleanup | UNKNOWN | Real host probes and deployed-service interruption rehearsal |
| Cancellation, worker/daemon loss and durable-prefix recovery | UNKNOWN | Actual disposable deployment rehearsal; M2M software CI alone insufficient |
| Socket clients, TCP listeners and daemon authority | UNKNOWN | Host operator review; never inferred from client connectivity |
| Serial capacity, logs, disk/image/container retention | UNKNOWN | Point-in-time preflight plus effective config and sustained observation |
| Emergency disable and safe recovery | UNKNOWN | Approved operational rehearsal and owner responsibility |

**Recommended next action:** provide the dedicated Linux account/host with its
approved installed image and run the read-only preflight. No broader admin access
is requested. Repository preparation does not establish real-host readiness.
