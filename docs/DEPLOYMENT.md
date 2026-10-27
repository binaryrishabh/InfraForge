# Production deployment

`main` is the sole working/release branch. Start new-host or account recovery with
[PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md), not the historical cutover notes.
The production backend runs on the home server; see [HOME_HOST.md](HOME_HOST.md). The existing `EC2_*`
GitHub setting names still select the SSH host; their names do not require AWS.

## PostgreSQL hosting

The 2026-10-24 owner decision is a fresh self-hosted PostgreSQL 18 database,
abandoning the exhausted Neon database. Follow [the cutover and provider-switch
runbook](SELF_HOSTED_POSTGRES.md); this is a procedure, not a deployment claim.
The three database URLs in `/etc/infraforge/release.env` select the provider; daily
R2 backups use the same migration URL. Remote connections require verified TLS;
only `postgres:5432` on the private same-host bridge may use plaintext.

## Owner checklist: optional account essentials

The release defaults to `ACCOUNT_ESSENTIALS_ENABLED=false` and `AUTH_EMAIL_ENABLED=false`, with no mail provider
or Turnstile configuration. Applying additive account/mail migrations does not activate the
feature. API configuration is forwarded by Compose from the private operator
`release.env`; field names are in `ops/bootstrap/release.env.example`. Never print
resolved Compose configuration or copy secrets into frontend settings.

