# Deployment configuration

These instructions describe configuration for a future release. A `develop` push
runs validation; the backend deployment workflow listens only to `main`. Do not
promote or deploy until the authentication and release rehearsal in
[project state](PROJECT_STATE.md) is complete.

## Vercel web project

The previously recorded project root was `Frontend`. The owner must change it to
`apps/web` before deploying this structure. Select Vite and enable **Include source
files outside of the Root Directory in the Build Step** so the root lockfile and
workspace packages are available. Keep the production branch set to `main`.
These settings are described in the [Vercel monorepo guide](https://vercel.com/docs/monorepos/monorepo-faq)
and [build configuration](https://vercel.com/docs/builds/configure-a-build).

`apps/web/vercel.json` specifies the root frozen install, filtered web build,
`dist` output relative to the app, and SPA route fallback. Remove any conflicting
project overrides. The repository requests Bun 1.3.14 through `packageManager`;
verify the actual hosted build version. Public `VITE_BACKEND_API_URL` includes
`/api`; `VITE_WS_URL` uses `wss://` for HTTPS deployments. Preview values must use
approved nonproduction services; do not inherit production endpoints for testing.
No hosted settings or deployments were changed during consolidation.

## Backend containers

From the repository root:

```sh
docker build -f apps/backend/Dockerfile -t infraforge-backend .
docker compose -f apps/backend/docker-compose.yml config --quiet
```

Compose resolves its build context two levels up to the repository root. Its
environment file remains local at `apps/backend/.env`, or settings can be supplied
by the operator's environment. See [authentication setup](AUTHENTICATION.md) for
exact origins, cookies, OAuth callbacks and required secrets.

Before a future release, update any external checkout scripts, service working
directories or Dockerfile settings to `apps/backend`. The repository's workflow
already uses that path. It builds and starts containers but does not apply database
migrations. Rehearse an approved stop/migrate/start/health/rollback sequence using
the unchanged versioned migrations before promotion. Do not run this sequence
against production as part of a repository restructuring task.
