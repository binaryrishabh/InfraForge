# Production deployment

`main` is the sole working/release branch. Start new-host or account recovery with
[PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md), not the historical cutover notes.

## PostgreSQL hosting

The 2026-10-24 owner decision is a fresh self-hosted PostgreSQL 18 database,
abandoning the exhausted Neon database. Follow [the cutover and provider-switch
runbook](SELF_HOSTED_POSTGRES.md); this is a procedure, not a deployment claim.
The three database URLs in `/etc/infraforge/release.env` select the provider; daily
S3 backups use the same migration URL. Remote connections require verified TLS;
only `postgres:5432` on the private same-host bridge may use plaintext.

## Owner checklist: optional account essentials

The release defaults to `ACCOUNT_ESSENTIALS_ENABLED=false`, with no mail provider
or Turnstile configuration. Applying additive migration 21 does not activate the
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
   staging. Test adapters are injected in CI; no runtime fake switch exists.
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
   bounded and asynchronous, not durable, and a user may need to resend.
7. Keep the existing stable Better Auth secret, exact Origin/HTTPS/proxy settings,
   release approval and backup procedure. Promote configuration only after those
   staging checks and UI readiness. Setting the account flag back to false disables
   these APIs without deleting data or weakening database/history guards. Removing
   all three Turnstile settings disables that independent challenge integration.
   Do not roll back across migration fingerprints; use a reviewed forward fix.

Expired `AccountEmailToken` ledger rows can be purged by an authorized maintenance
job after their expiry; preserve unexpired used rows to avoid reactivating a
same-second JWT. No task here schedules production maintenance or changes backups.

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
3. The `Production` environment requires owner approval, disallows admin bypass,
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

Containerd image stores and unknown drivers currently **refuse before building**:
their active content/snapshot root cannot be verified from `docker info`. Fresh
Docker Engine 29+ installations commonly use this layout; bootstrap installation
alone does not qualify it for this release controller. An operator must qualify
discovery and measurement of the active storage root before those layouts can be
supported. Do not assume `/var/lib/containerd`, bypass the gate or switch drivers
as cleanup. Docker documents the separate storage paths and the fact that
`data-root` does not move containerd storage in its
[daemon data-directory contract](https://docs.docker.com/engine/daemon/#daemon-data-directory).

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
value-bearing dotenv parser errors are replaced entirely with a syntax-check
message, since malformed values may appear without their assignment key. Quoted
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
