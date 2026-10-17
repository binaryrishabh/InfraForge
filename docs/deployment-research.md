# Deployment decisions and first-party sources

Research checkpoint: 2026-10-17. This extends the existing controlled release operator;
no simulation, database migration, auth architecture or UI behavior is changed.

Docker preserves source metadata on COPY. `--chown=bun` would make source writable by
the runtime and still leave mode ambiguity; blanket 0755 makes every source executable.
Use root-owned `COPY --chmod=u=rwX,go=rX`, with Dockerfile frontend 1.14 explicitly
selected: directories become 0755 and ordinary non-executable source 0644. Host umask
does not select those modes. The unfixed control tests the same input against the
same image recipe without the flags, rather than asserting a Dockerfile string.
See [Docker COPY](https://docs.docker.com/reference/dockerfile/#copy---chmod).

Use main push validation followed by `workflow_run`, rather than a second reusable
validation call inside CD. Re-read the source run through GitHub's API, require push,
same repository, main, exact latest SHA, successful completion and the expected workflow
path. Never execute PR/fork artifacts with production secrets. The privileged workflow
has read-only repository/actions permissions and no CI artifact input. A protected
environment gates actual mutation. See [workflow_run security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and [environment availability/API](https://docs.github.com/en/rest/deployments/environments).
The public personal repository's actual API accepted owner review, no admin bypass
and main-only branch policy. One owner may approve their own push; no independent
review is claimed. Serialized concurrency with `cancel-in-progress: false` covers the
whole backend/frontend sequence. GitHub may replace a pending run with a newer pending
run; current-main checks refuse obsolete work. [Concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Keep Vercel main Git deployment disabled. Use pinned CLI 64.5.0 with a production
source build from the exact checked-out tree, `--prod --skip-domain`, and promote
only after independently verifying accepted backend and staged frontend identity.
Production project environment stays on Vercel; the source-deploy route avoids
downloading production environment values into the runner. Deployment protection
is accessed using authorized `vercel curl`, not weakened. A successful identity gate
does not claim social login/session/WS smoke. See [deploy](https://vercel.com/docs/cli/deploy),
[protected curl](https://vercel.com/docs/cli/curl), [promotion](https://vercel.com/docs/cli/promote)
and [Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).
The first hosted CLI build/promotion remains UNVERIFIED until owner credentials exist.
The existing CI frontend build uses validation settings; the staged release requires
its production environment and exact release identity. The complete validation suite
is not repeated in CD. CLI deploy/promote/project options were checked against the
actual pinned 64.5.0 executable without authenticating or creating deployments.

Windows checkout conversion exposed eight existing calibration test refusals: four
unchanged measured-source files had CRLF bytes instead of their retained LF hashes.
Explicit Git attributes now keep those four sources and the new operational shell
files LF on every platform. Measurement JSON, source hash rules and Git source blobs
are unchanged. This fixes checkout representation rather than rewriting evidence.
[Git end-of-line attributes](https://git-scm.com/docs/gitattributes#_eol).

Use a few reviewed bootstrap files rather than a new infrastructure framework. Host
provisioning remains owner-selected, Ubuntu-only and parameterized by operator/domain/
certificate paths. Docker is installed from its signed apt repository; Bun archive
digests were independently read from the official bun-v1.3.14 GitHub release assets.
Existing incompatible installations refuse rather than being replaced silently.
[Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/),
[Bun installation/version selection](https://bun.sh/docs/installation),
[official Bun release](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14).

Retain one host Nginx site, test the entire configuration before reload, and add only
the HTTP ACME webroot needed for portable certificate renewal. TLS is issued explicitly
after DNS setup. [Nginx configuration/reload](https://nginx.org/en/docs/beginners_guide.html),
[Certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).
Neon transaction pooling cannot preserve session advisory locks; API is pooled,
worker/migration direct, all with verified TLS. [Neon pooling](https://neon.com/docs/connect/connection-pooling),
[PgBouncer feature matrix](https://www.pgbouncer.org/features.html).
