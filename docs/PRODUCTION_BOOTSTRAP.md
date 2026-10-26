# Rebuild and recover production

Production now runs on the home server: [HOME_HOST.md](HOME_HOST.md).

For the owner-decided fresh database replacement, follow the copy-paste
[self-hosted PostgreSQL cutover](SELF_HOSTED_POSTGRES.md). It includes URL-only
provider switching, mandatory daily R2 backups and a scratch restore test.

Current operation is described in [DEPLOYMENT.md](DEPLOYMENT.md). This runbook is
for provisioning or recovery, when initial operator access is appropriate. Normal
releases use GitHub Actions and need no host terminal. Commands below require an
explicitly selected new/recovery host; they are never run by workspace tests.

## Choose the recovery case first

| Situation | Preserve | Explicit changes |
| --- | --- | --- |
| Replace the home server, keep database and domain | PostgreSQL database/volume or off-host restore, stable auth secret, OAuth clients, frontend project/domain, backups | Fence old API/WS/worker, provision host, independently verify new SSH identity, update GitHub SSH settings and the Cloudflare Tunnel |
| Fresh database/account | Preserve only deliberately selected account/domain configuration | Create a new PostgreSQL database and roles, use explicit empty-database first release; old users/designs/sessions do not appear automatically. A restored database is a data-preserving migration, not this case |

Never run workers on old and new hosts concurrently. The session advisory lock is
a second fence, not permission to leave an unguarded old worker running. Teardown
active runs through the authenticated API; release preflight refuses live work.
Keep the old host fenced until new acceptance, including DNS cache overlap.

## External services and prerequisites

Obtain owner-controlled host, Cloudflare, GitHub, database-provider (if remote), DNS and Vercel access. Optional
Google/GitHub OAuth applications are separate. Know who owns database backups,
retention, restore approval, encryption keys, DNS and billing. Keep these records
and real credentials in the operator secret manager, outside the repository.

The reusable host setup supports **Ubuntu 24.04 LTS, x86_64 or ARM64**, with systemd,
outbound HTTPS, enough measured memory/disk for a Docker build and service workload,
and correct clock synchronization. It does not size capacity or create AWS resources.
Choose an Ubuntu image, create a non-root release operator (for example the image's
`ubuntu` user), and supply an authorized SSH public key through the hosting provider.
Docker group membership is root-equivalent host authority; restrict this account.

The home server uses Tailscale for SSH and Cloudflare Tunnel for public HTTPS.
Use [HOME_HOST.md](HOME_HOST.md) for the tunnel and loopback Nginx configuration.
Do not open public inbound ports or expose 3000, 3001, 3002, 6379 or 5432.

## Bootstrap repeatable host pieces

### Common host installation

From a reviewed exact checkout on the selected host, invoke as root:

```sh
sudo bash ops/bootstrap/host.sh EXISTING_RELEASE_USER
```

This installs host Nginx, Certbot, Git, CA certificates and prerequisites; installs
Docker Engine/Compose/Buildx through Docker's Ubuntu apt repository if absent;
installs **Bun 1.3.14** from the official archive with pinned SHA256; and creates
the layout below. Existing incompatible container packages/Bun require review.
It does not uninstall packages, edit DNS/firewalls, clone a database, create secrets,
erase state or activate Model 2. Reconnect the operator for new Docker membership.
Newly installed Nginx stays stopped with its default welcome site disabled until
the explicit domain/ACME site validates; an existing host's other sites are preserved.
It installs the current patched apt packages; it is not an OS upgrade/lifecycle policy.

