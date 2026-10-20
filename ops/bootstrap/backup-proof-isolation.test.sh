#!/usr/bin/env bash
# Internal regression invoked by the owned wrapper, never against a source DB.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/intercept" <<'SH'
#!/usr/bin/env bash
printf 'unexpected mutation\n' >> "${INTERCEPT_LOG:?}"
exit 99
SH
chmod 700 "$work/bin/intercept"
for command in createdb dropdb psql pg_restore pg_dump mktemp docker; do
  ln -s intercept "$work/bin/$command"
done
for variable in PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGPASSWORD PGPASSFILE PGOPTIONS PGSSLMODE; do
  for helper in postgres-backup-proof.sh prove-backup.sh; do
    # Synthetic contamination only. No inherited credential values are copied.
    status=0
    env -i PATH="$work/bin:$PATH" INTERCEPT_LOG="$work/calls" \
      BACKUP_PROOF_DISPOSABLE=owned-container "$variable=synthetic-redirect" \
      bash "$here/$helper" >"$work/output" 2>&1 || status=$?
    [[ $status == 2 && ! -e $work/calls ]] || exit 1
  done
done
# In an owned fixture, intercept the first read and write and verify that even
# non-libpq ambient settings cannot cross the clean invocation boundary.
rm "$work/bin/psql" "$work/bin/createdb" "$work/bin/mktemp"
cat > "$work/bin/psql" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $PGHOST == 127.0.0.1 && $PGHOSTADDR == 127.0.0.1 && $PGPORT == 5432 &&
   $PGUSER == postgres && $PGDATABASE == infraforge_backup_fixture &&
   $PGPASSFILE == /dev/null && $PGCONNECT_TIMEOUT == 5 && $PGSSLMODE == disable &&
   ! -v PGSERVICE && ! -v PGSERVICEFILE && ! -v PGPASSWORD && ! -v PROOF_AMBIENT &&
   " $* " == *' --no-password '* ]] || exit 98
printf '/var/lib/postgresql/18/docker\n'
SH
cat > "$work/bin/createdb" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $PGHOST == 127.0.0.1 && $PGHOSTADDR == 127.0.0.1 && $PGPORT == 5432 &&
   ! -v PROOF_AMBIENT && ! -v PGSERVICE && ! -v PGPASSWORD && $PGPASSFILE == /dev/null &&
   $1 == --no-password && $2 == infraforge_backup_fixture ]] || exit 98
exit 77
SH
chmod 700 "$work/bin/psql" "$work/bin/createdb"
status=0
env -i PATH="$work/bin:$PATH" PROOF_AMBIENT=synthetic \
  BACKUP_PROOF_DISPOSABLE=owned-container BACKUP_PROOF_TOKEN="${BACKUP_PROOF_TOKEN:?}" \
  bash "$here/postgres-backup-proof.sh" >"$work/output" 2>&1 || status=$?
[[ $status == 77 ]] || exit 1
echo 'BACKUP ISOLATION PASS: 26 contaminated entrypoints refused before mutation; clean loopback read/write boundary'
