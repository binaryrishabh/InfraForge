#!/usr/bin/env bash
# Linux/PostgreSQL 18 tools. Connection comes only from operator-supplied libpq
# settings (prefer a service and mode-0600 pgpass), never a command-line URL.
set -euo pipefail
umask 077
root=${1:?existing private backup directory required}
[[ -d $root && ! -L $root ]] || exit 2
mode=$(stat -c '%a' "$root")
(( (8#$mode & 077) == 0 )) || { echo 'Backup directory must be private' >&2; exit 2; }
pg_dump --version | grep -Eq 'PostgreSQL\) 18\.' || exit 2
work=$(mktemp -d "$root/backup.XXXXXXXX")
trap 'echo "Backup incomplete; inspect private diagnostic in the new backup directory" >&2' ERR
export PGCONNECT_TIMEOUT=5
export PGOPTIONS='-c statement_timeout=120000 -c lock_timeout=10000'
timeout --signal=TERM --kill-after=10s 10m pg_dump --no-password --format=custom --lock-wait-timeout=10s \
  --file="$work/archive.dump.partial" 2>"$work/diagnostic"
timeout --signal=TERM --kill-after=10s 30s pg_restore --list "$work/archive.dump.partial" >/dev/null 2>>"$work/diagnostic"
mv -- "$work/archive.dump.partial" "$work/archive.dump"
(cd -- "$work" && sha256sum archive.dump > SHA256SUMS.partial && mv SHA256SUMS.partial SHA256SUMS)
trap - ERR
printf 'BACKUP PASS %s\n' "$work"
