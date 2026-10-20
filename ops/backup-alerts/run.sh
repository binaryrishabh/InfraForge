#!/usr/bin/env bash
set -euo pipefail
umask 077
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
case "${1:-}" in
  backup|drill) budget=45m ;;
  metrics|cleanup-drill) budget=50s ;;
  *) echo 'Expected backup, drill, metrics or cleanup-drill' >&2; exit 2 ;;
esac
if [[ $1 == backup && ! -v NEON_BACKUP_DATABASE_URL ]]; then
  # systemd supplies a private credential, never a URL in the command line.
  NEON_BACKUP_DATABASE_URL=$(<"${CREDENTIALS_DIRECTORY:?}/neon-url")
  export NEON_BACKUP_DATABASE_URL
fi
# One lock serializes the two disk-intensive jobs. Metrics never wait for them.
if [[ $1 == backup || $1 == drill ]]; then
  exec 9>/var/lib/infraforge-ops/job.lock
  flock --nonblock 9 || { echo 'Another backup/drill holds the lock' >&2; exit 1; }
fi
exec timeout --signal=TERM --kill-after=15s "$budget" python3 "$here/runner.py" "$1"
