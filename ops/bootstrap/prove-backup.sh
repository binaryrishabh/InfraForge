#!/usr/bin/env bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
name="infraforge-backup-proof-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() { docker rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" --network none --cpus=1 --memory=768m \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18 >/dev/null
ready=false
for _ in {1..30}; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Disposable backup fixture startup failed' >&2; exit 1; }
docker exec "$name" mkdir /proof
for script in postgres-backup.sh postgres-restore-verify.sh postgres-backup-proof.sh; do
  docker cp "$here/$script" "$name:/proof/$script" >/dev/null
done
docker exec -e BACKUP_PROOF_DISPOSABLE=owned-container "$name" bash /proof/postgres-backup-proof.sh
