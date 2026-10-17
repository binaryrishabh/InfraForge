#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_SHA:?}" "${BACKEND_ORIGIN:?}" "${FRONTEND_ORIGIN:?}" "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain)"
# Build on Vercel from this exact checkout, using production settings without aliasing the live domain.
url=$(vercel deploy --prod --skip-domain --yes --token "$VERCEL_TOKEN" \
  --build-env "RELEASE_SHA=$RELEASE_SHA" --build-env RELEASE_BUILD=1 --meta "githubCommitSha=$RELEASE_SHA")
[[ $url =~ ^https://[a-zA-Z0-9-]+\.vercel\.app$ ]] || { echo 'Unexpected staged URL' >&2; exit 1; }
printf '{"sha":"%s","stagedURL":"%s","publicVerified":false}\n' "$RELEASE_SHA" "$url" > /tmp/infraforge-production-release.json
vercel curl /release.json --deployment "$url" --token "$VERCEL_TOKEN" -- \
  --fail --silent --show-error --max-time 20 --output /tmp/infraforge-staged-release.json
bun --no-env-file scripts/release/frontend-check.ts "$RELEASE_SHA" "$url" "$BACKEND_ORIGIN" /tmp/infraforge-staged-release.json
vercel promote "$url" --yes --token "$VERCEL_TOKEN" --timeout 5m
bun --no-env-file scripts/release/frontend-check.ts "$RELEASE_SHA" "$FRONTEND_ORIGIN" "$BACKEND_ORIGIN"
printf '{"sha":"%s","stagedURL":"%s","backendOrigin":"%s","frontendOrigin":"%s","publicVerified":true}\n' \
  "$RELEASE_SHA" "$url" "$BACKEND_ORIGIN" "$FRONTEND_ORIGIN" > /tmp/infraforge-production-release.json