| Path | Contract |
| --- | --- |
| `~/InfraForge` | Release operator's clean repository checkout; exact detached release SHA is normal |
| `/usr/local/bin/bun` | Bootstrap's pinned runtime when Bun was not already installed (the release also accepts a 1.3.14 install in `~/.bun/bin`) |
| `/etc/infraforge` | Operator-owned `0750`; no public traversal requirement |
| `/etc/infraforge/release.env` | Operator-owned regular file `0600`; operator creates privately; never printed |
| `/var/lib/infraforge` | Root-owned `0711`, permits Nginx traversal |
| `/var/lib/infraforge/releases` | Operator-owned `0711`, private state files; Nginx can stat maintenance |
| `/var/lib/infraforge/acme` | Root-owned `0755`, HTTP ACME webroot |
| `/etc/nginx/sites-available/infraforge` | Managed site; unrelated sites remain intact |
| `/etc/nginx/sites-enabled/infraforge` | Link to that managed site |

`layout.sh` can reapply only the directory contract. A new state directory starts in
maintenance; re-running never clears maintenance or `release.lock`. Symlinked state
directories, wrong secret-file ownership or non-0600 secret files refuse. Do not
normalize the whole checkout manually: the Docker image owns the runtime permission contract.

Clone `https://github.com/binaryrishabh/InfraForge.git` to the operator's
`~/InfraForge` (or transfer a verified checkout). Fetch `main`, select the full
approved SHA, and require clean status. Do not clone over an existing checkout or
copy `.env`/keys from Git. Public repository fetch needs no GitHub write credential.

## Private configuration and data connections

Use [the variable-name template](../ops/bootstrap/release.env.example). Create the
private file with umask 077 using a secret-manager workflow. Do not paste real URLs
into command history, issue reports or Actions variables. Compose reads it as an env
file; it is not a shell script. URL-encode database credentials with provider tooling.

| Variable | Required meaning |
| --- | --- |
| `DATABASE_URL` | API/WS PostgreSQL endpoint, direct or transaction pooled; remote `sslmode=verify-full` |
| `MIGRATION_DATABASE_URL` | **Direct** endpoint to the same database, migration privileges, verified TLS |
| `WORKER_DATABASE_URL` | **Direct**, session-preserving endpoint to the same database, verified TLS |
| `WORKER_DATABASE_MODE` | `direct` for the default local or remote topology; `session` only for separately verified session pooling |
| `BETTER_AUTH_SECRET` | Stable secret, at least 32 characters; preserve when preserving data/sessions |
| `BETTER_AUTH_URL` | Exact public HTTPS backend origin, no `/api` suffix |
| `APP_ORIGINS` | Comma-separated exact approved HTTPS frontend origins |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional pair; omit/empty both if disabled |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional pair; omit/empty both if disabled |

For self-hosting, also set `POSTGRES_USER`, `POSTGRES_DB` and `POSTGRES_PASSWORD`.
All three URLs may use `postgres:5432` with `sslmode=disable`; traffic stays on
the internal same-host Docker bridge. This exception never applies to arbitrary
private/loopback addresses. The role/database/password initialize an empty named
volume only; changing them later does not rotate credentials in an existing DB.

Do not configure `RELEASE_SHA` or `RELEASE_IMAGE` in this file; the release operator
supplies them. `API_PORT`/`WS_PORT` should remain default 3000/3001 to match the proxy.
Compose supplies production mode and private Redis host/port. General Model 2 stays
INTERNAL; do not add lesson grants, a runner socket or activation settings here.

