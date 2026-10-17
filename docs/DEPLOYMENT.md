# Production deployment

`main` is the sole working/release branch. Start new-host or account recovery with
[PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md), not the historical cutover notes.

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
database. API uses Neon pooling; migration/worker use direct connections with
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
preflights database targets/history and idle runs, sets maintenance and verifies the
public proxy actually returns 503 for API/WS, stops API/WS, repeats idle checks,
stops the sole worker and refuses a remaining worker lock before migration. Original
migrations and schema guards are unchanged. Prisma 7.9.1 deploy/status/diff and exact
history/checksum/trigger checks remain mandatory. No database rollback is automatic.

The image now normalizes every COPY with `u=rwX,go=rX` under Dockerfile frontend 1.14.
Files remain root-owned and readable by final `USER bun` even when the host checkout
has 0600 files/0700 directories. No operator chmod recovery or source ownership grant
to the runtime is required. Generated Prisma/release metadata are built in-image.

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
