#!/usr/bin/env bash
set -euo pipefail
tag="infraforge-bootstrap-proof-$$"
trap 'docker image rm "$tag" >/dev/null 2>&1 || true' EXIT
# The repository's production .dockerignore excludes operational files; send only this fixture's inputs.
tar -c ops | docker build -f ops/bootstrap/Dockerfile.fixture -t "$tag" -
docker run --rm --network none "$tag"
printf '{"sha":"%s","imageId":"%s","distribution":"ubuntu:24.04","fixtureNetwork":"none","result":"PASS"}\n' \
  "$(git rev-parse HEAD)" "$(docker image inspect "$tag" --format '{{.Id}}')" > /tmp/infraforge-bootstrap-proof.json