1. Complete the UI follow-up listed in [authentication](AUTHENTICATION.md#export-and-ui-follow-up)
   before activation: verified signup, mailbox recovery, deletion and export are
   backend APIs and typed client functions only. Existing credential signup is
   unchanged while disabled. Enabling verification requires existing unverified
   credential users to verify before their next sign-in; existing sessions are not
   retroactively revoked. Review the documented retained-history semantics and
   backup retention before offering deletion.
2. Choose **one** provider. For SES, create and verify the sending domain in the
   chosen commercial AWS region, publish its DKIM records and confirm verified
   status. Follow [SES identity setup](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html).
   Request [production access outside the sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
   in that region before sending to ordinary recipients. Configure bounce/complaint
   handling and appropriate domain authentication. Set
   `TRANSACTIONAL_EMAIL_PROVIDER=ses`, `TRANSACTIONAL_EMAIL_FROM` (plain mailbox),
   `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, and optionally
   `SES_SESSION_TOKEN` for temporary API credentials. SMTP credentials do not work.
   Scope IAM `ses:SendEmail` to the verified sending identity; rotate credentials.
   This adapter targets SES v2's regional HTTPS API, not China/GovCloud partitions.
3. Alternatively, [verify a sending domain with Resend](https://resend.com/docs/dashboard/domains/introduction),
   publish its required DNS records and wait for verified status. Create a sending
   API key scoped to that domain. Set `TRANSACTIONAL_EMAIL_PROVIDER=resend`,
   `TRANSACTIONAL_EMAIL_FROM` and `RESEND_API_KEY`; leave SES fields empty.
   Provider tests must confirm actual receipt, not just API acceptance. Keep click
   tracking/link rewriting off for auth links. Neither provider has been tested
   with owner credentials as part of this implementation.
4. Optionally create a [Cloudflare Turnstile widget](https://developers.cloudflare.com/turnstile/get-started/)
   restricted to exact frontend hostnames. Set all of `TURNSTILE_SITE_KEY`,
   `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES` (comma-separated exact hosts, no
   schemes/wildcards). The public site key is exposed by `/api/auth/account-features`;
   the secret stays on the backend. Frontend widget actions must be `signup` and
   `password_reset`; submit each fresh token as `turnstileToken`. Configuring these
   settings immediately protects credential signup, independently of the account
   flag. Test failure, replay, wrong-host/action and provider-outage behavior in
   staging. Local delivery and challenge bypass require explicit development/test
   mode; production rejects both. See the exact flags and DNS records in
   [authentication](AUTHENTICATION.md#email-and-turnstile-configuration).
5. Install the updated managed Nginx template, which suppresses inherited request
   and error logs for this backend virtual host because native email links contain
   bearer tokens in URLs. Keep aggregate health/fixed operational-error monitoring.
   Also exclude auth URLs, query strings, referrers, credentials and export bodies
   from upstream proxy/CDN/APM and frontend hosting/analytics logs. Configure reset
   callback pages to remove tokens from browser history immediately. Restrict
   callback URLs to the already configured trusted frontend origins.
6. In staging, apply migrations through the controlled release and set
   `ACCOUNT_ESSENTIALS_ENABLED=true` with the chosen provider. The API fails startup
   on partial/invalid configuration; unconfigured Turnstile is skipped, configured
   Turnstile fails closed. Redis quotas are mandatory when enabled. Check actual
   delivered verification and reset links, expiry/replay rejection, response parity
   for absent/existing addresses, session revocation, cross-user export isolation,
   active-run deletion refusal and profile erasure with immutable history retained.
   Alert on the fixed `Transactional email delivery failed` message; sends are
   bounded and durable through encrypted PostgreSQL request intents; reset bearers
   are never persisted. Resend retries use stable idempotency keys; ambiguous SES sends are not retried automatically,
   so a user may need to request a new link.
7. Keep the existing stable Better Auth secret, exact Origin/HTTPS/proxy settings,
   release approval and backup procedure. Promote configuration only after those
   staging checks and UI readiness. Email-enabled signup needs email proof before
   username/password selection. Deploy the additive mail-intent migration first;
   startup invalidates legacy reset links and discards the old encrypted-link queue.
   Users must request those links again. The flags are independent: setting
   `ACCOUNT_ESSENTIALS_ENABLED=false` disables only the account-management APIs. To also
   disable email (verification, signup proof, reset and resend), set
   `AUTH_EMAIL_ENABLED=false` too. Neither deletes data or weakens database/history
   guards. To disable the challenge, set `TURNSTILE_ENABLED=false` explicitly; removing
   only its keys while it stays enabled fails startup by design.
   Do not roll back across migration fingerprints; use a reviewed forward fix.

Expired `AccountEmailToken` ledger rows can be purged by an authorized maintenance
job after their expiry; preserve unexpired used rows to avoid reactivating a
same-second JWT. No task here schedules production maintenance or changes backups.

## Optional login methods

These backend-only settings are independent and all default to `false`. Compose
forwards each flag only to the API. No auth server, DNS, cookie domain, secret or
production setting is changed by this work. Keep them off until the owner-designed
screens, staging provider checks and the security review are complete.

| Variable | When true |
| --- | --- |
| `AUTH_ACCOUNT_LINKING_ENABLED` | Automatically link Google/GitHub only when both provider and existing local emails are verified; explicit linking also requires method settings |
| `AUTH_MAGIC_LINK_ENABLED` | Existing verified accounts can request a single-use link, valid at most 15 minutes |
| `AUTH_EMAIL_OTP_ENABLED` | Existing verified accounts can request a six-digit code, valid at most 10 minutes, with 3 wrong guesses maximum |
| `AUTH_METHOD_SETTINGS_ENABLED` | List own methods/sessions, link through native OAuth, password-confirmed unlink, and revoke sessions; independent of deletion/export |
| `AUTH_HOSTED_LOGIN_ENABLED` | Trust exactly `https://auth.infraforge.lapwork.in` for browser requests while the server and host-only cookie remain on the backend hostname |

Magic-link or OTP activation requires `AUTH_EMAIL_ENABLED=true` (or the existing
essentials flag), `TRANSACTIONAL_EMAIL_PROVIDER=resend`, the existing Resend sender
configuration and configured Turnstile. Invalid combinations fail startup. In
production, configure `TURNSTILE_ENABLED=true` and its key/site-key/hostnames; the
widget must submit fresh `email_login` action tokens. There is no new mail
processor. Both login plugins have automatic signup disabled; new accounts follow
the existing W35-03 signup proof flow. The three-attempt OTP redemption quota is
shared across resends for 15 minutes; wrong, missing, expired and locked codes have
one public error and timing floor. Outages and quotas fail closed.

Apply migration `20261025120000_email_login_intents` before enabling the mail
methods. It only widens the existing mail-intent kind constraint; it adds no tables
or columns, changes no relation defaults and preserves existing rows. Disabling
the flags blocks redemption; pending mail already admitted can still be delivered
by the email worker until it expires. Disable both mail-method flags independently
of the existing email/account flags to stop new login requests. To disable all
new functionality, set all five flags to false. Never use a cookie-domain change
to connect the hosted-login UI.

Keep `APP_ORIGINS` limited to exact origins of owned apps (production frontend:
`https://infraforge.lapwork.in`). This is also the final return-URL allowlist.
The hosted-login origin is added to browser request origins separately. Relative
returns are rewritten to absolute URLs on the first app origin before native
handlers run; omitted magic/OAuth success callbacks default to that app root,
with error/new-user callbacks defaulting to the success URL. Escaped URLs, userinfo, backslashes,
protocol-relative forms and other schemes/hosts are rejected. The server remains
`https://infraforge.backend.lapwork.in`; OAuth callbacks and email redemption URLs
remain on that server. Magic links open a backend confirmation form and redeem
only after a fresh `email_login_redeem` Turnstile challenge. Configure the backend
hostname in the widget and exact `TURNSTILE_HOSTNAMES` list, alongside the app
hostnames used for issuance and OTP redemption. Include the hosted login hostname in the Turnstile widget
only when that UI is deployed. Do not configure analytics or request logging on
token-bearing routes.

Before activation, check real Resend delivery, provider-verified email assertions,
attacker pre-registration refusal, OTP exhaustion/replay, magic replay/expiry,
trusted-origin CORS and return rejection, password-confirmed unlink, concurrent
last-method removal, cross-user session isolation and revocation. Verify OAuth
callback registration still points to the backend. Passkeys remain deferred: the
installed Better Auth package does not ship the plugin. See the API evidence and
post-launch plan in [authentication](AUTHENTICATION.md#installed-api-evidence-and-passkey-deferral).

## Verified production checkpoint

On 2026-10-17 independent public checks returned HTTP 200 for backend readiness,
credential providers and frontend release metadata at
`0bcf74cf57934a2feda1e03f157bbc8ad933d26f`:

- Frontend: https://infraforge.lapwork.in
- Backend: https://infraforge.backend.lapwork.in
- API: https://infraforge.backend.lapwork.in/api
- WebSocket: wss://infraforge.backend.lapwork.in/ws

Backend readiness and frontend metadata agreed on full SHA/auth contract 1;
maintenance was false and credential auth enabled. The owner reports the completed
EC2 cutover, healthy API/WS/worker/private Redis and a fresh Neon database, and
manually tested the product. Public checks do not independently inspect the host or
database. At that earlier acceptance, API used Neon pooling; migration/worker used direct connections with
`sslmode=verify-full`, `WORKER_DATABASE_MODE=direct` per the verified owner handoff.
Model 1 remains ACTIVE and Model 2 INTERNAL; no general Model-2 activation follows
from production being live.

## One normal release authority

1. Push `main`. **Validate workspaces** runs the complete suite once for that SHA.
2. **Release InfraForge** consumes its completed push run. It re-reads GitHub's run,
   requires successful same-repository main validation and current main identity.
3. The `Production` environment disallows admin bypass (owner approval is delegated until launch),
   and permits only branch `main`. Review the exact SHA, compatibility, maintenance
   window, no active runs and backup/restore readiness before approving.
4. A serialized release checks all setting names/formats and Vercel access before
   touching EC2. Pinned SSH fetches main, requires a clean checkout and exact SHA,
   verifies Bun 1.3.14, and invokes the existing controlled release operator.
5. From the independent GitHub runner, public readiness must be HTTP 200 with the
   intended full SHA/auth contract, maintenance false, and working credential providers.
6. Vercel CLI builds that same clean checkout with production settings and
   `--prod --skip-domain`. Main Git deployment remains disabled. Protected staged
   `/release.json` is read through authorized `vercel curl`; exact SHA/auth contract
   and HTTPS API/WSS endpoints must match the accepted backend.
7. Only then promote that staged deployment. Repeat checks on the public frontend
   and backend; retain the release receipt in Actions.

`production-release` concurrency has `cancel-in-progress: false`. New pushes cannot
interrupt an in-progress migration/release. GitHub can replace pending runs; obsolete
SHAs refuse before mutation. Do not cancel an active production run casually.
The single owner can approve their own release; this is a deliberate production
pause after CI, not a claim of independent two-person review.

Ordinary EC2 terminal work is unnecessary once the hosted setup is complete. Manual
SSH/console is for initial bootstrap and genuine incident/recovery. Manual dispatch
is a retry tool: it requires the current full main SHA and existing successful push
CI, and does not run the expensive suite again. A same-SHA retry can reuse the
recorded accepted backend only after image/settings/container readiness verification;
it cannot rebuild/retag a retained image or clear maintenance/a release lock.

## Release disk capacity and image retention

Before creating release state, building, pulling dependencies or stopping services,
the release reads Docker's storage driver and `DockerRootDir` using `docker info`.
For the supported classic `overlay2` layout it measures available bytes at the
Docker root, its `overlay2` image directory and the release state directory (its
existing parent on a fresh host). Each must have **8 GiB = 8,589,934,592 bytes
free**, even when they share a filesystem. `statfs` uses available blocks; if the
operator cannot traverse Docker's private directory, a read-only
`sudo -n stat --file-system` measures available blocks instead. Noninteractive
sudo access for that read is required on such hosts. Missing paths, denied sudo
or unavailable measurements refuse the release; capacity is never guessed.

The containerd image store (`overlayfs` with exactly one `driver-type
io.containerd.snapshotter.v1`) is qualified only for the narrow default **local,
rootful system containerd** contract below. A fresh config dump alone is not proof
of the running daemon's configuration.

- Docker must select context `default` and `unix:///var/run/docker.sock`.
  Remote `DOCKER_HOST`, non-default `DOCKER_CONTEXT` or selected context, TLS
  endpoint overrides, rootless security options and missing security evidence
  refuse. Release Docker subprocesses pin the local endpoint, including cleanup
  and already-accepted backend verification. The separate owned-local rehearsal
  continues to use its explicitly selected local development engine.
  For both stores, the endpoint must be a root-owned Unix socket with an actual
  `dockerd` listener, a root-owned process, our mount namespace and `/` root.
  Extended `ss -H -O -xapn -e` VFS inode/device evidence must match the current
  endpoint's filesystem identity. Saved socket names and the ordinary socket
  inode column cannot establish that binding: renaming or overmounting a socket
  can leave a stale name beside another listener. Missing, ambiguous or mismatched
  VFS evidence refuses; inode/device values outside the lossless 32-bit diagnostic
  range refuse too. Device encoding is converted between stat, kernel and ss formats.
  A forwarding listener or another namespace refuses. Systemd may retain a
  socket-activation descriptor alongside dockerd. For the containerd store,
  The same `ss` observation must show reciprocal established socket inodes connecting that
  dockerd to the verified containerd PID and server-local address. Client peer
  names may be `*`, as in ordinary netlink output. These checks repeat after
  the dump; a local socket pathname or matching path strings alone do not qualify.
- `containerd.service` must have a positive MainPID, a readable flagless
  `containerd` command line and an absolute, non-deleted executable ending in
  `/containerd`. All flags are outside this qualified contract, even harmless
  ones. The process must share our mount namespace, have `/` as its root, and
  own the exact listening socket reported by Docker (`sudo -n ss -H -xlpn`).
- Both `config default` and `config dump` run through `sudo -n /proc/PID/exe`.
  This uses the live executable inode rather than whichever binary PATH finds.
  Version 2, 3 or 4 TOML is parsed with Bun 1.3.14's `Bun.TOML.parse`. Schema 4
  (including containerd v2.4.2) uses `plugins."io.containerd.server.v1.grpc"`
  for the gRPC address; versions 2/3 use top-level `grpc`. Parser errors
  and command failures never expose the dump or parser causes.
- `/etc/containerd/config.toml`, every recursively imported file, and each
  file's **own containing directory** must have ctime plus one second strictly
  before startup. All ancestors must be real, root-owned directories without
  group/world write permission and with finite ctimes. The filesystem root `/`
  must also predate startup. Higher ancestors may change later, provided no two
  adjacent directories in the input's ancestry have ctime plus one second at or
  after startup. A subtree rename changes both the moved directory and its
  destination parent; this rule refuses even when nested files/directories
  retain old timestamps. An isolated later `/etc` change between older `/` and
  `/etc/containerd` therefore passes. Unrelated changes to adjacent ancestors
  or `/` conservatively refuse and need a reviewed restart/requalification.
  Config files must also be root-owned,
  non-writable by group/others and regular. A missing default file means
  executable defaults only when its own directory passes; missing directories
  or imports refuse. Symlinks, glob/relative/non-normalized imports, cycles,
  more than 64 files and unreadable metadata refuse. Metadata is observed again
  after the dump, including the higher ancestors.
- Mount attachment does not change the source inode's ctime, and `mountinfo`
  supplies no mount timestamp. This narrow gate therefore refuses **all mounts
  below `/` covering a config, import or containing directory**, even if mounted
  before startup. Each input must be on the same whole-filesystem root mount
  (including mount ID) in `/proc/self/mountinfo`, `/proc/PID/mountinfo` and
  `/proc/1/mountinfo`. A later bind mount of an old file/directory refuses.
  Relevant mount records are observed again after the dump. This is a root-disk
  contract, not support for independently mounted configuration directories.
- The start cutoff uses systemd's captured `ExecMainStartTimestamp`
  (`systemctl --timestamp=unix`), checked against boot `btime` plus process-start
  ticks. Missing timestamps or a discrepancy over one second refuse; both are
  rechecked after the dump. A later clock correction cannot simply move the
  reconstructed cutoff forward. These observations are not a historical mount
  or clock audit: arbitrary root replacement or clock steps that later cancel
  cannot be certified from current `/proc` metadata. Such administration is
  outside this qualification contract and requires a reviewed restart and
  requalification. Do not describe ctime alone as proof of loaded configuration.
- The dump must match that executable's default plugin settings, disabled and
  required plugins, plugin directory, temp path and stream processors. Even
  harmless plugin customization is currently unqualified. Non-empty proxy
  plugins, any non-empty overlayfs `root_path`, content/snapshotter overrides,
  unknown top-level configuration keys and plugin fields absent from defaults
  refuse. State must match the executable default; the root must be an absolute,
  non-empty path without traversal, whitespace or control characters. The parsed
  gRPC address must match Docker's socket. PID, start time, executable, mount
  namespace and config evidence are rechecked after the dump.

The gate measures Docker's root, the qualified containerd root, its built-in
`io.containerd.content.v1.content` and `io.containerd.snapshotter.v1.overlayfs`
directories, and the release state directory, each against **8 GiB**. Missing
plugin paths refuse; do not create empty stale directories to satisfy this test.
Every unsupported or unavailable observation refuses before building. Never
assume `/var/lib/containerd`, bypass the gate, or switch storage drivers as cleanup.
Subprocess deadlines remain active through both output and exit (120 seconds,
10 minutes for builds), with a 16 MiB combined output cap. Timeout rejection does
not wait for privileged descendants; OS-level process-tree termination is not
certified by the local tests.

Before first release and after daemon/package/config/storage changes, qualify the
endpoint, instance, unchanged inputs, default plugins and capacity. Keep a small
sanitized record of version, PID/start, executable, namespace/socket ownership,
config timestamps and measured capacities. Do not publish raw config dumps.
A frontend retry reusing accepted backend state verifies the local endpoint but
skips capacity preflight; that is not a new host qualification. The supplied
production root/driver/socket/free-space facts alone do not establish these
additional checks, and Ubuntu 24.04 ARM64 bootstrap does not certify them.

The owner can paste the following **read-only** commands from the production
checkout, as the release operator. They do not restart services or create state.
Endpoint overrides are classified without disclosing values:

<!-- owner-endpoint-evidence -->
```bash
printf 'DOCKER_HOST=%s DOCKER_CONTEXT=%s\n' "$(if [ -n "${DOCKER_HOST-}" ]; then printf set; else printf empty; fi)" "$(if [ -n "${DOCKER_CONTEXT-}" ]; then printf set; else printf empty; fi)"
```

Run this sequence in one shell. `set -e` stops on failed evidence; the helper is
bounded by 30 seconds, 64 files and a combined 1 MiB read budget. It requires
Python 3.11+ (`tomllib`). It validates flagless containerd before printing a
selected process summary, and never prints arbitrary argv or config contents.
The helper checks kind **before** opening, uses descriptor-relative directory
walks and no-follow/nonblocking regular-file reads, and matches the gate's
literal normalized import rules. It emits generic parsing/read failures.

```bash
set -euo pipefail
pid=$(systemctl show containerd.service --property=MainPID --value)
[[ "$pid" =~ ^[1-9][0-9]*$ ]]
timeout 30s sudo -n python3 scripts/release/config-evidence.py "$pid"
bun --no-env-file scripts/release/hygiene.ts qualify /var/lib/infraforge/releases
```

The final command is authoritative: it runs the read-only preflight, both config
commands, mount and clock checks, Docker listener/process/namespace/connection
checks, and every capacity measurement. It prints selected verified Docker and
containerd instance metadata and capacities, not raw socket listings, command
lines or dumps. Keep that sanitized output with the helper timestamps. A failed
helper or qualify result is a stop condition. Only a successful result confirms
this checkout's checks pass at that moment; the supplied production facts do
not yet contain all the newly required observations.

After all package/configuration setup, run and record this sequence again before
cutover, while the replacement host is still out of service. An earlier
pre-install pass is not final cutover evidence. The real release repeats its gate.

This is a minimum operating budget, not a prediction: the incident's roughly
1.46 GB backend image rounds up to **1.5 GiB loaded image + 1.5 GiB export/load
staging + 2 GiB BuildKit intermediate/cache work + 1 GiB PostgreSQL/Redis growth +
1 GiB pg_dump staging + 1 GiB host/log safety = 8 GiB**. The latter allowances
are capacity assumptions, not measurements of production data. Increase disk
capacity before releasing if build intermediates, growth or a staged dump exceed
those allowances. Existing current/previous images already consume used space;
the free-space requirement is additional. A preflight cannot prevent concurrent
writers from filling a disk later; monitor capacity between releases too.

Only after durable backend acceptance and maintenance removal does automatic
cleanup read `accepted.json` and remove old `infraforge-backend:*` tags. It keeps
the exact accepted and previous content IDs and every image referenced by any
container, including stopped containers and other projects. Images also tagged
outside that exact repository, untagged images, PostgreSQL/Redis images and volumes
are untouched. Each removal logs its ID, tag and Docker's deletion output. A
cleanup failure is reported separately and does not reverse an accepted release.
No automatic image pruning runs before acceptance or on a failed release.
After acceptance and maintenance removal, SIGINT/SIGTERM cancels owned cleanup
commands and removes the release lock while leaving accepted services running.
Before that point, interrupted-release recovery retains its existing stop/lock rules.

For a low-space refusal, the error prints exact measurements and this safe,
lock-protected operator recovery command (run from the approved checkout):

```sh
bun --no-env-file scripts/release/hygiene.ts prune /var/lib/infraforge/releases
```

It requires an existing accepted record and refuses an existing `release.lock`;
inspect interrupted releases before recovery. It can recover space from earlier
accepted releases without building or promoting anything. If retained/in-use data
still leaves insufficient room, expand the filesystem or review capacity. Never
use broad `docker system prune`, volume pruning or default/shared-builder pruning
as release recovery.

Each release build already uses a dedicated `infraforge-release-*` BuildKit
builder. Its daemon and cache are removed after the build finishes, including
build failure/interruption, without `--keep-state` or `--keep-daemon`; cleanup
failure blocks acceptance. This leaves no retained cache for that owned builder
and never prunes a running build or another builder. See Docker's
[builder removal contract](https://docs.docker.com/reference/cli/docker/buildx/rm/)
and [image removal contract](https://docs.docker.com/reference/cli/docker/image/rm/).

Production Compose failures save a redacted final 16,000 characters of stderr in
`/var/lib/infraforge/releases/compose-error-<time>-<uuid>.log` and print that exact
path. Files are created exclusively with mode `0600`, assigned to root and checked
before their path is reported. The non-root release operator needs working
`sudo -n chown` for these files; bootstrap does not grant additional sudo rights.
Read the reported path with `sudo cat -- PATH`. URLs, secret assignments, known
secret environment values and authorization values are redacted before writing;
diagnostics with environment, variable, template or interpolation context, parser
line locations, or read/load/parse failures are replaced entirely with a syntax-check
message. This conservative suppression covers unfamiliar error wording and
required-variable reasons that can contain values without assignment keys. Quoted
secret assignments are redacted across escaped quotes and multiple lines.
stderr is never copied into Actions output. If storage or ownership fails, the
error explicitly says diagnostics could not be secured and identifies the checks
needed, while keeping stderr private. Archive/remove old diagnostics through
operator incident retention; image cleanup does not delete incident evidence.

## Activation status

Automatic release admission is **disabled** by repository variable
`PRODUCTION_RELEASE_ENABLED=false`. This commit can run CI without deploying itself.
The repository had EC2 host/user/key secret names, but no host fingerprint or Vercel
credentials/settings. No secret values were inspected. The actual public repository
accepted protected Production owner review, no bypass and a main-only rule.

The one remaining owner setup action is:

```powershell
pwsh -File scripts/deploy/configure.ps1 -Enable
```

Run from a trusted reviewed checkout with `gh` authenticated, after confirming the
Vercel project is configured as described in the bootstrap runbook. It prompts for
an independently verified pinned SSH fingerprint, a Vercel token through hidden
GitHub CLI input, and non-secret project/team IDs. It checks current main CI and the
protected environment, installs settings, enables admission last and dispatches that
exact SHA. Then approve the normal Production release in GitHub. No manual EC2 SSH
is needed for activation. Do not send credential values through chat.

The first hosted CLI staging/promotion and new automatic backend path remain
UNVERIFIED until that setup and a real accepted release. Existing public production
continues at its verified SHA. Public success does not prove hosted OAuth or WS.

## Controlled backend operator

Paths remain `~/InfraForge`, private `/etc/infraforge/release.env`, and
`/var/lib/infraforge/releases`. Nginx needs traversal on the state directory and its
parents (0711); private files remain operator-only. The workflow ultimately invokes:

```sh
bun --no-env-file scripts/release.ts apply FULL_SHA /etc/infraforge/release.env /var/lib/infraforge/releases
```

It builds an exact commit-tagged image with OCI revision/embedded release metadata,
pre-pulls missing dependencies, starts/waits for the private PostgreSQL service
when selected by URL, preflights database targets/history and idle runs, sets maintenance and verifies the
public proxy actually returns 503 for API/WS, stops API/WS, repeats idle checks,
stops the sole worker and refuses a remaining worker lock before migration. Original
migrations and schema guards are unchanged. Prisma 7.9.1 deploy/status/diff and exact
history/checksum/trigger checks remain mandatory. No database rollback is automatic.

The image now recursively normalizes copied and generated trees with `u=rwX,go=rX`
after generation and before `USER bun`.
Files remain root-owned and readable by final `USER bun` even when the host checkout
has 0600 files/0700 directories. No operator chmod recovery or source ownership grant
to the runtime is required. Generated Prisma/release metadata are built in-image and covered too.

Exactly one worker starts. Acceptance requires the actual image/SHA and healthy
API/WS/worker plus public readiness. A failed migration/postcheck leaves services
stopped and maintenance/lock retained; interruption stops owned helpers and preserves
recovery markers. Inspect private diagnostics, running helpers and migration history
before any recovery. Never blindly delete markers or run `migrate resolve`.

API/WS bind 127.0.0.1:3000/3001; worker and Redis have no public host port. Only the
TLS proxy is public (443 and HTTP 80 redirect/ACME). One host-only auth cookie supports
API and WS on the same backend hostname. A future api/auth/ws split requires a
separate session/CSRF/OAuth/revocation/service-trust design.

## Compatibility, failures and rollback

Identity checks prove release identity/endpoints and readiness, not every user
journey. First host/domain/auth migrations and incompatible API/frontend changes
require a reviewed maintenance plan and actual credential/OAuth/session/WS smoke.
Do not infer broad compatibility from matching auth contract version 1. Routine
compatible releases use the narrow automated gate; review compatibility before
approving the production environment.

If backend release fails, frontend is not staged/promoted. If staging/checks fail,
frontend stays on the prior domain deployment and backend stays accepted; preserve
backward compatibility or keep maintenance under a separate breaking-change plan.
If promotion has begun and a later check fails, do not claim rollback happened:
inspect Vercel promotion status and public identities, then select a reviewed recovery.
The workflow never rolls back the database or automatically promotes an older frontend.

From a clean currently accepted checkout, emergency compatible container rollback is:

```sh
bun --no-env-file scripts/release.ts rollback CURRENT_SHA /etc/infraforge/release.env /var/lib/infraforge/releases
```

Only an exact retained previous image with matching migration/auth/settings
fingerprints is eligible. Retain both accepted images and frontend deployment URLs.
Rollback cannot reverse data loss, migrations, auth-secret/provider/origin changes
or old unauthenticated contracts. Database restore/forward repair requires a separate
approved plan and rehearsed backup. Frontend recovery is a separate compatible Vercel
promotion after backend acceptance.

## Validation and historical material

CI preserves build/type/lint/workspace/tooling/challenge/boundary/audit checks,
PostgreSQL/Redis integration with real browser proof, Model-2 lesson isolation proof,
and the full disposable packaging/release rehearsal. The packaging image is now built
from deliberately restrictive source permissions; an unfixed negative control must
reproduce EACCES. A separate operations job checks shell syntax/ShellCheck, workflow
structure with pinned actionlint, and real disposable Ubuntu Nginx/TLS/bootstrap layout.
New positive/negative tooling tests cover admission, public release identity, missing
settings and safe proxy rendering. Tests never use production credentials or databases.

These fixtures do not prove AWS networking, live apt/systemd bootstrap, actual
rootless lesson hosting, provider backup retention, hosted OAuth or Vercel promotion.
Keep those claims separate. See [research decisions](deployment-research.md).

The old ownerless-data/eight-migration cutover, Neon disposable-branch rehearsal,
fencing/retirement and first-cutover recovery procedures are preserved in
[history/FIRST_CUTOVER.md](history/FIRST_CUTOVER.md). They describe the former system,
not today's fresh database. Do not repeat them as an ordinary release procedure.
