#!/usr/bin/env bash
# Only run inside an owned, disposable postgres:18 container.
set -euo pipefail
# Reject inherited libpq settings before even allocating a directory. Never
# print their values. PGDATA/PG_MAJOR/PG_VERSION belong to the image, not libpq.
while IFS= read -r variable; do
  case "$variable" in
    PGDATA|PG_MAJOR|PG_VERSION) ;;
    PG*) echo 'Ambient PostgreSQL settings refused; use the owned wrapper' >&2; exit 2 ;;
  esac
done < <(compgen -e)
[[ -f /.dockerenv && ${BACKUP_PROOF_DISPOSABLE:-} == owned-container &&
   ${BACKUP_PROOF_TOKEN:-} =~ ^[a-f0-9]{32}$ && -f /proof/owner &&
   ! -L /proof/owner && $(cat /proof/owner) == "$BACKUP_PROOF_TOKEN" ]] || exit 2
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Every libpq invocation, including nested backup/restore scripts, starts empty.
local_pg() {
  env -i PATH="$PATH" PGHOST=127.0.0.1 PGHOSTADDR=127.0.0.1 PGPORT=5432 PGUSER=postgres \
    PGDATABASE=infraforge_backup_fixture PGPASSFILE=/dev/null PGSSLMODE=disable PGCONNECT_TIMEOUT=5 \
    PGOPTIONS='-c statement_timeout=120000 -c lock_timeout=10000' \
    timeout --signal=TERM --kill-after=5s 10m "$@"
}
# Verify the local server is the owned image's cluster before the first write.
[[ $(local_pg psql --no-password -X -At --dbname=postgres -c 'SHOW data_directory') == /var/lib/postgresql/18/docker ]] || exit 2
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
local_pg createdb --no-password infraforge_backup_fixture
local_pg psql --no-password -X --set=ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE parent (id integer PRIMARY KEY, payload text NOT NULL);
CREATE TABLE child (id integer REFERENCES parent(id));
INSERT INTO parent VALUES (1, 'restore proof'), (2, '');
INSERT INTO child VALUES (1);
SQL
mkdir -m 700 "$work/backups"
receipt=$(local_pg bash "$here/postgres-backup.sh" "$work/backups")
archive=${receipt#BACKUP PASS }
[[ -f $archive/SHA256SUMS && $(stat -c '%a' "$archive/archive.dump") == 600 ]]
local_pg env RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres | grep -q 'PASS tables=2'
[[ $(local_pg psql --no-password -X -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'infraforge_restore_%'") == 0 ]]
# Independently prove the real archive contains the expected fixture content.
local_pg createdb --no-password infraforge_backup_content
local_pg pg_restore --no-password --exit-on-error --single-transaction --no-owner --no-acl --dbname=infraforge_backup_content "$archive/archive.dump"
[[ $(local_pg psql --no-password -X -At --dbname=infraforge_backup_content -c 'SELECT payload FROM parent WHERE id=1') == 'restore proof' ]]
[[ $(local_pg psql --no-password -X -At --dbname=infraforge_backup_content -c 'SELECT count(*) FROM child') == 1 ]]
local_pg dropdb --no-password infraforge_backup_content
if local_pg env PGDATABASE=infraforge_backup_missing bash "$here/postgres-backup.sh" "$work/backups" >/dev/null 2>&1; then exit 1; fi
[[ $(find "$work/backups" -name SHA256SUMS | wc -l) == 1 ]]
mkdir -m 755 "$work/public"
if local_pg bash "$here/postgres-backup.sh" "$work/public" >/dev/null 2>&1; then exit 1; fi
if local_pg env RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 80 postgres >/dev/null 2>&1; then exit 1; fi
if local_pg bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres >/dev/null 2>&1; then exit 1; fi
cp -- "$archive/archive.dump" "$work/original.dump"
printf 'corruption' >> "$archive/archive.dump"
if local_pg env RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres >/dev/null 2>&1; then exit 1; fi
# A corrupt archive with a matching checksum must fail restore and clean up.
printf 'invalid archive' > "$archive/archive.dump"
(cd -- "$archive" && sha256sum archive.dump > SHA256SUMS)
if local_pg env RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres >/dev/null 2>&1; then exit 1; fi
[[ $(local_pg psql --no-password -X -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'infraforge_restore_%'") == 0 ]]
[[ $(local_pg psql --no-password -X -Atc 'SELECT count(*) FROM parent') == 2 ]]
echo 'BACKUP PROOF PASS: real dump/restore/content, permissions, failed dump, unsafe target, checksum/corruption refusal, cleanup and unchanged source'
