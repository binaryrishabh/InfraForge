#!/usr/bin/env bash
set -euo pipefail
sha=${1:?full release SHA required}
image=${2:?local proof image required}
[[ $sha =~ ^[a-f0-9]{40}$ && $image =~ ^infraforge-[a-z0-9-]+$ ]] || exit 2
[[ $(uname -s) == Linux ]] || { echo 'Linux filesystem semantics required' >&2; exit 2; }
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
control="${image}-unfixed"
cleanup() { docker image rm "$control" >/dev/null 2>&1 || true; rm -rf -- "$work"; }
trap cleanup EXIT
umask 077
git -C "$root" archive "$sha" | tar -x -C "$work"
find "$work" -type d -exec chmod 0700 {} +
find "$work" -type f -exec chmod 0600 {} +
test "$(stat -c %a "$work/apps/backend/release/cli.ts")" = 600
test "$(stat -c %a "$work/apps/backend/release")" = 700
docker build --build-arg "RELEASE_SHA=$sha" -f "$work/apps/backend/Dockerfile" -t "$image" "$work"
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = bun
docker run --rm --network none --workdir /app/apps/backend "$image" sh -ec '
  test "$(id -u)" != 0
  test ! -w release/cli.ts
  bun --no-env-file release/cli.ts manifest "$1" > /tmp/manifest.json
  for entry in index.ts worker.ts ws-server.ts health/probe.ts release/cli.ts cutover/cli.ts scripts/recover-ownership.ts; do
    bun build "$entry" --target=bun --outdir=/tmp/entrypoints >/dev/null
  done
  test -r prisma/schema.prisma
  test -r release.json
' proof "$sha"
# Reproduce the original failure with the same restricted context and no COPY modes.
sed 's/COPY --chmod=u=rwX,go=rX /COPY /g' "$work/apps/backend/Dockerfile" > "$work/unfixed.Dockerfile"
docker build --build-arg "RELEASE_SHA=$sha" -f "$work/unfixed.Dockerfile" -t "$control" "$work"
if docker run --rm --network none --workdir /app/apps/backend "$control" bun --no-env-file release/cli.ts manifest "$sha" >"$work/control.log" 2>&1; then
  echo 'Unfixed negative control unexpectedly readable' >&2; exit 1
fi
grep -q EACCES "$work/control.log"
grep -q release/cli.ts "$work/control.log"
cp "$work/control.log" /tmp/infraforge-permission-negative.log
printf '{"sha":"%s","imageId":"%s","controlImageId":"%s","inputFileMode":"0600","inputDirectoryMode":"0700","runtimeUser":"bun","releaseAndServiceReads":true,"unfixedEACCES":true}\n' \
  "$sha" "$(docker image inspect "$image" --format '{{.Id}}')" "$(docker image inspect "$control" --format '{{.Id}}')" > /tmp/infraforge-permission-proof.json
