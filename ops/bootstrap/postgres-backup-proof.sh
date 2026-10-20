#!/usr/bin/env bash
# Only run inside an owned, disposable postgres:18 container.
set -euo pipefail
[[ ${BACKUP_PROOF_DISPOSABLE:-} == owned-container ]] || exit 2
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export PGHOST=127.0.0.1 PGUSER=postgres PGDATABASE=infraforge_backup_fixture
createdb "$PGDATABASE"
psql -X --set=ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE parent (id integer PRIMARY KEY, payload text NOT NULL);
CREATE TABLE child (id integer REFERENCES parent(id));
INSERT INTO parent VALUES (1, 'restore proof'), (2, '');
INSERT INTO child VALUES (1);
SQL
mkdir -m 700 "$work/backups"
receipt=$(bash "$here/postgres-backup.sh" "$work/backups")
archive=${receipt#BACKUP PASS }
[[ -f $archive/SHA256SUMS && $(stat -c '%a' "$archive/archive.dump") == 600 ]]
RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres | grep -q 'PASS tables=2'
[[ $(psql -X -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'infraforge_restore_%'") == 0 ]]
# Independently prove the real archive contains the expected fixture content.
createdb infraforge_backup_content
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=infraforge_backup_content "$archive/archive.dump"
[[ $(psql -X -At --dbname=infraforge_backup_content -c 'SELECT payload FROM parent WHERE id=1') == 'restore proof' ]]
[[ $(psql -X -At --dbname=infraforge_backup_content -c 'SELECT count(*) FROM child') == 1 ]]
dropdb infraforge_backup_content
if PGDATABASE=infraforge_backup_missing bash "$here/postgres-backup.sh" "$work/backups" >/dev/null 2>&1; then exit 1; fi
[[ $(find "$work/backups" -name SHA256SUMS | wc -l) == 1 ]]
mkdir -m 755 "$work/public"
if bash "$here/postgres-backup.sh" "$work/public" >/dev/null 2>&1; then exit 1; fi
if RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 80 postgres >/dev/null 2>&1; then exit 1; fi
if bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres >/dev/null 2>&1; then exit 1; fi
cp -- "$archive/archive.dump" "$work/original.dump"
printf 'corruption' >> "$archive/archive.dump"
if RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres >/dev/null 2>&1; then exit 1; fi
# A corrupt archive with a matching checksum must fail restore and clean up.
printf 'invalid archive' > "$archive/archive.dump"
(cd -- "$archive" && sha256sum archive.dump > SHA256SUMS)
if RESTORE_DISPOSABLE=local-only bash "$here/postgres-restore-verify.sh" "$archive" 5432 postgres >/dev/null 2>&1; then exit 1; fi
[[ $(psql -X -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'infraforge_restore_%'") == 0 ]]
[[ $(psql -X -Atc 'SELECT count(*) FROM parent') == 2 ]]
echo 'BACKUP PROOF PASS: real dump/restore/content, permissions, failed dump, unsafe target, checksum/corruption refusal, cleanup and unchanged source'
