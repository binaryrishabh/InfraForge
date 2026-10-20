#!/usr/bin/env bash
# Never accepts an existing destination database or a remote destination host.
set -euo pipefail
umask 077
archive=${1:?backup directory required}
port=${2:?disposable loopback PostgreSQL port required}
role=${3:?disposable PostgreSQL role required}
[[ ${RESTORE_DISPOSABLE:-} == local-only && $port =~ ^[0-9]{4,5}$ && $role =~ ^[a-z_][a-z0-9_]*$ ]] || exit 2
(( port >= 1024 && port <= 65535 )) || exit 2
[[ -d $archive && ! -L $archive && -f $archive/archive.dump && ! -L $archive/archive.dump &&
  -f $archive/SHA256SUMS && ! -L $archive/SHA256SUMS ]] || exit 2
expected=$(cat -- "$archive/SHA256SUMS")
[[ $expected =~ ^[a-f0-9]{64}'  archive.dump'$ ]] || exit 2
actual=$(cd -- "$archive" && sha256sum archive.dump)
[[ $actual == "$expected" ]] || { echo 'Archive checksum mismatch' >&2; exit 1; }
pg_restore --version | grep -Eq 'PostgreSQL\) 18\.' || exit 2
work=$(mktemp -d)
name="infraforge_restore_$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
created=false
# Clear every source libpq setting, service, password file and host-address
# override. Only a separate local disposable server can be reached here.
local_pg() {
  env -i PATH="$PATH" PGHOST=127.0.0.1 PGHOSTADDR=127.0.0.1 PGPORT="$port" PGUSER="$role" \
    PGPASSFILE=/dev/null PGSSLMODE=disable PGCONNECT_TIMEOUT=5 \
    PGOPTIONS='-c statement_timeout=120000 -c lock_timeout=10000' \
    timeout --signal=TERM --kill-after=5s 10m "$@"
}
cleanup() {
  local result=$?
  trap - EXIT
  if [[ $created == true ]]; then
    if ! local_pg dropdb --no-password --force "$name" 2>>"$work/diagnostic"; then
      echo 'Disposable restore cleanup failed; remove the generated infraforge_restore database locally' >&2
      result=1
    fi
  fi
  rm -f -- "$work/diagnostic" "$work/counts"
  rmdir -- "$work"
  exit "$result"
}
trap cleanup EXIT
local_pg createdb --no-password --template=template0 "$name" 2>"$work/diagnostic"
created=true
local_pg pg_restore --no-password --exit-on-error --single-transaction --no-owner --no-acl \
  --dbname="$name" "$archive/archive.dump" 2>>"$work/diagnostic"
# Read every application table, including empty ones, after constraint/index
# creation. Keep names/counts private; this is readability, not a source diff.
local_pg psql --no-password -X --set=ON_ERROR_STOP=1 --dbname="$name" -At >"$work/counts" 2>>"$work/diagnostic" <<'SQL'
SELECT format('SELECT count(*) FROM %I.%I;', schemaname, tablename)
FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename
\gexec
SQL
tables=$(wc -l < "$work/counts")
(( tables > 0 )) || { echo 'Restored archive contains no application tables' >&2; exit 1; }
printf 'RESTORE VERIFY PASS tables=%s (disposable database removed on exit)\n' "$tables"