Transaction pooling (including Neon's pooler endpoint) is unsuitable for the worker's session
advisory lock. Runtime probes cannot certify an arbitrary transparent pooler; use
provider-verified direct endpoints. Migration preflight checks all connections reach
the same database. Preserve TLS verification; never use `rejectUnauthorized=false`.

For a preserved database, **preserve BETTER_AUTH_SECRET** and the identity/origin
settings. Replacing it can invalidate sessions and protected auth material. Generate
a new stable secret only for an explicitly fresh identity installation; bootstrap
never generates one. SSH host keys, a new host IP and TLS certificates may be
regenerated, but fingerprints/DNS/renewal must then be updated and verified. A new
SSH deploy key is allowed if its authorized public key is installed and old access
revoked deliberately. OAuth client secrets can be rotated through their provider's
coordinated process, not casually regenerated during host replacement.

## DNS, Nginx and certificates

The home server terminates public TLS at Cloudflare. Install the loopback gateway
and project site described in [HOME_HOST.md](HOME_HOST.md); point the tunnel at
`127.0.0.1:8080`. Public SSH and ACME ports are unnecessary.
Bootstrap skips the Certbot renew hook. Legacy direct-TLS hosts need their own
reviewed certificate renewal setup; that setup is not used by production.

## GitHub and Vercel setup

The public GitHub repository supports required environment reviewers; verified
`Production` configuration is owner review, no admin bypass and a branch-only `main`
rule. Self-review is allowed because the owner is the sole release reviewer: this is
an explicit release decision after CI, not an independent two-person review. If the
account/repository becomes private, verify protection availability again before release.

| Location | Setting names |
| --- | --- |
| GitHub repository secrets (already present at baseline) | `EC2_HOST`, `EC2_USERNAME`, `EC2_SSH_KEY` |
| GitHub `Production` secrets | `EC2_HOST_FINGERPRINT`, `VERCEL_TOKEN` |
| GitHub `Production` variables | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PRODUCTION_BACKEND_ORIGIN`, `PRODUCTION_FRONTEND_ORIGIN` |
| GitHub repository variable | `PRODUCTION_RELEASE_ENABLED` (exact `true` enables release admission; absent/false skips it) |
| Vercel production environment | `VITE_BACKEND_API_URL=https://BACKEND_DNS_NAME/api`, `VITE_WS_URL=wss://BACKEND_DNS_NAME/ws` |
| Build invocation only | `RELEASE_BUILD=1`, `RELEASE_SHA=FULL_SHA` (workflow supplies these) |

Obtain the SSH SHA256 fingerprint through a trusted provider console/previously
verified record (for example console-side `ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub -E sha256`).
An unverified `ssh-keyscan` is discovery, not proof of host identity. Never print the
private key/token, or send secrets through chat. Use a dedicated Vercel token with
only the necessary team/project authority and a documented expiry/rotation owner.

Vercel: link the GitHub repository, production branch `main`, root `apps/web`, Vite,
include source outside the root, and honor committed install/build/output settings.
Verify hosted Bun 1.3.14; remove conflicting project overrides. Direct main Git
deployments stay disabled in `apps/web/vercel.json`. GitHub is the release authority.
CLI uploads the clean exact checkout and requests a production build with
`--prod --skip-domain`; it does not assign production domains yet. Build metadata
and `/release.json` must identify the intended SHA. Protected staged identity is
read with authenticated `vercel curl`; protection is never disabled for testing.

Current missing hosted setup is consolidated into **one owner invocation** from the
reviewed checkout on a trusted workstation with authenticated `gh` and PowerShell:

```powershell
pwsh -File scripts/deploy/configure.ps1 -Enable
```

This first disables release admission, requires green current-main push CI and the
protected environment, prompts through GitHub CLI for the fingerprint and token
without echoing them, asks for non-secret Vercel IDs, sets current public origins,
enables admission last, and dispatches that exact SHA. It does not SSH into EC2.
Approve the normal pending `Production` release in Actions after reviewing the SHA
and maintenance/backup readiness. The script defaults to today's domains; when moving
domains, supply its explicit `-BackendOrigin` and `-FrontendOrigin` HTTPS parameters.
Do not run it until Vercel project/public endpoint settings above are correct.

OAuth callbacks remain `https://BACKEND_DNS_NAME/api/auth/callback/google` and
`.../github` for enabled providers; verify provider console allowlists and exact
frontend origins if domains change. Identity checks do not test social login or
authenticated WS. Keep domain/auth changes in a separate reviewed maintenance plan.
Future separate api/auth/ws domains require session/token exchange, CSRF/origin,
revocation/logout, OAuth and WS trust design; DNS splitting alone is unsafe.

## First release and normal releases

Confirm backup/restore readiness, all old writers fenced, no active runs, clean exact
checkout and private configuration. A **fresh empty database** is supported. A restored
database must have reviewed exact migration history/schema; never mark migrations
applied merely to make it start. Old September databases have a separate historical
[cutover investigation](history/FIRST_CUTOVER.md) and are not ordinary fresh installs.

Normal path: push main → one complete CI run → protected approval → pinned SSH exact
backend release → public backend verification → same-SHA staged Vercel build → identity/
endpoint acceptance → promote → final public verification. New pushes never cancel an
in-progress release. Obsolete queued SHAs refuse against current main before mutation.

The underlying recovery/operator command remains:

```sh
bun --no-env-file scripts/release.ts apply FULL_SHA /etc/infraforge/release.env /var/lib/infraforge/releases
```

Do not run it routinely by SSH. The workflow invokes it through the retry-aware wrapper.

Provision at least **8 GiB (8,589,934,592 bytes) free** on both Docker's data-root
filesystem and `/var/lib/infraforge/releases` before a release, and on the classic
`overlay2` image directory if it is separately mounted. The controller checks every
storage path below before any build/state/service mutation. Protected Docker directories
require noninteractive read-only `sudo -n stat --file-system` access. The budget and assumptions
are documented in [release disk capacity and image retention](DEPLOYMENT.md#release-disk-capacity-and-image-retention).
Only local rootful classic `overlay2` is supported. Other stores refuse with:
"Use the classic overlay2 store (see ops/home/docker-daemon.json)".
Run `bun --no-env-file scripts/release/hygiene.ts qualify /var/lib/infraforge/releases`
to check capacity without changing services. An accepted-backend retry does not
build or pull an image and does not need another capacity check.
After acceptance it retains the exact accepted/previous images plus all images
used by containers, and logs removal of other exclusively `infraforge-backend:*`
images. It never prunes volumes, database/cache images or shared builders. The
dedicated release builder and its cache are destroyed after its build finishes.
If capacity preflight refuses, use the printed lock-protected
`bun --no-env-file scripts/release/hygiene.ts prune /var/lib/infraforge/releases`
command from the approved checkout; expand capacity if retained/in-use data still
leaves too little room. Never clear an interrupted release lock just to prune.

Compose failures print a private diagnostic path under the release state directory,
`compose-error-<time>-<uuid>.log`. The redacted stderr tail is root-owned `0600`;
read it with `sudo cat -- PATH`. Verify the operator can use noninteractive
`sudo -n chown` for those files (bootstrap does not grant sudo rights). An inability
to create/secure diagnostics is reported explicitly without exposing stderr.

**New host:** a new state directory starts in maintenance, so the workflow refuses it with
"Interrupted/maintenance release requires operator recovery". Run the command above once over
SSH from the clean exact checkout. Preflight fetches only missing third-party images such as
Redis and, when a URL selects it, PostgreSQL before anything stops; an existing host keeps the image it already runs. After that
first acceptance, re-run the workflow for the same SHA to stage and promote the frontend.
Set `EC2_HOST_FINGERPRINT` to the host's **ECDSA** key fingerprint
(`ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub`): the release SSH client negotiates ECDSA
before Ed25519, so an Ed25519 fingerprint fails with "host key fingerprint mismatch".
The wrapper can reuse a recorded accepted SHA for retries or prose-only changes only after image/settings/container
readiness checks, and public verification repeats outside the host. It refuses maintenance
or an interrupted release lock. It never rebuilds a retained accepted image.

Verify from outside the host: HTTPS `/health/ready` is 200, `success=true`, full SHA
and auth contract 1; maintenance header `false`; `/api/auth/providers` is 200 and
`credentials=true`; frontend `/release.json` has the **same** SHA/auth contract and
correct HTTPS API/WSS URLs. Perform actual authenticated product smoke after first
host/domain/data migration; CI's disposable OAuth/WS fixtures do not prove hosted accounts.

## Rollback, backup and emergency recovery

Retain accepted/current and previous backend images, private `accepted.json`, frontend
deployment URLs and migration/auth/settings fingerprints in the operational record.
State files may identify releases but must not be published indiscriminately. A new
host can make a new accepted record after a clean reviewed release; copying a record
without its exact Docker images does not recreate rollback eligibility.

Compatible container rollback, from the currently accepted clean checkout:

```sh
bun --no-env-file scripts/release.ts rollback CURRENT_FULL_SHA /etc/infraforge/release.env /var/lib/infraforge/releases
```

Rollback requires identical migration/auth/settings contracts and an exact retained
previous image. It does not undo migrations or restore data/auth secrets. Promote a
separately recorded compatible frontend only after backend acceptance. Failed migration
or postcheck leaves services stopped and maintenance/lock retained. No `migrate resolve`,
marker deletion or automatic database downgrade is part of recovery.

The data owner must install the mandatory [daily R2 backup](operations/backup-alerts.md)
and test restoring into a separate approved scratch database before relying on it. Keep dump credentials in private libpq service/
password files, not shell history. Record restore point, migration state and application
SHA. Disposable packaging exercises `pg_dump`/restore mechanics; it proves neither
R2 retention nor the owner's ability to recover production data.

For an incident: set repository `PRODUCTION_RELEASE_ENABLED=false` to block new
releases; it does not cancel an in-progress migration. Inspect the current Actions run,
provider console, private state/lock, owned migration helpers and database history.
Use emergency SSH/console only for this diagnosis/recovery. Keep maintenance active
until forward repair or reviewed restore succeeds. Never delete the Redis volume,
release state, database or old host as a speculative fix. Redis is application queue
state; stop writers before any approved recovery. Archive incident evidence privately.

## Updating supply-chain pins

For an action update, look up the release in its official GitHub repository, review
the changelog and resolve its tag with `gh api repos/OWNER/REPO/git/ref/tags/vX.Y.Z`.
If the object is an annotated tag, follow `git/tags/SHA` until the object type is
`commit`. Verify the resulting full 40-character commit against the release, then
update every workflow reference and its trailing `# vX.Y.Z` comment together.

For an image update, review the publisher's release notes and run
`docker buildx imagetools inspect NAME:TAG` against Docker Hub. Verify that the
top-level digest is a multi-platform index including the required architectures;
use `NAME:TAG@sha256:DIGEST`, retaining the readable tag. Update matching Dockerfiles,
Compose files and CI/release fixtures together. Record the source and verification
in the change review, run actionlint/zizmor and the affected release tests, and
refresh execution identity and browser pins if tracked runtime files changed.
Normally wait about two weeks after an upstream release before updating; security
fixes can proceed sooner with an explicit review.

The frontend release installer verifies the `vercel@64.5.0` npm tarball's pinned
SHA-512 integrity before global installation. An update must review the exact
version's registry metadata and tarball and change both the URL/version and hash.
Its transitive npm dependencies still resolve outside `bun.lock`; the tarball
check authenticates the direct CLI package only. Full transitive reproducibility
would require a separately reviewed release-client lockfile.

## What is actually proved

`scripts/release/permission-proof.sh` builds restricted 0600/0700 source, exercises
non-root release/service reads and reproduces EACCES in an unfixed control.
`ops/bootstrap/prove.sh` uses a disposable Ubuntu fixture: private layout and repeat
runs, real Nginx syntax/TLS/maintenance/ACME, failure rollback and refusals. It uses a
fixture reload adapter because Docker is not systemd PID 1. It does not install AWS,
exercise live apt/systemd bootstrap, issue Let's Encrypt certificates, change DNS or
prove host capacity. Hosted credentials, network policy, OAuth and actual promotion
remain separate operational evidence. See [research decisions](deployment-research.md).
