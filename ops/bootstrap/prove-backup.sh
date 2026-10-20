#!/usr/bin/env bash
set -euo pipefail
# A supported entrypoint must reject ambiguous inherited routing before Docker.
while IFS= read -r variable; do
  case "$variable" in
    PGDATA|PG_MAJOR|PG_VERSION) ;;
    PG*) echo 'Ambient PostgreSQL settings refused' >&2; exit 2 ;;
  esac
done < <(compgen -e)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
name="infraforge-backup-proof-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() { docker rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" --network none --cpus=1 --memory=768m \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18 >/dev/null
[[ $(docker inspect --format '{{.HostConfig.NetworkMode}}' "$name") == none ]] || exit 2
ready=false
for _ in {1..30}; do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Disposable backup fixture startup failed' >&2; exit 1; }
docker exec "$name" mkdir /proof
docker exec "$name" bash -c 'umask 077; printf "%s\n" "$1" > /proof/owner' -- "$token"
for script in postgres-backup.sh postgres-restore-verify.sh postgres-backup-proof.sh backup-proof-isolation.test.sh prove-backup.sh; do
  docker cp "$here/$script" "$name:/proof/$script" >/dev/null
done
docker exec "$name" env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  BACKUP_PROOF_DISPOSABLE=owned-container BACKUP_PROOF_TOKEN="$token" bash /proof/backup-proof-isolation.test.sh
docker exec "$name" env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  BACKUP_PROOF_DISPOSABLE=owned-container BACKUP_PROOF_TOKEN="$token" bash /proof/postgres-backup-proof.sh
